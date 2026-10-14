import { existsSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Helpers for locating and retaining run directories under artifacts/runs/<runId>/.
 */

const RUN_ID = /^\d{8}-\d{6}-[0-9a-f]{8}$/;

/**
 * Run IDs on disk, newest first.
 * @param {string} runsDir
 */
export async function listRuns(runsDir) {
  if (!existsSync(runsDir)) return [];
  const entries = await readdir(runsDir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory() && RUN_ID.test(e.name)).map((e) => e.name).sort().reverse();
}

/**
 * Resolve a run ID ('latest' or explicit) to its directory, with a clear error when missing.
 * @param {string} runsDir
 * @param {string | undefined} runId
 */
export async function resolveRun(runsDir, runId) {
  const id = !runId || runId === 'latest' ? (await listRuns(runsDir))[0] : runId;
  if (!id) throw new Error(`No runs found in ${runsDir}. Run "npm test" or "npm run test:heal" first.`);
  if (!RUN_ID.test(id)) throw new Error(`"${id}" is not a valid run ID (expected YYYYMMDD-HHMMSS-xxxxxxxx).`);
  const dir = join(runsDir, id);
  if (!existsSync(dir)) throw new Error(`Run ${id} does not exist in ${runsDir}.`);
  return { runId: id, runDir: dir };
}

/**
 * Retention policy: keep the newest `keep` run directories and delete older ones.
 * The healing log (artifacts/healing-log) is never pruned here; it is the audit trail.
 * @param {string} runsDir
 * @param {number} keep
 */
export async function pruneRuns(runsDir, keep) {
  if (!keep || keep < 1) return [];
  const removed = [];
  for (const id of (await listRuns(runsDir)).slice(keep)) {
    await rm(join(runsDir, id), { recursive: true, force: true });
    removed.push(id);
  }
  return removed;
}
