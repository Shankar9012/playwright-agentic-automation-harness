import { checkModuleSyntax, isLiteral, splitStatements, tokenize } from './js-source.mjs';

/**
 * Healing patch validator. A healing patch may only replace the locator expression of a
 * locator definition (`this.x = page.getBy...(...)`, `const x = page.locator(...)` or
 * `return this.page.getBy...(...)`) inside an authorized test or Page Object file.
 * It works on an allow-list grammar, not a deny-list: anything that is not provably a locator
 * change is rejected. Defense-in-depth invariants then re-check assertions, skips, imports and
 * non-locator literals across the whole file.
 */

/** Files the healer may edit (repo-relative, POSIX separators). */
export const HEALABLE_PATH = /^tests\/(pages|specs|faults)\/[\w./-]+\.m?js$/;

export const LOCATOR_METHODS = new Set([
  'locator', 'getByRole', 'getByText', 'getByLabel', 'getByPlaceholder', 'getByAltText',
  'getByTitle', 'getByTestId', 'frameLocator', 'contentFrame', 'filter', 'and', 'or',
  'first', 'last', 'nth',
]);
const POSITIONAL_METHODS = new Set(['first', 'last', 'nth']);
const OPTION_KEYS = new Set([
  'name', 'exact', 'hasText', 'hasNotText', 'has', 'hasNot', 'checked', 'pressed', 'expanded',
  'selected', 'disabled', 'level', 'includeHidden', 'visible',
]);
/** Identifiers whose count must never increase in a healing patch. */
const GUARDED_IDENTIFIERS = [
  'expect', 'skip', 'only', 'fixme', 'fail', 'slow', 'waitForTimeout', 'setTimeout', 'pause',
  'force', 'timeout', 'try', 'catch', 'eval', 'Function', 'evaluate', 'route', 'fulfill',
];

/**
 * @typedef {{ code: string, detail: string, line?: number, before?: string, after?: string }} Violation
 * @typedef {{ lhs: string, line: number, before: string, after: string }} LocatorChange
 * @typedef {{ ok: boolean, verdict: 'ACCEPTED' | 'REJECTED', violations: Violation[],
 *   changes: LocatorChange[], degraded: string[] }} PatchVerdict
 */

/**
 * Normalize a path to repo-relative POSIX form for policy checks.
 * @param {string} filePath
 */
export function toPosixRelative(filePath) {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

/** @param {string} filePath */
export function isHealablePath(filePath) {
  const rel = toPosixRelative(filePath);
  return HEALABLE_PATH.test(rel) && !rel.split('/').includes('..');
}

/**
 * Longest-common-subsequence diff over statement texts.
 * @param {string[]} a
 * @param {string[]} b
 * @returns {{ removed: number[], added: number[] }} indexes into a / b that are not shared
 */
function diffSequences(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = new Uint32Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] = a[i] === b[j]
        ? table[(i + 1) * cols + j + 1] + 1
        : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
    }
  }
  const removed = [];
  const added = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i += 1; j += 1; }
    else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) removed.push(i++);
    else added.push(j++);
  }
  while (i < a.length) removed.push(i++);
  while (j < b.length) added.push(j++);
  return { removed, added };
}

/**
 * Recursive-descent matcher for the locator expression grammar.
 * Returns the index after the expression, or throws with a reason.
 * @param {import('./js-source.mjs').Token[]} t
 * @param {number} start
 * @param {Set<string>} knownIdents identifiers allowed as the expression root
 * @param {{ positional: number }} stats
 */
