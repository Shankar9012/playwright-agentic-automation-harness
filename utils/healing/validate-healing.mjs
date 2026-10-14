import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { readJson } from '../io/read-json.mjs';
import { restoreFile, commitFile } from '../guardrails/safe-restore.mjs';
import { validateHealingPatch, toPosixRelative } from '../guardrails/validate-healing-patch.mjs';
import { readReport } from '../reporting/parse-playwright-json.mjs';
import { buildManifest, diffManifest, ITEM_STATUS, readQueue, updateQueueItem } from './repair-queue.mjs';
import { OUTCOME, recordHealing } from './record-healing.mjs';

/**
 * Verifies an applied healing patch for one repair-queue item and decides its fate:
 *   1. scope      - only the item's allowed files may have changed since the queue was built
 *   2. patch      - every change must be a locator-only change (validate-healing-patch)
 *   3. rerun      - the affected tests are re-executed by Playwright with retries=0 and
 *                   repeat-each=2; specs sharing the edited Page Object are rerun too
 *   4. decision   - keep the patch only when every rerun passes; otherwise restore the
 *                   affected files from backup
 *   5. audit      - append the outcome to artifacts/healing-log/<runId>.json
 */

/**
 * Spec files that import the given Page Object (blast-radius of a shared locator change).
 * @param {string} root
 * @param {string} pageFile repo-relative
 */
export async function findDependentSpecs(root, pageFile) {
  const specsDir = join(root, 'tests', 'specs');
  if (!existsSync(specsDir)) return [];
  const target = resolve(root, pageFile);
  const dependents = [];
  const entries = await readdir(specsDir, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !/\.m?js$/.test(entry.name)) continue;
    const file = join(entry.parentPath ?? entry.path, entry.name);
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(/(?:from\s+|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
      if (resolve(dirname(file), match[1]) === target) {
        dependents.push(toPosixRelative(relative(root, file)));
        break;
      }
    }
  }
  return dependents;
}

/**
 * Test IDs that failed in the run's initial report.
 * @param {string} root
 * @param {string} runDir
 */
async function initiallyFailingTests(root, runDir) {
  try {
    const initial = await readReport(join(runDir, 'report.json'), { root });
    return new Set(initial.tests.filter((t) => t.status === 'unexpected').map((t) => t.testId));
  } catch {
    return new Set();
  }
}

/**
 * A rerun passes only when every executed test passed on every repetition.
 * @param {{ stats: { total: number, expected: number, unexpected: number, flaky: number }, tests: any[] }} parsed
 */
export function rerunPassed(parsed) {
  return parsed.stats.total > 0 && parsed.stats.unexpected === 0 && parsed.stats.flaky === 0
    && parsed.tests.every((t) => t.status === 'expected');
}

/**
 * @param {object} options
 * @param {string} options.root
 * @param {string} options.runDir
 * @param {string} options.runId
 * @param {string} options.itemId
 * @param {string} options.healingLogDir
 * @param {string} [options.diagnosis] healer's explanation of the repair
 * @param {(opts: object) => Promise<{ exitCode: number, command: string, outputFile: string }>} options.runner
 * @param {(msg: string) => void} [options.log]
 */
