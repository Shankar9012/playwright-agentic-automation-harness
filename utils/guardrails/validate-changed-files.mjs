import { readFile } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';
import { checkModuleSyntax, splitStatements, tokenize } from './js-source.mjs';
import { toPosixRelative } from './validate-healing-patch.mjs';

/**
 * Lightweight checks for a single changed file. Used by the PostToolUse hook and by
 * `npm run check:syntax`. Never runs the E2E suite.
 */

const JS_EXTENSIONS = new Set(['.js', '.mjs']);
const IGNORED_DIRS = /^(node_modules|playwright-report|test-results|artifacts|\.playwright-mcp)\//;

/**
 * @typedef {{ severity: 'error' | 'warning', rule: string, message: string, line?: number }} Finding
 */

/**
 * Validate the content of one JavaScript file against harness conventions.
 * @param {string} relPath repo-relative path (any separator)
 * @param {string} source
 * @returns {Finding[]}
 */
export function validateSource(relPath, source) {
  const rel = toPosixRelative(relPath);
  /** @type {Finding[]} */
  const findings = [];

  const syntax = checkModuleSyntax(source);
  if (!syntax.ok) {
    findings.push({ severity: 'error', rule: 'syntax', message: syntax.error });
    return findings;
  }

  let tokens;
  try {
    tokens = tokenize(source);
  } catch (error) {
    findings.push({ severity: 'error', rule: 'syntax', message: error.message });
    return findings;
  }

  tokens.forEach((tok, i) => {
    const next = tokens[i + 1];
    const prev = tokens[i - 1];
    if (tok.value === 'require' && next?.value === '(' && prev?.value !== '.') {
      findings.push({ severity: 'error', rule: 'esm-only', line: tok.line, message: 'CommonJS require() is not allowed; use import.' });
    }
    if (tok.value === 'module' && next?.value === '.' && tokens[i + 2]?.value === 'exports') {
      findings.push({ severity: 'error', rule: 'esm-only', line: tok.line, message: 'module.exports is not allowed; use export.' });
    }
    if (tok.value === 'from' && next?.type === 'string') {
      const spec = next.value.slice(1, -1);
      if (/^\.{1,2}\//.test(spec) && !/\.(m?js|json)$/.test(spec)) {
        findings.push({ severity: 'error', rule: 'import-extension', line: tok.line, message: `Relative import "${spec}" must include its file extension.` });
      }
    }
  });

  if (rel.startsWith('tests/')) {
    tokens.forEach((tok, i) => {
      if (tok.value === 'only' && tokens[i - 1]?.value === '.' && ['test', 'describe'].includes(tokens[i - 2]?.value)) {
        findings.push({ severity: 'error', rule: 'no-only', line: tok.line, message: '.only() must not be committed; it silently narrows the suite.' });
      }
      if (tok.value === 'waitForTimeout') {
        findings.push({ severity: 'warning', rule: 'no-hard-wait', line: tok.line, message: 'Avoid waitForTimeout(); use web-first assertions or explicit waits.' });
      }
    });
  }

  if (rel.startsWith('tests/specs/')) {
    // Inline page locators inside expect() cannot be healed safely: the healer may never edit an
    // expect() statement. Keep locators in Page Objects.
    for (const stmt of splitStatements(tokens)) {
      if (/\bexpect \( page \. (locator|getBy\w+) \(/.test(stmt.text)) {
        findings.push({
          severity: 'warning',
          rule: 'pom-locators',
          line: stmt.startLine,
          message: 'Inline page locator inside expect(); move it to a Page Object so it stays healable.',
        });
      }
    }
  }
  return findings;
}

/**
 * Validate a file on disk. Non-JavaScript and generated files are skipped.
 * @param {string} filePath absolute or relative to `root`
 * @param {string} root project root
 * @returns {Promise<{ file: string, skipped: boolean, findings: Finding[] }>}
 */
export async function validateChangedFile(filePath, root) {
  const absolute = resolve(root, filePath);
  const rel = toPosixRelative(relative(root, absolute));
  if (rel.startsWith('../') || !JS_EXTENSIONS.has(extname(rel)) || IGNORED_DIRS.test(rel)) {
    return { file: rel, skipped: true, findings: [] };
  }
  let source;
  try {
    source = await readFile(absolute, 'utf8');
  } catch (error) {
    return { file: rel, skipped: false, findings: [{ severity: 'error', rule: 'read', message: `Cannot read file: ${error.message}` }] };
  }
  return { file: rel, skipped: false, findings: validateSource(rel, source) };
}

/**
 * Format findings for humans / hook feedback.
 * @param {{ file: string, findings: Finding[] }} result
 */
export function formatFindings({ file, findings }) {
  return findings
    .map((f) => `${f.severity.toUpperCase()} ${file}${f.line ? `:${f.line}` : ''} [${f.rule}] ${f.message}`)
    .join('\n');
}
