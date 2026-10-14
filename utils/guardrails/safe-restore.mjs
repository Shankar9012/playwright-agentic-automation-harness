import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { readJson } from '../io/read-json.mjs';
import { withFsRetry, writeJsonAtomic } from '../io/write-json-atomic.mjs';
import { toPosixRelative } from './validate-healing-patch.mjs';

/**
 * File-scoped backup and restore for healing attempts. Only the files a repair touches are
 * backed up and restored; nothing here ever runs git, so unrelated working-tree changes are
 * never discarded. A journal records pending restores so a crashed attempt can be recovered.
 */

/** @param {string | Buffer} content */
export const sha256 = (content) => createHash('sha256').update(content).digest('hex');

/** @param {string} file */
export async function hashFile(file) {
  return sha256(await readFile(file));
}

/**
 * @typedef {{ file: string, backup: string, sha256: string, createdAt: string }} BackupRecord
 */

/**
 * Copy a file byte-for-byte into the backup directory and journal it.
 * @param {{ root: string, file: string, backupDir: string }} options
 * @returns {Promise<BackupRecord>}
 */
export async function backupFile({ root, file, backupDir }) {
  const absolute = resolve(root, file);
  const rel = toPosixRelative(relative(root, absolute));
  if (rel.startsWith('../')) throw new Error(`Refusing to back up ${file}: outside the project root.`);
  const backup = join(backupDir, rel.replace(/\//g, '__'));
  await mkdir(dirname(backup), { recursive: true });
  await withFsRetry(() => copyFile(absolute, backup));
  const record = { file: rel, backup: toPosixRelative(relative(root, backup)), sha256: await hashFile(backup), createdAt: new Date().toISOString() };
  if (record.sha256 !== await hashFile(absolute)) {
    throw new Error(`Backup of ${rel} does not match the original; aborting before any change.`);
  }
  await journal(backupDir, (entries) => [...entries.filter((e) => e.file !== rel), record]);
  return record;
}

/**
 * Restore one file from its backup and verify the hash.
 * @param {{ root: string, record: BackupRecord, backupDir: string }} options
 */
export async function restoreFile({ root, record, backupDir }) {
  const target = resolve(root, record.file);
  const backup = resolve(root, record.backup);
  await withFsRetry(() => copyFile(backup, target));
  const actual = await hashFile(target);
  if (actual !== record.sha256) {
    throw new Error(`Restore of ${record.file} failed verification (expected ${record.sha256}, got ${actual}).`);
  }
  await journal(backupDir, (entries) => entries.filter((e) => e.file !== record.file));
  return { file: record.file, sha256: actual };
}

/**
 * Remove a record from the journal once a change is accepted (the backup file is kept for audit).
 * @param {{ record: BackupRecord, backupDir: string }} options
 */
export async function commitFile({ record, backupDir }) {
  await journal(backupDir, (entries) => entries.filter((e) => e.file !== record.file));
}

/**
 * Restore every journaled file under a backup directory (crash recovery).
 * @param {{ root: string, backupDir: string }} options
 */
export async function restorePending({ root, backupDir }) {
  const entries = (await readJson(join(backupDir, 'journal.json'), { optional: true })) ?? [];
  const restored = [];
  for (const record of entries) restored.push(await restoreFile({ root, record, backupDir }));
  return restored;
}

/** @param {string} backupDir @param {(entries: BackupRecord[]) => BackupRecord[]} update */
async function journal(backupDir, update) {
  const path = join(backupDir, 'journal.json');
  const entries = (await readJson(path, { optional: true })) ?? [];
  const next = update(entries);
  if (next.length === 0) await rm(path, { force: true });
  else await writeJsonAtomic(path, next);
}
