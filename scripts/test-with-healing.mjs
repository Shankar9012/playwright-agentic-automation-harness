#!/usr/bin/env node
/**
 * Healing workflow coordinator. Node cannot invoke a Claude Code subagent, so this script is the
 * deterministic half of a handshake with the Claude Code orchestrator (qaautomation agent):
 *
 *   Phase 1  node scripts/test-with-healing.mjs [playwright args]
 *            initial run (retries=0) → parse JSON → classify → back up targets →
 *            artifacts/runs/<runId>/repair-queue.json
 *            exit 0  all passed            exit 1  failures, nothing eligible for healing
 *            exit 2  infrastructure error  exit 42 repair queue needs the orchestrator
 *
 *   Phase 2  (Claude Code) the orchestrator delegates each QUEUED item to the self-healer agent,
 *            which edits the source and runs:
 *            node scripts/validate-healing.mjs --run <runId> --item <itemId> --diagnosis "..."
 *
 *   Phase 3  node scripts/test-with-healing.mjs --finalize --run <runId>
 *            reruns every initially failing test, builds the final report from real results
 *            exit 0  everything passes now  exit 1 unresolved failures remain
 *
 *   Status   node scripts/test-with-healing.mjs --status --run <runId|latest>
 */
import process from 'node:process';
import { join, relative } from 'node:path';
import { getRuntimeConfig, loadDotEnv } from '../utils/config/runtime-config.mjs';
import { pruneRuns, resolveRun } from '../utils/config/run-paths.mjs';
import { runPlaywright } from '../utils/execution/run-playwright.mjs';
import { readReport } from '../utils/reporting/parse-playwright-json.mjs';
import { buildSummary } from '../utils/reporting/build-summary.mjs';
import { writeReport } from '../utils/reporting/write-report.mjs';
import { generateAllureReport } from '../utils/reporting/generate-allure.mjs';
import { buildRepairQueue, readQueue } from '../utils/healing/repair-queue.mjs';
import { readHealingLog } from '../utils/healing/record-healing.mjs';
import { restorePending } from '../utils/guardrails/safe-restore.mjs';
import { readJson } from '../utils/io/read-json.mjs';
import { writeJsonAtomic } from '../utils/io/write-json-atomic.mjs';

const EXIT = Object.freeze({ PASSED: 0, FAILED: 1, INFRA: 2, QUEUE: 42 });