function matchLocatorExpression(t, start, knownIdents, stats) {
  let i = start;
  const expect = (value) => {
    if (t[i]?.value !== value) throw new Error(`expected "${value}" but found "${t[i]?.value ?? 'end'}"`);
    i += 1;
  };

  if (t[i]?.type !== 'ident') throw new Error('locator expression must start with an identifier');
  // Root: identifier path such as `page`, `this.page` or `this.root`, without calls.
  const rootParts = [t[i].value];
  i += 1;
  while (t[i]?.value === '.' && t[i + 1]?.type === 'ident' && t[i + 2]?.value !== '(') {
    rootParts.push(t[i + 1].value);
    i += 2;
  }
  for (const part of rootParts) {
    if (part !== 'this' && !knownIdents.has(part)) {
      throw new Error(`root identifier "${part}" does not exist in the original file`);
    }
  }

  let calls = 0;
  while (t[i]?.value === '.') {
    const method = t[i + 1];
    if (method?.type !== 'ident' || !LOCATOR_METHODS.has(method.value)) {
      throw new Error(`"${method?.value}" is not an allowed locator method`);
    }
    if (POSITIONAL_METHODS.has(method.value)) stats.positional += 1;
    i += 2;
    expect('(');
    i = matchArguments(t, i, knownIdents, stats);
    expect(')');
    calls += 1;
  }
  if (calls === 0) throw new Error('locator expression must call at least one locator method');
  return i;
}

/** @returns {number} index of the closing `)` */
function matchArguments(t, start, knownIdents, stats) {
  let i = start;
  while (t[i] && t[i].value !== ')') {
    i = matchValue(t, i, knownIdents, stats);
    if (t[i]?.value === ',') i += 1;
    else if (t[i]?.value !== ')') throw new Error(`unexpected "${t[i]?.value}" in arguments`);
  }
  return i;
}

function matchValue(t, start, knownIdents, stats) {
  const tok = t[start];
  if (!tok) throw new Error('unexpected end of expression');
  if (tok.type === 'template') {
    if (tok.value.includes('${')) throw new Error('template literals with interpolation are not allowed');
    return start + 1;
  }
  if (isLiteral(tok)) return start + 1;
  if (tok.value === 'true' || tok.value === 'false') return start + 1;
  if (tok.value === '{') {
    let i = start + 1;
    while (t[i] && t[i].value !== '}') {
      const key = t[i];
      const keyName = key.type === 'string' ? key.value.slice(1, -1) : key.value;
      if (!OPTION_KEYS.has(keyName)) throw new Error(`option "${keyName}" is not an allowed locator option`);
      if (t[i + 1]?.value !== ':') throw new Error(`expected ":" after option "${keyName}"`);
      i = matchValue(t, i + 2, knownIdents, stats);
      if (t[i]?.value === ',') i += 1;
      else if (t[i]?.value !== '}') throw new Error(`unexpected "${t[i]?.value}" in options`);
    }
    if (!t[i]) throw new Error('unterminated options object');
    return i + 1;
  }
  if (tok.type === 'ident') {
    // Nested locator (for has/hasNot/and/or) or a plain reference to an existing identifier path.
    const save = { positional: stats.positional };
    try {
      return matchLocatorExpression(t, start, knownIdents, stats);
    } catch {
      stats.positional = save.positional;
      let i = start;
      if (tok.value !== 'this' && !knownIdents.has(tok.value)) {
        throw new Error(`identifier "${tok.value}" does not exist in the original file`);
      }
      i += 1;
      while (t[i]?.value === '.' && t[i + 1]?.type === 'ident' && t[i + 2]?.value !== '(') i += 2;
      return i;
    }
  }
  throw new Error(`"${tok.value}" is not allowed in a locator expression`);
}

/**
 * Parse a statement as a locator definition.
 * @param {import('./js-source.mjs').Statement} stmt
 * @param {string} source
 * @param {Set<string>} knownIdents
 * @returns {{ lhs: string, expr: string, positional: number } | { error: string }}
 */