export async function verifyHealingItem({ root, runDir, runId, itemId, healingLogDir, diagnosis = null, runner, log = () => {} }) {
  const queue = await readQueue(runDir);
  const item = queue.items.find((i) => i.itemId === itemId);
  if (!item) throw new Error(`Item ${itemId} not found in ${join(runDir, 'repair-queue.json')}.`);
  if (item.status !== ITEM_STATUS.QUEUED) {
    throw new Error(`Item ${itemId} is ${item.status}; only QUEUED items can be verified (one attempt per failure per run).`);
  }
  if (item.attempts >= item.maxAttempts) throw new Error(`Item ${itemId} has no healing attempts left.`);

  const backupDir = join(runDir, 'backups', itemId);
  const restoreAll = async () => {
    const restored = [];
    for (const record of item.backups) restored.push((await restoreFile({ root, record, backupDir })).file);
    return restored;
  };

  /** Finalize: update queue + healing log. */
  const finish = async (outcome, status, verification, changes = []) => {
    const updated = await updateQueueItem(runDir, itemId, (current) => ({
      ...current,
      status,
      attempts: current.attempts + 1,
      result: { outcome, verification, changes, diagnosis, finishedAt: new Date().toISOString() },
    }));
    await recordHealing(healingLogDir, {
      runId,
      itemId,
      testIds: item.tests.map((t) => t.testId),
      originalStatus: item.originalStatus,
      category: item.category,
      subtype: item.subtype,
      originalLocator: changes[0]?.before ?? item.locator,
      replacementLocator: changes[0]?.after ?? null,
      filesChanged: outcome === OUTCOME.HEALED ? [...new Set(changes.map((c) => c.file))] : [],
      diagnosis,
      outcome,
      verification,
      evidence: { ...item.evidence, rerunReports: verification.rerunReports ?? [] },
    });
    return { outcome, status, item: updated, verification, changes };
  };

  // 1. Scope check.
  const manifest = await readJson(join(runDir, 'manifest.json'));
  const changedFiles = diffManifest(manifest, await buildManifest(root));
  const outOfScope = changedFiles.filter((f) => !item.allowedFiles.includes(f));
  const inScopeChanged = changedFiles.filter((f) => item.allowedFiles.includes(f));
  if (outOfScope.length > 0) {
    const restored = await restoreAll();
    log(`Rejected: files outside the authorized scope changed: ${outOfScope.join(', ')}`);
    return finish(OUTCOME.REJECTED, ITEM_STATUS.REJECTED, {
      stage: 'scope',
      violations: [{ code: 'OUT_OF_SCOPE_FILE', detail: `Changed outside allowed files: ${outOfScope.join(', ')}. These were NOT reverted automatically; review them manually.` }],
      restored,
    });
  }
  if (inScopeChanged.length === 0) {
    return finish(OUTCOME.REJECTED, ITEM_STATUS.REJECTED, {
      stage: 'scope',
      violations: [{ code: 'NO_CHANGE', detail: 'No allowed file was modified; nothing to verify.' }],
      restored: [],
    });
  }

  // 2. Patch validation against the byte-exact backup.
  const changes = [];
  const violations = [];
  const degraded = [];
  for (const record of item.backups) {
    if (!inScopeChanged.includes(record.file)) continue;
    const before = await readFile(resolve(root, record.backup), 'utf8');
    const after = await readFile(resolve(root, record.file), 'utf8');
    const verdict = validateHealingPatch({ filePath: record.file, before, after });
    violations.push(...verdict.violations.map((v) => ({ ...v, file: record.file })));
    degraded.push(...verdict.degraded);
    changes.push(...verdict.changes.map((c) => ({ ...c, file: record.file })));
  }
  if (violations.length > 0) {
    const restored = await restoreAll();
    log(`Rejected by patch validator: ${violations.map((v) => v.code).join(', ')}`);
    return finish(OUTCOME.REJECTED, ITEM_STATUS.REJECTED, { stage: 'patch', violations, restored }, changes);
  }

  // 3. Rerun the affected tests (exact file:line filters), then dependents of the edited Page Object.
  const rerunReports = [];
  const project = item.tests[0].projectName;
  const targeted = await runner({
    root,
    targets: [...new Set(item.tests.map((t) => `${t.file}:${t.line}`))],
    project,
    retries: 0,
    repeatEach: 2,
    outputFile: join(runDir, 'reruns', itemId, 'targeted.json'),
    runId,
  });
  rerunReports.push(toPosixRelative(relative(root, targeted.outputFile)));
  let parsed;
  try {
    parsed = await readReport(targeted.outputFile, { root });
  } catch (error) {
    const restored = await restoreAll();
    return finish(OUTCOME.FAILED_RERUN, ITEM_STATUS.FAILED_RERUN, {
      stage: 'rerun', command: targeted.command, exitCode: targeted.exitCode, error: error.message, rerunReports, restored, degraded,
    }, changes);
  }
  const runs = [{ scope: 'targeted', command: targeted.command, exitCode: targeted.exitCode, stats: parsed.stats }];
  let passed = targeted.exitCode === 0 && rerunPassed(parsed);

  if (passed) {
    const pageFiles = changes.map((c) => c.file).filter((f) => f.startsWith('tests/pages/'));
    const dependents = new Set();
    for (const pageFile of pageFiles) for (const spec of await findDependentSpecs(root, pageFile)) dependents.add(spec);
    for (const t of item.tests) dependents.delete(t.file);
    if (dependents.size > 0) {
      const blast = await runner({
        root, targets: [...dependents], project, retries: 0,
        outputFile: join(runDir, 'reruns', itemId, 'dependents.json'), runId,
      });
      rerunReports.push(toPosixRelative(relative(root, blast.outputFile)));
      try {
        const blastParsed = await readReport(blast.outputFile, { root });
        // Dependents that already failed in the initial run are not regressions caused by this
        // patch; any other failure is collateral damage and rejects the repair.
        const initiallyFailing = await initiallyFailingTests(root, runDir);
        const regressions = blastParsed.tests
          .filter((t) => t.status !== 'expected' && t.status !== 'skipped' && !initiallyFailing.has(t.testId))
          .map((t) => t.testId);
        runs.push({ scope: 'dependents', command: blast.command, exitCode: blast.exitCode, stats: blastParsed.stats, files: [...dependents], regressions });
        passed = blastParsed.stats.total > 0 && regressions.length === 0;
      } catch (error) {
        runs.push({ scope: 'dependents', command: blast.command, exitCode: blast.exitCode, error: error.message });
        passed = false;
      }
    }
  }

  // 4. Decision.
  if (!passed) {
    const restored = await restoreAll();
    log('Rerun failed; affected files restored from backup.');
    return finish(OUTCOME.FAILED_RERUN, ITEM_STATUS.FAILED_RERUN, { stage: 'rerun', runs, rerunReports, restored, degraded }, changes);
  }
  for (const record of item.backups) await commitFile({ record, backupDir });
  log('Rerun passed with original assertions intact; patch kept.');
  return finish(OUTCOME.HEALED, ITEM_STATUS.HEALED, { stage: 'complete', runs, rerunReports, degraded }, changes);
}