loadDotEnv();
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name) => {
  const inline = argv.find((a) => a.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const idx = argv.indexOf(name);
  return idx >= 0 ? argv[idx + 1] : undefined;
};

const log = (msg) => console.log(`[heal] ${msg}`);

async function phaseInitial() {
  const config = getRuntimeConfig();
  const { root, runDir, reportJson } = config.paths;
  const projectArg = option('--project') ?? 'chromium';
  const passthrough = argv.filter((a, i) => !a.startsWith('--project') && argv[i - 1] !== '--project');

  log(`run ${config.runId} → ${config.baseURL} (initial run, retries=0)`);
  const startedAt = new Date().toISOString();
  const initialRun = await runPlaywright({
    root, project: projectArg, retries: 0, extraArgs: passthrough, outputFile: reportJson, runId: config.runId, keepConfigReporters: true,
  });
  const commands = [{ purpose: 'initial run (retries=0)', command: initialRun.command, exitCode: initialRun.exitCode }];

  let initial;
  try {
    initial = await readReport(reportJson, { root });
  } catch (error) {
    console.error(`[heal] ${error.message}`);
    return EXIT.INFRA;
  }

  const { queue, triage } = await buildRepairQueue({ root, runId: config.runId, runDir, parsed: initial });
  await writeJsonAtomic(join(runDir, 'run.json'), {
    runId: config.runId, mode: 'heal', baseURL: config.baseURL, project: projectArg, args: passthrough,
    startedAt, finishedAt: new Date().toISOString(), commands, stats: initial.stats, triage,
  });
  const summary = buildSummary({ runId: config.runId, baseURL: config.baseURL, initial, triage, queue, commands });
  await writeReport(runDir, summary);
  await pruneRuns(config.paths.runsDir, config.runRetention);
  // Allure shows the initial run only; the confirmation rerun result lives in summary.md.
  await generateAllureReport({
    root, resultsDir: config.paths.allureResults, reportDir: config.paths.allureReport, name: `QA run ${config.runId} (initial)`,
  }).then(({ reportDir }) => log(`allure report (initial run): ${relative(root, reportDir)}`))
    .catch((error) => log(`allure report not generated: ${error.message.split('\n')[0]}`));

  log(`initial: passed ${initial.stats.expected} · failed ${initial.stats.unexpected} · flaky ${initial.stats.flaky} · skipped ${initial.stats.skipped}`);
  for (const entry of triage) {
    log(`  ${entry.eligible ? 'ELIGIBLE ' : 'not eligible'} ${entry.category.padEnd(30)} ${entry.titlePath.join(' > ')} — ${entry.reason}`);
  }

  if (initial.globalErrors.length > 0 && initial.tests.length === 0) {
    console.error(`[heal] Playwright reported global errors and ran no tests:\n${initial.globalErrors.join('\n')}`);
    return EXIT.INFRA;
  }
  if (initial.stats.unexpected === 0) {
    log('all tests passed; nothing to heal.');
    return EXIT.PASSED;
  }
  if (queue.items.length === 0) {
    log('no failure is eligible for automatic locator repair. Report: ' + relative(root, join(runDir, 'summary.md')));
    return EXIT.FAILED;
  }

  log(`repair queue: ${queue.items.length} item(s) → ${relative(root, join(runDir, 'repair-queue.json'))}`);
  for (const item of queue.items) {
    log(`  ${item.itemId}  ${item.subtype}  ${item.locator ?? ''}  in ${item.allowedFiles.join(', ')}`);
  }
  log('ORCHESTRATOR ACTION REQUIRED (exit 42):');
  log(`  for each item: delegate to the self-healer agent, then run`);
  log(`    node scripts/validate-healing.mjs --run ${config.runId} --item <itemId> --diagnosis "<why>"`);
  log(`  finally: node scripts/test-with-healing.mjs --finalize --run ${config.runId}`);
  return EXIT.QUEUE;
}

async function phaseFinalize() {
  const config = getRuntimeConfig();
  const { root, healingLogDir } = config.paths;
  const { runId, runDir } = await resolveRun(config.paths.runsDir, option('--run'));

  // Crash recovery: restore any file whose healing attempt never completed.
  const queue = await readQueue(runDir).catch(() => ({ items: [] }));
  for (const item of queue.items.filter((i) => i.status === 'QUEUED')) {
    const restored = await restorePending({ root, backupDir: join(runDir, 'backups', item.itemId) });
    if (restored.length > 0) log(`restored unverified edits for pending item ${item.itemId}: ${restored.map((r) => r.file).join(', ')}`);
  }

  const run = await readJson(join(runDir, 'run.json'));
  const initial = await readReport(join(runDir, 'report.json'), { root });
  const failing = initial.tests.filter((t) => t.status === 'unexpected');
  const commands = [...(run.commands ?? [])];

  let final = null;
  if (failing.length > 0) {
    log(`confirmation rerun of ${failing.length} initially failing test(s)`);
    const rerun = await runPlaywright({
      root,
      targets: [...new Set(failing.map((t) => `${t.file}:${t.line}`))],
      project: run.project,
      retries: 0,
      outputFile: join(runDir, 'final.json'),
      runId,
    });
    commands.push({ purpose: 'confirmation rerun of initially failing tests', command: rerun.command, exitCode: rerun.exitCode });
    try {
      final = await readReport(join(runDir, 'final.json'), { root });
    } catch (error) {
      console.error(`[heal] confirmation rerun produced no usable report: ${error.message}`);
      return EXIT.INFRA;
    }
    if (final.stats.total === 0) {
      console.error(`[heal] confirmation rerun executed no tests: ${final.globalErrors.join(' ') || 'unknown reason'}`);
      return EXIT.INFRA;
    }
  }

  const healingRecords = await readHealingLog(healingLogDir, runId);
  const summary = buildSummary({
    runId, baseURL: run.baseURL, initial, triage: run.triage ?? [], queue, healingRecords, final, commands,
  });
  await writeJsonAtomic(join(runDir, 'run.json'), { ...run, commands, finalizedAt: new Date().toISOString() });
  const paths = await writeReport(runDir, summary);
  log(`final: passed ${summary.final.passed} · failed ${summary.final.failed} · healed ${summary.healing.healed} · pending ${summary.healing.pending}`);
  log(`report: ${relative(root, paths.markdown)}`);
  return summary.exitCode === 0 ? EXIT.PASSED : EXIT.FAILED;
}

async function phaseStatus() {
  const config = getRuntimeConfig();
  const { runId, runDir } = await resolveRun(config.paths.runsDir, option('--run'));
  const queue = await readQueue(runDir);
  log(`run ${runId}: ${queue.items.length} item(s)`);
  for (const item of queue.items) log(`  ${item.itemId}  ${item.status.padEnd(12)} ${item.locator ?? ''}  (${item.allowedFiles.join(', ')})`);
  return queue.items.some((i) => i.status === 'QUEUED') ? EXIT.QUEUE : EXIT.PASSED;
}

try {
  const code = flag('--finalize') ? await phaseFinalize() : flag('--status') ? await phaseStatus() : await phaseInitial();
  process.exit(code);
} catch (error) {
  console.error(`[heal] ${error.stack ?? error.message}`);
  process.exit(EXIT.INFRA);
}