function parseLocatorDefinition(stmt, source, knownIdents) {
  const t = stmt.tokens;
  let exprStart;
  let lhs;
  if (t[0]?.value === 'return') {
    lhs = 'return';
    exprStart = 1;
  } else {
    const eq = t.findIndex((tok) => tok.value === '=');
    if (eq <= 0) return { error: 'statement is not a locator assignment' };
    const lhsTokens = t.slice(0, eq);
    const declaration = ['const', 'let', 'var'].includes(lhsTokens[0].value) ? 1 : 0;
    const path = lhsTokens.slice(declaration);
    const validPath = path.length > 0 && path.every((tok, idx) => (idx % 2 === 0 ? tok.type === 'ident' : tok.value === '.'))
      && path.length % 2 === 1;
    if (!validPath) return { error: 'assignment target is not a simple identifier or property path' };
    lhs = lhsTokens.map((tok) => tok.value).join(' ');
    exprStart = eq + 1;
  }
  const stats = { positional: 0 };
  let end;
  try {
    end = matchLocatorExpression(t, exprStart, knownIdents, stats);
  } catch (error) {
    return { error: `not a pure locator expression: ${error.message}` };
  }
  const rest = t.slice(end).map((tok) => tok.value);
  if (!(rest.length === 0 || (rest.length === 1 && rest[0] === ';'))) {
    return { error: `unexpected trailing code "${rest.join(' ')}"` };
  }
  const expr = source.slice(t[exprStart].start, t[end - 1].end);
  return { lhs, expr, positional: stats.positional };
}

/**
 * Non-locator literals (expected values, titles, URLs...) as a sorted multiset, so a patch
 * cannot quietly alter an expected value anywhere in the file.
 * @param {import('./js-source.mjs').Token[]} tokens
 */
function nonLocatorLiterals(tokens) {
  /** @type {(string | null)[]} name of the call owning each open paren */
  const calls = [];
  const literals = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (tok.value === '(') {
      const owner = tokens[i - 1]?.type === 'ident' ? tokens[i - 1].value : null;
      calls.push(owner);
    } else if (tok.value === ')') {
      calls.pop();
    } else if (isLiteral(tok) || tok.value === 'true' || tok.value === 'false') {
      const owner = calls.at(-1);
      if (!owner || !LOCATOR_METHODS.has(owner)) literals.push(tok.value);
    }
  }
  return literals.sort();
}

/** @param {import('./js-source.mjs').Token[]} tokens */
function countIdentifiers(tokens) {
  const counts = new Map();
  for (const tok of tokens) {
    if (tok.type === 'ident') counts.set(tok.value, (counts.get(tok.value) ?? 0) + 1);
  }
  return counts;
}

const sameArray = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Validate a healing patch for one file.
 * @param {{ filePath: string, before: string, after: string, maxStatements?: number }} input
 * @returns {PatchVerdict}
 */
