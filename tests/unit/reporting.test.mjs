import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseReport, ReportError } from '../../utils/reporting/parse-playwright-json.mjs';
import { buildSummary } from '../../utils/reporting/build-summary.mjs';
import { renderMarkdown } from '../../utils/reporting/write-report.mjs';

const ROOT = 'C:/work/harness';
const load = (name) => JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8'));

/** Minimal report shaped like Playwright's JSON output for a project whose testDir differs from rootDir. */
const nestedReport = (status, resultStatus) => ({
  config: { rootDir: `${ROOT}/tests`, projects: [{ name: 'faults', testDir: `${ROOT}/tests/faults` }] },
  suites: [{
    title: 'faults/specs/cart.spec.js',
    file: 'faults/specs/cart.spec.js',
    specs: [],
    suites: [{
      title: 'Cart',
      file: 'faults/specs/cart.spec.js',
      specs: [{
        title: 'adds item', file: 'faults/specs/cart.spec.js', line: 7, tags: ['@smoke'],
        tests: [{ projectName: 'faults', status, results: [{ status: resultStatus, errors: [], attachments: [] }] }],
      }],
    }],
  }],
  errors: [],
  stats: { expected: status === 'expected' ? 1 : 0, unexpected: status === 'unexpected' ? 1 : 0, flaky: 0, skipped: 0, duration: 1 },
});

test('resolves spec files relative to config.rootDir and keeps describe titles', () => {
  const parsed = parseReport(nestedReport('unexpected', 'failed'), { root: ROOT });
  const [t] = parsed.tests;
  assert.equal(t.file, 'tests/faults/specs/cart.spec.js');
  assert.deepEqual(t.titlePath, ['Cart', 'adds item']);
  assert.equal(t.testId, 'faults::tests/faults/specs/cart.spec.js::Cart > adds item');
  assert.equal(t.failure.status, 'failed');
});

test('a missing or truncated report is an infrastructure error, never green', () => {
  assert.throws(() => parseReport({}, { root: ROOT }), ReportError);
  assert.throws(() => parseReport(null, { root: ROOT }), ReportError);
  assert.throws(() => parseReport({ suites: [] }, { root: ROOT }), /missing "suites" or "stats"/);
});

test('flaky retries are reported separately and never counted as repairs', () => {
  const parsed = parseReport(load('pw-flaky.report.json'), { root: ROOT });
  const summary = buildSummary({ runId: 'r', baseURL: 'x', initial: parsed });
  assert.equal(summary.initial.flaky, 1);
  assert.equal(summary.flaky.length, 1);
  assert.equal(summary.repaired.length, 0);
  assert.equal(summary.healing.healed, 0);
  assert.equal(summary.exitCode, 0);
});

test('final status comes from the confirmation rerun, not from the healing log', () => {
  const initial = parseReport(nestedReport('unexpected', 'failed'), { root: ROOT });
  const testId = initial.tests[0].testId;
  const healed = [{ outcome: 'HEALED', itemId: 'itm_1', testIds: [testId], category: 'LOCATOR', subtype: 'NOT_FOUND', originalLocator: 'a', replacementLocator: 'b', filesChanged: ['tests/faults/pages/p.js'], verification: {} }];

  // A HEALED record whose test still fails in the confirmation rerun is not counted as passed.
  const stillFailing = buildSummary({ runId: 'r', baseURL: 'x', initial, healingRecords: healed, final: parseReport(nestedReport('unexpected', 'failed'), { root: ROOT }) });
  assert.equal(stillFailing.final.passed, 0);
  assert.equal(stillFailing.final.failed, 1);
  assert.equal(stillFailing.tests[0].healed, false);
  assert.equal(stillFailing.exitCode, 1);

  const fixed = buildSummary({ runId: 'r', baseURL: 'x', initial, healingRecords: healed, final: parseReport(nestedReport('expected', 'passed'), { root: ROOT }) });
  assert.equal(fixed.final.passed, 1);
  assert.equal(fixed.tests[0].healed, true);
  assert.equal(fixed.exitCode, 0);

  // Without a confirmation rerun the failure stays a failure.
  const unconfirmed = buildSummary({ runId: 'r', baseURL: 'x', initial, healingRecords: healed });
  assert.equal(unconfirmed.final.failed, 1);
  assert.equal(unconfirmed.final.confirmedByRerun, false);
  assert.match(renderMarkdown(unconfirmed), /no confirmation rerun/);
});
