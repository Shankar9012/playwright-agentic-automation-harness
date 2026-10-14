#!/usr/bin/env node
/**
 * Rebuild the QA report for a run from its real artifacts: the initial Playwright JSON report,
 * the confirmation rerun (final.json) when present, the triage, the repair queue and the
 * healing log. Nothing is inferred beyond what those files record.
 *
 *   node scripts/build-report.mjs [--run <runId|latest>] [--strict]
 *     exit 0 report written (with --strict: 0 only when no unresolved failures remain)
 *     exit 2 missing or invalid artifacts
 */
import process from 'node:process';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { getRuntimeConfig, loadDotEnv } from '../utils/config/runtime-config.mjs';
import { resolveRun } from '../utils/config/run-paths.mjs';
import { readReport } from '../utils/reporting/parse-playwright-json.mjs';
import { buildSummary } from '../utils/reporting/build-summary.mjs';
import { writeReport, renderMarkdown } from '../utils/reporting/write-report.mjs';
import { readHealingLog } from '../utils/healing/record-healing.mjs';
import { readJson } from '../utils/io/read-json.mjs';

loadDotEnv();
const argv = process.argv.slice(2);
const runIdx = argv.indexOf('--run');
const requested = argv.find((a) => a.startsWith('--run='))?.slice(6) ?? (runIdx >= 0 ? argv[runIdx + 1] : undefined);

try {
  const config = getRuntimeConfig();
  const { root, healingLogDir } = config.paths;
  const { runId, runDir } = await resolveRun(config.paths.runsDir, requested);
  const run = (await readJson(join(runDir, 'run.json'), { optional: true })) ?? {};
  const initial = await readReport(join(runDir, 'report.json'), { root });
  const final = existsSync(join(runDir, 'final.json')) ? await readReport(join(runDir, 'final.json'), { root }) : null;
  const queue = await readJson(join(runDir, 'repair-queue.json'), { optional: true }) ?? null;
  const healingRecords = await readHealingLog(healingLogDir, runId);

  const summary = buildSummary({
    runId, baseURL: run.baseURL ?? config.baseURL, initial, triage: run.triage ?? [], queue, healingRecords, final, commands: run.commands ?? [],
  });
  const paths = await writeReport(runDir, summary);
  process.stdout.write(renderMarkdown(summary));
  console.log(`\n[report] ${relative(root, paths.markdown)}\n[report] ${relative(root, paths.json)}`);
  process.exit(argv.includes('--strict') ? summary.exitCode : 0);
} catch (error) {
  console.error(`[report] ${error.message}`);
  process.exit(2);
}
