#!/usr/bin/env node
/**
 * Verify a healing repair and keep or revert it.
 *
 *   Verify an applied repair (scope + locator-only patch + Playwright rerun):
 *     node scripts/validate-healing.mjs --run <runId|latest> --item <itemId> [--diagnosis "..."]
 *       exit 0  HEALED (patch kept)       exit 1  FAILED_RERUN (files restored)
 *       exit 3  REJECTED (files restored) exit 2  infrastructure / usage error
 *
 *   Give up on an item (target identity could not be confirmed); restores the files:
 *     node scripts/validate-healing.mjs --run <runId> --item <itemId> --abandon "reason"
 *
 *   Check a proposed patch without running tests (no state change):
 *     node scripts/validate-healing.mjs --check --file <path> --before <original-copy>
 */
import process from 'node:process';
import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { getRuntimeConfig, loadDotEnv } from '../utils/config/runtime-config.mjs';
import { resolveRun } from '../utils/config/run-paths.mjs';
import { runPlaywright } from '../utils/execution/run-playwright.mjs';
import { abandonHealingItem, verifyHealingItem } from '../utils/healing/validate-healing.mjs';
import { validateHealingPatch, toPosixRelative } from '../utils/guardrails/validate-healing-patch.mjs';
import { OUTCOME } from '../utils/healing/record-healing.mjs';

loadDotEnv();
const argv = process.argv.slice(2);
const option = (name) => {
  const inline = argv.find((a) => a.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const idx = argv.indexOf(name);
  return idx >= 0 ? argv[idx + 1] : undefined;
};
const log = (msg) => console.log(`[validate-healing] ${msg}`);

async function main() {
  const config = getRuntimeConfig();
  const { root, healingLogDir } = config.paths;

  if (argv.includes('--check')) {
    const file = option('--file');
    const beforePath = option('--before');
    if (!file || !beforePath) throw new Error('--check requires --file <path> and --before <original-copy>.');
    const verdict = validateHealingPatch({
      filePath: toPosixRelative(relative(root, resolve(root, file))),
      before: await readFile(resolve(root, beforePath), 'utf8'),
      after: await readFile(resolve(root, file), 'utf8'),
    });
    console.log(JSON.stringify(verdict, null, 2));
    return verdict.ok ? 0 : 3;
  }

  const itemId = option('--item');
  if (!itemId) throw new Error('Missing --item <itemId>. See the repair queue: node scripts/test-with-healing.mjs --status');
  const { runId, runDir } = await resolveRun(config.paths.runsDir, option('--run'));

  const abandonReason = option('--abandon');
  if (abandonReason !== undefined) {
    const record = await abandonHealingItem({ root, runDir, runId, itemId, healingLogDir, reason: abandonReason || 'No reason given.' });
    log(`${itemId} ABANDONED; restored ${record.verification.restored.join(', ') || 'nothing'}`);
    return 1;
  }

  const result = await verifyHealingItem({
    root, runDir, runId, itemId, healingLogDir,
    diagnosis: option('--diagnosis') ?? null,
    runner: (opts) => runPlaywright({ ...opts, stdio: 'pipe' }),
    log,
  });
  const v = result.verification;
  log(`${itemId} → ${result.outcome} (stage: ${v.stage})`);
  for (const change of result.changes) log(`  ${change.file}:${change.line}  ${change.before}  →  ${change.after}`);
  for (const violation of v.violations ?? []) log(`  violation ${violation.code}: ${violation.detail}`);
  for (const run of v.runs ?? []) log(`  rerun ${run.scope}: exit ${run.exitCode} ${run.stats ? JSON.stringify({ passed: run.stats.expected, failed: run.stats.unexpected, flaky: run.stats.flaky }) : run.error ?? ''}`);
  if (v.restored?.length) log(`  restored: ${v.restored.join(', ')}`);
  if (v.degraded?.length) log(`  WARNING degraded heal: ${v.degraded.join(', ')} — flag for human confirmation`);
  return { [OUTCOME.HEALED]: 0, [OUTCOME.FAILED_RERUN]: 1, [OUTCOME.REJECTED]: 3 }[result.outcome] ?? 1;
}

try {
  process.exit(await main());
} catch (error) {
  console.error(`[validate-healing] ${error.message}`);
  process.exit(2);
}
