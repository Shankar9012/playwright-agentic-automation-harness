import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { splitStatements, tokenize } from '../guardrails/js-source.mjs';
import { toPosixRelative } from '../guardrails/validate-healing-patch.mjs';
import { stripAnsi } from './classify-failure.mjs';

/**
 * Collects the evidence a healer needs for one failed test: artifact paths, the ARIA page
 * snapshot at failure time, the failing stack frames and the source location(s) where the
 * failing locator is defined.
 */

/** Attachment names produced by Playwright and by tests/fixtures/test.js. */
const SNAPSHOT_ATTACHMENTS = ['healing-aria-snapshot', 'error-context'];

/**
 * Extract the YAML ARIA snapshot from an error-context markdown file or a raw YAML attachment.
 * @param {string} content
 */
export function extractPageSnapshot(content) {
  const block = /# Page snapshot\s+```ya?ml\r?\n([\s\S]*?)```/.exec(content);
  if (block) return block[1].trim();
  return /^\s*-\s+\w+/.test(content) ? content.trim() : null;
}

/**
 * Stack frames that point into the project's test code.
 * @param {string | undefined} stack
 * @param {string} root
 */
export function testFrames(stack, root) {
  const frames = [];
  for (const match of stripAnsi(stack ?? '').matchAll(/(?:at |\()((?:[A-Za-z]:)?[^\s():]+):(\d+):(\d+)/g)) {
    const rel = toPosixRelative(relative(root, resolve(root, match[1])));
    if (rel.startsWith('tests/') && !frames.some((f) => f.file === rel && f.line === Number(match[2]))) {
      frames.push({ file: rel, line: Number(match[2]), column: Number(match[3]) });
    }
  }
  return frames;
}

/**
 * Normalize a locator chain for comparison: drop the root object (page, this.page, this.root),
 * unify quotes and whitespace.
 * @param {import('../guardrails/js-source.mjs').Token[]} tokens
 */
function chainSignature(tokens) {
  let start = 0;
  // Skip root identifier path: ident (. ident)* until an ident followed by "(".
  while (start + 1 < tokens.length && !(tokens[start].type === 'ident' && tokens[start + 1].value === '(')) start += 1;
  return tokens.slice(start).map((t) => (t.type === 'string' ? `'${t.value.slice(1, -1).replace(/\\'/g, "'")}'` : t.value))
    .join('').replace(/\s+/g, '');
}

/**
 * List JavaScript files under the given repo-relative directories.
 * @param {string} root
 * @param {string[]} dirs
 */
export async function listSourceFiles(root, dirs = ['tests/pages', 'tests/specs', 'tests/faults']) {
  const files = [];
  for (const dir of dirs) {
    const absolute = join(root, dir);
    if (!existsSync(absolute)) continue;
    for (const entry of await readdir(absolute, { recursive: true, withFileTypes: true })) {
      if (entry.isFile() && /\.m?js$/.test(entry.name)) {
        files.push(toPosixRelative(relative(root, join(entry.parentPath ?? entry.path, entry.name))));
      }
    }
  }
  return files;
}

/**
 * Find statements that define the failing locator.
 * @param {string | null} locatorDescription Playwright's description, e.g. getByRole('button', { name: 'X' })
 * @param {string[]} files repo-relative files to search
 * @param {string} root
 * @returns {Promise<{ file: string, line: number, statement: string }[]>}
 */
export async function findLocatorDefinitions(locatorDescription, files, root) {
  if (!locatorDescription) return [];
  let wanted;
  try {
    wanted = chainSignature(tokenize(locatorDescription));
  } catch {
    return [];
  }
  const matches = [];
  for (const file of files) {
    let source;
    try {
      source = await readFile(join(root, file), 'utf8');
    } catch {
      continue;
    }
    let statements;
    try {
      statements = splitStatements(tokenize(source));
    } catch {
      continue;
    }
    for (const stmt of statements) {
      const eq = stmt.tokens.findIndex((t) => t.value === '=');
      const exprTokens = stmt.tokens[0]?.value === 'return' ? stmt.tokens.slice(1)
        : eq > 0 ? stmt.tokens.slice(eq + 1) : null;
      if (!exprTokens) continue;
      const signature = chainSignature(exprTokens.filter((t) => t.value !== ';'));
      if (signature === wanted || (wanted.length > 8 && signature.endsWith(wanted))) {
        matches.push({ file, line: stmt.startLine, statement: source.slice(stmt.tokens[0].start, stmt.tokens.at(-1).end) });
      }
    }
  }
  // Prefer Page Object definitions: they are the single source of truth for locators.
  return matches.sort((a, b) => Number(b.file.startsWith('tests/pages/')) - Number(a.file.startsWith('tests/pages/')));
}

/**
 * @typedef {object} Diagnostics
 * @property {string | null} pageSnapshot
 * @property {string | null} snapshotSource attachment the snapshot came from
 * @property {{ screenshot: string[], trace: string[], video: string[], errorContext: string[] }} evidence repo-relative paths
 * @property {{ file: string, line: number, column: number }[]} frames
 * @property {{ file: string, line: number, statement: string }[]} definitions
 */

/**
 * Collect diagnostics for one failed result.
 * @param {{ errors: { message?: string, stack?: string }[], attachments: { name: string, path?: string, body?: string, contentType?: string }[] }} failure
 * @param {{ root: string, locator: string | null }} options
 * @returns {Promise<Diagnostics>}
 */
export async function collectDiagnostics(failure, { root, locator }) {
  const rel = (p) => toPosixRelative(relative(root, resolve(root, p)));
  const evidence = { screenshot: [], trace: [], video: [], errorContext: [] };
  let pageSnapshot = null;
  let snapshotSource = null;

  for (const name of SNAPSHOT_ATTACHMENTS) {
    if (pageSnapshot) break;
    for (const attachment of failure.attachments ?? []) {
      if (attachment.name !== name) continue;
      let content = null;
      if (attachment.body) content = Buffer.from(attachment.body, 'base64').toString('utf8');
      else if (attachment.path && existsSync(attachment.path)) content = await readFile(attachment.path, 'utf8');
      const snapshot = content ? extractPageSnapshot(content) : null;
      if (snapshot) { pageSnapshot = snapshot; snapshotSource = name; break; }
    }
  }

  for (const attachment of failure.attachments ?? []) {
    if (!attachment.path) continue;
    if (attachment.name === 'screenshot') evidence.screenshot.push(rel(attachment.path));
    else if (attachment.name === 'trace') evidence.trace.push(rel(attachment.path));
    else if (attachment.name === 'video') evidence.video.push(rel(attachment.path));
    else if (attachment.name === 'error-context') evidence.errorContext.push(rel(attachment.path));
  }

  const frames = (failure.errors ?? []).flatMap((e) => testFrames(e.stack, root));
  const definitions = await findLocatorDefinitions(locator, await listSourceFiles(root), root);
  return { pageSnapshot, snapshotSource, evidence, frames, definitions };
}