export function validateHealingPatch({ filePath, before, after, maxStatements = 1 }) {
  /** @type {Violation[]} */
  const violations = [];
  /** @type {LocatorChange[]} */
  const changes = [];
  /** @type {string[]} */
  const degraded = [];
  const result = () => ({
    ok: violations.length === 0,
    verdict: violations.length === 0 ? 'ACCEPTED' : 'REJECTED',
    violations,
    changes,
    degraded,
  });

  if (!isHealablePath(filePath)) {
    violations.push({
      code: 'OUT_OF_SCOPE_FILE',
      detail: `${filePath} is not an authorized test or Page Object file (allowed: ${HEALABLE_PATH}).`,
    });
    return result();
  }
  if (typeof before !== 'string' || typeof after !== 'string') {
    violations.push({ code: 'INVALID_INPUT', detail: 'before and after source must be strings.' });
    return result();
  }
  if (before === after) {
    violations.push({ code: 'NO_CHANGE', detail: 'The patched file is identical to the original.' });
    return result();
  }

  const syntax = checkModuleSyntax(after);
  if (!syntax.ok) {
    violations.push({ code: 'SYNTAX_ERROR', detail: syntax.error });
    return result();
  }

  let beforeTokens;
  let afterTokens;
  try {
    beforeTokens = tokenize(before);
    afterTokens = tokenize(after);
  } catch (error) {
    violations.push({ code: 'SYNTAX_ERROR', detail: error.message });
    return result();
  }

  const beforeStatements = splitStatements(beforeTokens);
  const afterStatements = splitStatements(afterTokens);
  const { removed, added } = diffSequences(
    beforeStatements.map((s) => s.text),
    afterStatements.map((s) => s.text),
  );

  if (removed.length !== added.length) {
    violations.push({
      code: 'STRUCTURE_CHANGED',
      detail: `Patch removed ${removed.length} and added ${added.length} statements; healing may only rewrite existing locator definitions.`,
    });
  } else if (removed.length > maxStatements) {
    violations.push({
      code: 'TOO_MANY_STATEMENTS',
      detail: `Patch changes ${removed.length} statements; at most ${maxStatements} per healing attempt.`,
    });
  } else {
    const knownIdents = new Set(beforeTokens.filter((tok) => tok.type === 'ident').map((tok) => tok.value));
    removed.forEach((beforeIdx, k) => {
      const oldStmt = beforeStatements[beforeIdx];
      const newStmt = afterStatements[added[k]];
      const oldDef = parseLocatorDefinition(oldStmt, before, knownIdents);
      const newDef = parseLocatorDefinition(newStmt, after, knownIdents);
      const context = { line: newStmt.startLine, before: oldStmt.text, after: newStmt.text };
      if (/\bexpect\b/.test(oldStmt.text) || /\bexpect\b/.test(newStmt.text)) {
        violations.push({ code: 'ASSERTION_TOUCHED', detail: 'A statement containing expect() was changed.', ...context });
        return;
      }
      if ('error' in oldDef) {
        violations.push({ code: 'NON_LOCATOR_STATEMENT_CHANGED', detail: `Original statement rejected: ${oldDef.error}.`, ...context });
        return;
      }
      if ('error' in newDef) {
        violations.push({ code: 'NON_LOCATOR_STATEMENT_CHANGED', detail: `Patched statement rejected: ${newDef.error}.`, ...context });
        return;
      }
      if (oldDef.lhs !== newDef.lhs) {
        violations.push({ code: 'LOCATOR_TARGET_CHANGED', detail: `Definition target changed from "${oldDef.lhs}" to "${newDef.lhs}".`, ...context });
        return;
      }
      if (newDef.positional > oldDef.positional) degraded.push('POSITIONAL_LOCATOR_INTRODUCED');
      changes.push({ lhs: newDef.lhs, line: newStmt.startLine, before: oldDef.expr, after: newDef.expr });
    });
  }

  // Defense-in-depth invariants over the whole file.
  const expectStatements = (stmts) => stmts.filter((s) => /\bexpect\b/.test(s.text)).map((s) => s.text);
  if (!sameArray(expectStatements(beforeStatements), expectStatements(afterStatements))) {
    if (!violations.some((v) => v.code === 'ASSERTION_TOUCHED')) {
      violations.push({ code: 'ASSERTION_TOUCHED', detail: 'The set of expect() statements differs.' });
    }
  }
  const importStatements = (stmts) => stmts.filter((s) => /^(import|export)\b/.test(s.text) && /\bfrom\b/.test(s.text)).map((s) => s.text);
  if (!sameArray(importStatements(beforeStatements), importStatements(afterStatements))) {
    violations.push({ code: 'IMPORTS_CHANGED', detail: 'Import/export statements differ.' });
  }
  const beforeCounts = countIdentifiers(beforeTokens);
  const afterCounts = countIdentifiers(afterTokens);
  for (const name of GUARDED_IDENTIFIERS) {
    if ((afterCounts.get(name) ?? 0) > (beforeCounts.get(name) ?? 0)) {
      const code = ['skip', 'fixme', 'fail'].includes(name) ? 'SKIP_INTRODUCED'
        : name === 'only' ? 'ONLY_INTRODUCED' : 'FORBIDDEN_CONSTRUCT_INTRODUCED';
      violations.push({ code, detail: `Patch introduces "${name}".` });
    }
  }
  if (!sameArray(nonLocatorLiterals(beforeTokens), nonLocatorLiterals(afterTokens))) {
    violations.push({
      code: 'EXPECTED_LITERAL_CHANGED',
      detail: 'A literal outside a locator call (expected value, title, URL or test data) changed.',
    });
  }

  if (violations.length === 0 && changes.length === 0) {
    violations.push({ code: 'NO_LOCATOR_CHANGE', detail: 'No locator definition changed (formatting-only patch).' });
  }
  return result();
}
