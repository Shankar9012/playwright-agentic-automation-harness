import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const RETRYABLE = new Set(['EBUSY', 'EPERM', 'EACCES']);

/**
 * Run an fs operation, retrying briefly on transient Windows file-lock errors
 * (antivirus, editors and watchers commonly hold handles for a few milliseconds).
 * @template T
 * @param {() => Promise<T>} operation
 * @param {number} [attempts]
 * @returns {Promise<T>}
 */
export async function withFsRetry(operation, attempts = 4) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!RETRYABLE.has(error.code) || attempt >= attempts) throw error;
      await delay(100 * attempt);
    }
  }
}

/**
 * Write a value as pretty JSON atomically: write a temp file in the same directory, then rename.
 * Readers never observe a half-written document.
 * @param {string} path
 * @param {unknown} value
 */
export async function writeJsonAtomic(path, value) {
  if (value === undefined) {
    throw new TypeError(`Refusing to write undefined as JSON to ${path}.`);
  }
  const text = `${JSON.stringify(value, null, 2)}\n`;
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    await writeFile(tmp, text, 'utf8');
    await withFsRetry(() => rename(tmp, path));
  } catch (error) {
    await rm(tmp, { force: true });
    throw new Error(`Atomic JSON write to ${path} failed: ${error.message}`, { cause: error });
  }
}