/**
 * Mark a queued item as abandoned (healer could not confirm the intended target).
 * Any partial edits to the allowed files are restored.
 * @param {{ root: string, runDir: string, runId: string, itemId: string, healingLogDir: string, reason: string }} options
 */
export async function abandonHealingItem({ root, runDir, runId, itemId, healingLogDir, reason }) {
  const queue = await readQueue(runDir);
  const item = queue.items.find((i) => i.itemId === itemId);
  if (!item) throw new Error(`Item ${itemId} not found.`);
  if (item.status !== ITEM_STATUS.QUEUED) throw new Error(`Item ${itemId} is already ${item.status}.`);
  const backupDir = join(runDir, 'backups', itemId);
  const restored = [];
  for (const record of item.backups) restored.push((await restoreFile({ root, record, backupDir })).file);
  await updateQueueItem(runDir, itemId, (current) => ({
    ...current, status: ITEM_STATUS.ABANDONED, attempts: current.attempts + 1,
    result: { outcome: OUTCOME.ABANDONED, reason, restored, finishedAt: new Date().toISOString() },
  }));
  return recordHealing(healingLogDir, {
    runId, itemId, testIds: item.tests.map((t) => t.testId), originalStatus: item.originalStatus,
    category: item.category, subtype: item.subtype, originalLocator: item.locator, replacementLocator: null,
    filesChanged: [], diagnosis: reason, outcome: OUTCOME.ABANDONED, verification: { stage: 'abandoned', restored }, evidence: item.evidence,
  });
}
