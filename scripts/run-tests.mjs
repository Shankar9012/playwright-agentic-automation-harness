#!/usr/bin/env node
/**
 * Run Playwright tests for a requested scope and produce structured run artifacts.
 *
 * Usage:
 *   node scripts/run-tests.mjs [playwright args...]
 *   node scripts/run-tests.mjs tests/specs/login.spec.js --grep @smoke
 *   node scripts/run-tests.mjs --project=faults
 *
 * Writes artifacts/runs/<runId>/{report.json,run.json,summary.json,summary.md,allure-results/},
 * the Allure report in allure-report/ and the HTML report in playwright-report/. Exit code mirrors Playwright (0 pass, 1 failures); 2 means the
 * run produced no usable JSON report.
 */
import process from 'node:process';
import { join } from 'node:path';
import { getRuntimeConfig, loadDotEnv } from '../utils/config/runtime-config.mjs';
import { pruneRuns } from '../utils/config/run-paths.mjs';
import { runPlaywright } from '../utils/execution/run-playwright.mjs';
import { readReport } from '../utils/reporting/parse-playwright-json.mjs';
import { buildSummary } from '../utils/reporting/build-summary.mjs';
import { writeReport } from '../utils/reporting/write-report.mjs';
import { generateAllureReport } from '../utils/reporting/generate-allure.mjs';
import { writeJsonAtomic } from '../utils/io/write-json-atomic.mjs';

loadDotEnv();
const config = getRuntimeConfig();
const argv = process.argv.slice(2);

const projectArg = argv.find((a) => a.startsWith('--project'));
const project = projectArg?.includes('=') ? projectArg.split('=')[1] : projectArg ? argv[argv.indexOf(projectArg) + 1] : 'chromium';
const passthrough = argv.filter((a, i) => a !== projectArg && !(projectArg && !projectArg.includes('=') && argv[i - 1] === projectArg));

console.log(`[qa] run ${config.runId} → ${config.baseURL} (project: ${project})`);
const startedAt = new Date().toISOString();
const result = await runPlaywright({
  root: config.paths.root,
  project,
  extraArgs: passthrough,
  outputFile: config.paths.reportJson,
  runId: config.runId,
  keepConfigReporters: true,
});

let exitCode = result.exitCode;
try {
  const initial = await readReport(config.paths.reportJson, { root: config.paths.root });
  const commands = [{ purpose: 'test run', command: result.command, exitCode: result.exitCode }];
  await writeJsonAtomic(join(config.paths.runDir, 'run.json'), {
    runId: config.runId, mode: 'run', baseURL: config.baseURL, project, args: passthrough, startedAt,
    finishedAt: new Date().toISOString(), commands, stats: initial.stats,
  });
  const summary = buildSummary({ runId: config.runId, baseURL: config.baseURL, initial, commands });
  const paths = await writeReport(config.paths.runDir, summary);
  for (const message of initial.globalErrors) console.error(`[qa] global error: ${message.split('\n')[0]}`);
  if (summary.final.total === 0) console.error('[qa] no tests were executed for this scope (empty tests/specs or nothing matched).');
  console.log(`[qa] passed ${summary.final.passed} · failed ${summary.final.failed} · flaky ${summary.final.flaky} · skipped ${summary.final.skipped}`);
  console.log(`[qa] summary: ${paths.markdown}`);
  console.log(`[qa] html report: npx playwright show-report ${config.paths.htmlReport}`);
  await buildAllure();
  if (summary.final.failed > 0) {
    console.log(`[qa] ${summary.final.failed} failure(s). To classify and heal eligible locator failures: npm run test:heal -- ${passthrough.join(' ')}`.trimEnd());
  }
} catch (error) {
  console.error(`[qa] ${error.message}`);
  exitCode = 2;
}

/** Allure is a secondary view of the same run: a failure here is reported but never changes the exit code. */
async function buildAllure() {
  try {
    const { reportDir } = await generateAllureReport({
      root: config.paths.root,
      resultsDir: config.paths.allureResults,
      reportDir: config.paths.allureReport,
      name: `QA run ${config.runId}`,
    });
    console.log(`[qa] allure report: ${reportDir} (open: npm run report:allure:open)`);
  } catch (error) {
    console.error(`[qa] allure report not generated: ${error.message.split('\n')[0]}`);
  }
}

const pruned = await pruneRuns(config.paths.runsDir, config.runRetention);
if (pruned.length > 0) console.log(`[qa] retention: removed ${pruned.length} old run(s) (RUN_RETENTION=${config.runRetention})`);
process.exit(exitCode);
