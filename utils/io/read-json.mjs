import { readFile } from 'node:fs/promises';

/**
 * Error raised when a JSON document cannot be read or parsed.
 * Carries the offending path so callers can produce actionable diagnostics.
 */
export class JsonReadError extends Error {
  /**
   * @param {string} message
   * @param {{ path?: string, cause?: unknown }} [details]
   */
  constructor(message, details = {}) {
    super(message, { cause: details.cause });
    this.name = 'JsonReadError';
    this.path = details.path;
  }
}

/**
 * Parse a JSON string, raising a JsonReadError with context instead of a bare SyntaxError.
 * @param {string} text
 * @param {string} [label] Human-readable source name used in error messages.
 * @returns {unknown}
 */
export function parseJson(text, label = 'input') {
  if (typeof text !== 'string') {
    throw new JsonReadError(`Expected JSON text for ${label}, received ${typeof text}.`);
  }
  if (text.trim() === '') {
    throw new JsonReadError(`JSON ${label} is empty.`);
  }
  try {
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (cause) {
    throw new JsonReadError(`Malformed JSON in ${label}: ${cause.message}`, { cause });
  }
}

/**
 * Read and parse a JSON file.
 * @param {string} path
 * @param {{ optional?: boolean }} [options] When optional, a missing file resolves to undefined.
 * @returns {Promise<any>}
 */
export async function readJson(path, { optional = false } = {}) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (cause) {
    if (optional && cause.code === 'ENOENT') return undefined;
    throw new JsonReadError(`Cannot read JSON file ${path}: ${cause.message}`, { path, cause });
  }
  try {
    return parseJson(text, path);
  } catch (error) {
    error.path = path;
    throw error;
  }
}
