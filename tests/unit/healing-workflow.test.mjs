import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRunId } from '../../utils/config/runtime-config.mjs';
import { runPlaywright } from '../../utils/execution/run-playwright.mjs';
import { readReport } from '../../utils/reporting/parse-playwright-json.mjs';
import { buildRepairQueue } from '../../utils/healing/repair-queue.mjs';
import { verifyHealingItem } from '../../utils/healing/validate-healing.mjs';
import { readHealingLog } from '../../utils/healing/record-healing.mjs';
import { buildSummary } from '../../utils/reporting/build-summary.mjs';
import { sha256 } from '../../utils/guardrails/safe-restore.mjs';

/**
 * End-to-end healing workflow against an offline sandbox, with genuine Playwright runs:
 *   Test A — broken locator: queued, repaired in source, rerun passes, logged as HEALED.
 *   Test A' — wrong repair: rerun fails, file restored byte-for-byte.
 *   Test B — wrong expected value: never queued; the spec file is never changed.
 *   Test B' — tampered assertion: rejected by the patch validator and restored.
 * The sandbox lives under artifacts/ so @playwright/test resolves from the project.
 */

const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TEMPLATE = fileURLToPath(new URL('./fixtures/healing-sandbox/', import.meta.url));
const PAGE = 'tests/pages/shop-page.js';
const PRICE_SPEC = 'tests/specs/price.spec.js';

async function createSandbox() {
  const root = join(PROJECT_ROOT, 'artifacts', `unit-sandbox-${randomUUID().slice(0, 8)}`);
  await cp(TEMPLATE, root, { recursive: true });
  // An unrelated, uncommitted user change outside the protected scope.
  await mkdir(join(root, 'docs'), { recursive: true });
  await writeFile(join(root, 'docs', 'notes.md'), 'work in progress\n');
  return root;
}

const runner = (opts) => runPlaywright({ ...opts, stdio: 'pipe' });

async function initialRun(root) {
  const runId = createRunId();
  const runDir = join(root, 'artifacts', 'runs', runId);
  const result = await runner({ root, retries: 0, outputFile: join(runDir, 'report.json'), runId });
  const parsed = await readReport(join(runDir, 'report.json'), { root });
  const { queue, triage } = await buildRepairQueue({ root, runId, runDir, parsed });
  return { runId, runDir, result, parsed, queue, triage, healingLogDir: join(root, 'artifacts', 'healing-log') };
}

