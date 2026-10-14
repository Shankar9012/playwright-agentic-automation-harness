#!/usr/bin/env node
/**
 * Build the Allure report for a run from its raw results, and optionally serve it.
 * The report always goes to ./allure-report (one folder, replaced by each build); raw results
 * stay per run in artifacts/runs/<runId>/allure-results, so any kept run can be rebuilt.
 *
 *   node scripts/allure-report.mjs [--run <runId|latest>] [--open]
 *     exit 0 report written to allure-report/
 *     exit 2 missing results or Allure failure
 */
import process from 'node:process';
import { join, relative } from 'node:path';
import { getRuntimeConfig, loadDotEnv } from '../utils/config/runtime-config.mjs';
import { resolveRun } from '../utils/config/run-paths.mjs';
import { generateAllureReport, openAllureReport } from '../utils/reporting/generate-allure.mjs';

loadDotEnv();
const argv = process.argv.slice(2);
const runIdx = argv.indexOf('--run');
const requested = argv.find((a) => a.startsWith('--run='))?.slice(6) ?? (runIdx >= 0 ? argv[runIdx + 1] : undefined);

try {
  const config = getRuntimeConfig();
  const { root } = config.paths;
  const { runId, runDir } = await resolveRun(config.paths.runsDir, requested);
  const { reportDir } = await generateAllureReport({
    root,
    resultsDir: join(runDir, 'allure-results'),
    reportDir: config.paths.allureReport,
    name: `QA run ${runId}`,
  });
  console.log(`[allure] ${relative(root, reportDir)}`);
  if (argv.includes('--open')) await openAllureReport(root, reportDir);
} catch (error) {
  console.error(`[allure] ${error.message}`);
  process.exit(2);
}
