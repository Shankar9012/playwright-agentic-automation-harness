import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, writeFile, mkdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { readJson } from '../io/read-json.mjs';
import { writeJsonAtomic } from '../io/write-json-atomic.mjs';
import { backupFile, hashFile } from '../guardrails/safe-restore.mjs';
import { isHealablePath, toPosixRelative } from '../guardrails/validate-healing-patch.mjs';
import { classifyFailure, stripAnsi } from './classify-failure.mjs';
import { collectDiagnostics } from './collect-diagnostics.mjs';

/**
 * Builds the deterministic repair queue consumed by the Claude Code orchestrator.
 *
 * Only ELIGIBLE locator failures become queue items; every other failure is recorded in the
 * triage list with its reason and is never actionable by the healer. Target files are backed up
 * before the healer touches anything, and a manifest of protected files is stored so the
 * verifier can detect edits outside the authorized scope.
 */

export const ITEM_STATUS = Object.freeze({
  QUEUED: 'QUEUED',
  HEALED: 'HEALED',
  FAILED_RERUN: 'FAILED_RERUN',
  REJECTED: 'REJECTED',
  ABANDONED: 'ABANDONED',
});

/** Paths whose integrity is checked during verification (repo-relative). */
export const PROTECTED_SCOPE = ['tests', 'utils', 'scripts', '.claude', 'playwright.config.js', 'package.json', 'eslint.config.js'];

/**
 * sha256 manifest of every protected file.
 * @param {string} root
 * @returns {Promise<Record<string, string>>}
 */
export async function buildManifest(root) {
  /** @type {Record<string, string>} */
  const manifest = {};
  for (const entry of PROTECTED_SCOPE) {
    const absolute = join(root, entry);
    if (!existsSync(absolute)) continue;
    const files = entry.includes('.') && !entry.startsWith('.')
      ? [absolute]
      : (await readdir(absolute, { recursive: true, withFileTypes: true }))
        .filter((d) => d.isFile())
        .map((d) => join(d.parentPath ?? d.path, d.name));
    for (const file of files) manifest[toPosixRelative(relative(root, file))] = await hashFile(file);
  }
  return manifest;
}

/**
 * Compare two manifests and list changed, added and removed files.
 * @param {Record<string, string>} before
 * @param {Record<string, string>} after
 */
export function diffManifest(before, after) {
  const changed = [];
  for (const [file, hash] of Object.entries(after)) if (before[file] !== hash) changed.push(file);
  for (const file of Object.keys(before)) if (!(file in after)) changed.push(file);
  return changed.sort();
}

/** @param {string} key */
const shortId = (key) => `itm_${createHash('sha256').update(key).digest('hex').slice(0, 8)}`;

/**
 * Classify all failures of a parsed run and write repair-queue.json + run triage.
 * @param {object} options
 * @param {string} options.root
 * @param {string} options.runId
 * @param {string} options.runDir
 * @param {ReturnType<import('../reporting/parse-playwright-json.mjs').parseReport>} options.parsed
 * @param {number} [options.maxAttempts]
 */
export async function buildRepairQueue({ root, runId, runDir, parsed, maxAttempts = 1 }) {
  const triage = [];
  /** @type {Map<string, any>} */
  const items = new Map();

  for (const test of parsed.tests) {
    if (test.status !== 'unexpected' || !test.failure) continue;
    const failure = test.failure;
    const base = classifyFailure({ status: failure.status, errors: failure.errors ?? [] });
    const diagnostics = await collectDiagnostics(failure, { root, locator: base.locator });
    const classification = classifyFailure({
      status: failure.status,
      errors: failure.errors ?? [],
      pageSnapshot: diagnostics.pageSnapshot,
    });

    const testRef = { testId: test.testId, title: test.title, titlePath: test.titlePath, file: test.file, line: test.line, projectName: test.projectName };
    const entry = {
      ...testRef,
      originalStatus: failure.status,
      category: classification.category,
      subtype: classification.subtype,
      rule: classification.rule,
      reason: classification.reason,
      locator: classification.locator,
      eligible: classification.eligible,
      evidence: diagnostics.evidence,
      itemId: null,
    };

    if (classification.eligible) {
      const definition = diagnostics.definitions.find((d) => isHealablePath(d.file));
      const allowedFiles = definition
        ? [definition.file]
        : [...new Set(diagnostics.frames.map((f) => f.file).filter(isHealablePath))];
      if (allowedFiles.length === 0) {
        entry.eligible = false;
        entry.reason += ' Not queued: the locator definition could not be located in an authorized test or Page Object file.';
      } else {
        const key = definition ? `${definition.file}:${definition.line}` : `${allowedFiles.join(',')}::${classification.locator}`;
        const itemId = shortId(`${runId}::${key}`);
        entry.itemId = itemId;
        const existing = items.get(itemId);
        if (existing) {
          existing.tests.push(testRef);
        } else {
          const itemDir = join(runDir, 'items', itemId);
          await mkdir(itemDir, { recursive: true });
          let snapshotPath = null;
          if (diagnostics.pageSnapshot) {
            snapshotPath = toPosixRelative(relative(root, join(itemDir, 'page-snapshot.yml')));
            await writeFile(join(itemDir, 'page-snapshot.yml'), `${diagnostics.pageSnapshot}\n`, 'utf8');
          }
          const backupDir = join(runDir, 'backups', itemId);
          const backups = [];
          for (const file of allowedFiles) backups.push(await backupFile({ root, file, backupDir }));
          items.set(itemId, {
            itemId,
            status: ITEM_STATUS.QUEUED,
            attempts: 0,
            maxAttempts,
            tests: [testRef],
            originalStatus: failure.status,
            category: classification.category,
            subtype: classification.subtype,
            rule: classification.rule,
            reason: classification.reason,
            locator: classification.locator,
            errorMessage: stripAnsi(failure.errors?.[0]?.message ?? '').slice(0, 4000),
            target: definition ?? null,
            allowedFiles,
            candidates: classification.candidates,
            frames: diagnostics.frames,
            evidence: { ...diagnostics.evidence, pageSnapshot: snapshotPath },
            backups,
            result: null,
          });
        }
      }
    }
    triage.push(entry);
  }

  const queue = { runId, createdAt: new Date().toISOString(), items: [...items.values()] };
  await writeJsonAtomic(join(runDir, 'repair-queue.json'), queue);
  await writeJsonAtomic(join(runDir, 'manifest.json'), await buildManifest(root));
  return { queue, triage };
}

/** @param {string} runDir */
export async function readQueue(runDir) {
  const queue = await readJson(join(runDir, 'repair-queue.json'));
  if (!queue || !Array.isArray(queue.items)) throw new Error(`Invalid repair queue in ${runDir}.`);
  return queue;
}

/**
 * Update one item in the queue atomically.
 * @param {string} runDir
 * @param {string} itemId
 * @param {(item: any) => any} update
 */
export async function updateQueueItem(runDir, itemId, update) {
  const queue = await readQueue(runDir);
  const index = queue.items.findIndex((i) => i.itemId === itemId);
  if (index === -1) throw new Error(`Item ${itemId} is not in the repair queue for ${runDir}.`);
  queue.items[index] = update(queue.items[index]);
  await writeJsonAtomic(join(runDir, 'repair-queue.json'), queue);
  return queue.items[index];
}