test('healing workflow with real Playwright reruns', { timeout: 240_000 }, async (t) => {
  const root = await createSandbox();
  try {
    const brokenPage = await readFile(join(root, PAGE), 'utf8');
    const priceSpec = await readFile(join(root, PRICE_SPEC), 'utf8');

    await t.test('Test A: broken locator is queued, repaired in source, verified by rerun and logged', async () => {
      const run = await initialRun(root);
      assert.equal(run.result.exitCode, 1);
      assert.equal(run.parsed.stats.unexpected, 2);

      const cartEntry = run.triage.find((e) => e.file === 'tests/specs/cart.spec.js');
      assert.equal(cartEntry.category, 'LOCATOR');
      assert.equal(cartEntry.eligible, true);
      assert.equal(run.queue.items.length, 1, 'only the locator failure is queued');
      const [item] = run.queue.items;
      assert.equal(item.target.file, PAGE);
      assert.match(item.target.statement, /Add to bag/);
      assert.deepEqual(item.allowedFiles, [PAGE]);
      assert.ok(item.evidence.pageSnapshot, 'page snapshot evidence was captured');

      // The self-healer's edit: the intended button is "Add to cart" in the snapshot.
      await writeFile(join(root, PAGE), brokenPage.replace("{ name: 'Add to bag' }", "{ name: 'Add to cart' }"));
      const outcome = await verifyHealingItem({
        root, runDir: run.runDir, runId: run.runId, itemId: item.itemId, healingLogDir: run.healingLogDir,
        diagnosis: 'Accessible name changed from "Add to bag" to "Add to cart".', runner,
      });
      assert.equal(outcome.outcome, 'HEALED', JSON.stringify(outcome.verification));
      assert.equal(outcome.verification.runs[0].exitCode, 0, 'genuine rerun passed');
      assert.equal(outcome.verification.runs[0].stats.expected, 2, 'repeat-each=2 executed the test twice');
      assert.match(await readFile(join(root, PAGE), 'utf8'), /name: 'Add to cart'/, 'repair kept in source');

      const [record] = await readHealingLog(run.healingLogDir, run.runId);
      assert.equal(record.outcome, 'HEALED');
      assert.equal(record.originalLocator, "page.getByRole('button', { name: 'Add to bag' })");
      assert.equal(record.replacementLocator, "page.getByRole('button', { name: 'Add to cart' })");
      assert.deepEqual(record.filesChanged, [PAGE]);

      // Test B (same run): the wrong expected value was classified, not queued, and untouched.
      const priceEntry = run.triage.find((e) => e.file === PRICE_SPEC);
      assert.equal(priceEntry.category, 'ASSERTION_MISMATCH');
      assert.equal(priceEntry.eligible, false);
      assert.equal(sha256(await readFile(join(root, PRICE_SPEC), 'utf8')), sha256(priceSpec));

      // Final status comes from a genuine confirmation rerun, not from the healing log.
      const finalOut = join(run.runDir, 'final.json');
      await runner({ root, targets: run.parsed.tests.map((x) => `${x.file}:${x.line}`), retries: 0, outputFile: finalOut, runId: run.runId });
      const summary = buildSummary({
        runId: run.runId, baseURL: 'offline', initial: run.parsed, triage: run.triage, queue: run.queue,
        healingRecords: await readHealingLog(run.healingLogDir, run.runId), final: await readReport(finalOut, { root }),
      });
      assert.equal(summary.final.passed, 1);
      assert.equal(summary.final.failed, 1);
      assert.equal(summary.repaired.length, 1);
      assert.equal(summary.suspectedDefects[0].category, 'ASSERTION_MISMATCH');
      assert.equal(summary.exitCode, 1, 'unresolved assertion failure keeps the run red');
    });

    await t.test("Test A': a wrong repair fails the rerun and is restored byte-for-byte", async () => {
      await writeFile(join(root, PAGE), brokenPage);
      const run = await initialRun(root);
      const [item] = run.queue.items;
      await writeFile(join(root, PAGE), brokenPage.replace("{ name: 'Add to bag' }", "{ name: 'Buy now' }"));
      const outcome = await verifyHealingItem({ root, runDir: run.runDir, runId: run.runId, itemId: item.itemId, healingLogDir: run.healingLogDir, runner });
      assert.equal(outcome.outcome, 'FAILED_RERUN');
      assert.equal(await readFile(join(root, PAGE), 'utf8'), brokenPage, 'restored to the pre-repair source');
      assert.equal(await readFile(join(root, 'docs', 'notes.md'), 'utf8'), 'work in progress\n', 'unrelated change preserved');
      const records = await readHealingLog(run.healingLogDir, run.runId);
      assert.equal(records.at(-1).outcome, 'FAILED_RERUN');
      assert.deepEqual(records.at(-1).filesChanged, []);
      await assert.rejects(
        verifyHealingItem({ root, runDir: run.runDir, runId: run.runId, itemId: item.itemId, healingLogDir: run.healingLogDir, runner }),
        /only QUEUED items can be verified/,
        'one healing attempt per failure per run',
      );
    });

    await t.test("Test B': editing an assertion or an out-of-scope file is rejected and restored", async () => {
      const run = await initialRun(root);
      const [item] = run.queue.items;
      // Tamper with the Page Object in a non-locator way (business logic) — rejected.
      await writeFile(join(root, PAGE), brokenPage.replace('await this.addToCartButton.click();', 'await this.page.getByText(/add/i).click({ force: true });'));
      const outcome = await verifyHealingItem({ root, runDir: run.runDir, runId: run.runId, itemId: item.itemId, healingLogDir: run.healingLogDir, runner });
      assert.equal(outcome.outcome, 'REJECTED');
      assert.equal(outcome.verification.stage, 'patch');
      assert.equal(await readFile(join(root, PAGE), 'utf8'), brokenPage);

      const run2 = await initialRun(root);
      await writeFile(join(root, PRICE_SPEC), priceSpec.replace('$149.98', () => '$149.99'));
      const outOfScope = await verifyHealingItem({ root, runDir: run2.runDir, runId: run2.runId, itemId: run2.queue.items[0].itemId, healingLogDir: run2.healingLogDir, runner });
      assert.equal(outOfScope.outcome, 'REJECTED');
      assert.equal(outOfScope.verification.stage, 'scope');
      assert.match(outOfScope.verification.violations[0].detail, /price\.spec\.js/);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
