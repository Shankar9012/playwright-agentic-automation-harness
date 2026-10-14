import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readJson } from '../io/read-json.mjs';
import { writeJsonAtomic } from '../io/write-json-atomic.mjs';

/**
 * Persistent, auditable healing log: one JSON file per run in artifacts/healing-log/.
 * Every attempt is recorded, successful or not.
 */

export const OUTCOME = Object.freeze({
  HEALED: 'HEALED',
  FAILED_RERUN: 'FAILED_RERUN',
  REJECTED: 'REJECTED',
  ABANDONED: 'ABANDONED',
});

const REQUIRED_FIELDS = ['runId', 'itemId', 'testIds', 'originalStatus', 'category', 'outcome', 'filesChanged', 'evidence'];

/**
 * @typedef {object} HealingRecord
 * @property {string} runId
 * @property {string} itemId
 * @property {string[]} testIds
 * @property {string} originalStatus
 * @property {string} category
 * @property {string | null} subtype
 * @property {string | null} originalLocator
 * @property {string | null} replacementLocator
 * @property {string[]} filesChanged
 * @property {string | null} diagnosis
 * @property {keyof typeof OUTCOME} outcome
 * @property {object} verification
 * @property {object} evidence
 * @property {string} recordedAt
 */

/**
 * Append one record to the run's healing log.
 * @param {string} logDir
 * @param {Omit<HealingRecord, 'recordedAt'>} record
 * @returns {Promise<HealingRecord>}
 */
export async function recordHealing(logDir, record) {
  const missing = REQUIRED_FIELDS.filter((field) => record?.[field] === undefined);
  if (missing.length > 0) throw new Error(`Healing record is missing required fields: ${missing.join(', ')}.`);
  if (!Object.values(OUTCOME).includes(record.outcome)) throw new Error(`Unknown healing outcome "${record.outcome}".`);

  const path = join(logDir, `${record.runId}.json`);
  const existing = (await readJson(path, { optional: true })) ?? { runId: record.runId, records: [] };
  const entry = { ...record, recordedAt: new Date().toISOString() };
  existing.records.push(entry);
  await writeJsonAtomic(path, existing);
  return entry;
}

/**
 * Read the healing records for one run (empty when none were written).
 * @param {string} logDir
 * @param {string} runId
 * @returns {Promise<HealingRecord[]>}
 */
export async function readHealingLog(logDir, runId) {
  const log = await readJson(join(logDir, `${runId}.json`), { optional: true });
  return log?.records ?? [];
}

/**
 * List run IDs that have healing logs, newest first.
 * @param {string} logDir
 */
export async function listHealingRuns(logDir) {
  if (!existsSync(logDir)) return [];
  return (await readdir(logDir)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort().reverse();
}
