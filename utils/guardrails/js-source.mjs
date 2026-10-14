import { spawnSync } from 'node:child_process';
import process from 'node:process';

/**
 * Lightweight JavaScript source tooling used by the guardrails. It is deliberately not a full
 * parser: it tokenizes well enough to tell code from strings, regexes and comments, which lets
 * the patch validator reason about statements and literals without a third-party dependency.
 */

/**
 * @typedef {'ident' | 'punct' | 'string' | 'template' | 'number' | 'regex'} TokenType
 * @typedef {{ type: TokenType, value: string, start: number, end: number, line: number }} Token
 */

const PUNCTUATORS = [
  '>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=',
  '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=',
  '%=', '&=', '|=', '^=', '**', '<<', '>>',
];
const KEYWORDS_BEFORE_EXPRESSION = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case',
  'do', 'else', 'yield', 'await',
]);

const isIdentStart = (ch) => /[A-Za-z_$\u0080-￿]/.test(ch);
const isIdentPart = (ch) => /[A-Za-z0-9_$\u0080-￿]/.test(ch);

/**
 * Decide whether a `/` starts a regex literal, based on the previous significant token.
 * @param {Token | undefined} prev
 */
function slashStartsRegex(prev) {
  if (!prev) return true;
  if (prev.type === 'ident') return KEYWORDS_BEFORE_EXPRESSION.has(prev.value);
  if (prev.type === 'punct') return ![')', ']', '}'].includes(prev.value);
  return false;
}

/**
 * Tokenize JavaScript source. Comments and whitespace are dropped.
 * @param {string} source
 * @returns {Token[]}
 */
export function tokenize(source) {
  /** @type {Token[]} */
  const tokens = [];
  let i = 0;
  let line = 1;
  const n = source.length;

  const push = (type, start, end, startLine) => {
    tokens.push({ type, value: source.slice(start, end), start, end, line: startLine });
  };
  const countLines = (start, end) => {
    for (let k = start; k < end; k += 1) if (source[k] === '\n') line += 1;
  };

  /** Scan a quoted string starting at `i`; returns end index (exclusive). */
  const scanQuoted = (from) => {
    const quote = source[from];
    let k = from + 1;
    while (k < n && source[k] !== quote) {
      if (source[k] === '\\') k += 1;
      else if (source[k] === '\n') throw new SyntaxError(`Unterminated string literal on line ${line}.`);
      k += 1;
    }
    if (k >= n) throw new SyntaxError(`Unterminated string literal on line ${line}.`);
    return k + 1;
  };

  /** Scan a regex literal starting at `from`; returns end index (exclusive, flags included). */
  const scanRegex = (from) => {
    let k = from + 1;
    let inClass = false;
    while (k < n) {
      const c = source[k];
      if (c === '\\') { k += 2; continue; }
      if (c === '\n') throw new SyntaxError(`Unterminated regex literal on line ${line}.`);
      if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) break;
      k += 1;
    }
    k += 1;
    while (k < n && /[a-z]/i.test(source[k])) k += 1;
    return k;
  };

  /** Scan a template literal (including nested `${}` expressions); returns end index. */
  const scanTemplate = (from) => {
    let k = from + 1;
    while (k < n) {
      const ch = source[k];
      if (ch === '\\') { k += 2; continue; }
      if (ch === '`') return k + 1;
      if (ch === '$' && source[k + 1] === '{') {
        let depth = 1;
        k += 2;
        let lastSignificant = '{';
        while (k < n && depth > 0) {
          const c = source[k];
          if (c === '"' || c === "'") { k = scanQuoted(k); lastSignificant = 'a'; continue; }
          if (c === '`') { k = scanTemplate(k); lastSignificant = 'a'; continue; }
          if (c === '/' && /[(,=:[!&|?{};+\-*%<>~^]/.test(lastSignificant)) {
            k = scanRegex(k);
            lastSignificant = 'a';
            continue;
          }
          if (!/\s/.test(c)) lastSignificant = c;
          if (c === '{') depth += 1;
          else if (c === '}') depth -= 1;
          k += 1;
        }
        continue;
      }
      k += 1;
    }
    throw new SyntaxError(`Unterminated template literal starting on line ${line}.`);
  };

  while (i < n) {
    const ch = source[i];
    if (ch === '\n') { line += 1; i += 1; continue; }
    if (/\s/.test(ch)) { i += 1; continue; }

    if (ch === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2);
      const end = close === -1 ? n : close + 2;
      countLines(i, end);
      i = end;
      continue;
    }
    const startLine = line;
    if (ch === '"' || ch === "'") {
      const end = scanQuoted(i);
      push('string', i, end, startLine);
      i = end;
      continue;
    }
    if (ch === '`') {
      const end = scanTemplate(i);
      push('template', i, end, startLine);
      countLines(i, end);
      i = end;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(source[i + 1] ?? ''))) {
      let k = i + 1;
      while (k < n && /[0-9A-Za-z_.]/.test(source[k])) k += 1;
      push('number', i, k, startLine);
      i = k;
      continue;
    }
    if (isIdentStart(ch) || (ch === '#' && isIdentStart(source[i + 1] ?? ''))) {
      let k = i + 1;
      while (k < n && isIdentPart(source[k])) k += 1;
      push('ident', i, k, startLine);
      i = k;
      continue;
    }
    if (ch === '/' && slashStartsRegex(tokens.at(-1))) {
      const k = scanRegex(i);
      push('regex', i, k, startLine);
      i = k;
      continue;
    }
    const punct = PUNCTUATORS.find((p) => source.startsWith(p, i)) ?? ch;
    push('punct', i, i + punct.length, startLine);
    i += punct.length;
  }
  return tokens;
}

/** @param {Token} t */
export const isLiteral = (t) => ['string', 'template', 'number', 'regex'].includes(t.type);

const OPENERS = { '(': ')', '[': ']', '{': '}' };
const CONTINUATION_START = new Set(['.', '?.', ')', ']', '}', ',', '=>', '&&', '||', '??', '+', '-', '*', '/', '?', ':', '=']);
const CONTINUATION_END = new Set([
  '.', '?.', '(', '[', '{', ',', '=>', '=', '&&', '||', '??', '+', '-', '*', '/', '?', ':', '!', '+=', '-=',
]);

/** Tokens after which `{` opens a block (function/control-flow body). */
const BLOCK_INTRODUCERS = new Set(['=>', ')', 'else', 'try', 'finally', 'do', 'static']);
/** Tokens after which `{` opens an object literal or destructuring pattern. */
const OBJECT_INTRODUCERS = new Set(['=', ':', ',', '(', '[', 'return', '?', '??', '||', '&&', '...']);
/** Identifiers that may precede a non-block `{`. */
const NON_BLOCK_KEYWORDS = new Set([
  'import', 'export', 'const', 'let', 'var', 'return', 'typeof', 'await', 'yield', 'of', 'in', 'case', 'new', 'void', 'throw',
]);

/**
 * @typedef {{ tokens: Token[], text: string, startLine: number, endLine: number }} Statement
 */

/**
 * Split tokens into logical statements. Statements end at `;`, at block braces, or at a line
 * break where automatic semicolon insertion would apply. Function and control-flow bodies are
 * treated as blocks even when nested inside a call (e.g. `test('t', async () => { ... })`), so
 * each statement inside a test body is reported separately. Object literals stay inside their
 * statement.
 * @param {Token[]} tokens
 * @returns {Statement[]}
 */
export function splitStatements(tokens) {
  /** @type {Statement[]} */
  const statements = [];
  /** @type {Token[]} */
  let current = [];
  /** Open brackets; 'B' marks a block brace. */
  const stack = [];
  const exprDepth = () => {
    const lastBlock = stack.lastIndexOf('B');
    return stack.length - lastBlock - 1;
  };

  const flush = () => {
    if (current.length === 0) return;
    statements.push({
      tokens: current,
      text: current.map((t) => t.value).join(' '),
      startLine: current[0].line,
      endLine: current.at(-1).line,
    });
    current = [];
  };

  for (const tok of tokens) {
    const prev = current.at(-1);

    // ASI-style break: new line, no open expression bracket, and neither side continues.
    if (prev && exprDepth() === 0 && tok.line > prev.line
      && !CONTINUATION_END.has(prev.value) && !CONTINUATION_START.has(tok.value)) {
      flush();
    }

    if (tok.type === 'punct' && tok.value in OPENERS) {
      if (tok.value === '{') {
        const prevValue = prev?.value ?? '';
        const opensBlock = BLOCK_INTRODUCERS.has(prevValue)
          || (prev?.type === 'ident' && !NON_BLOCK_KEYWORDS.has(prevValue))
          || (exprDepth() === 0 && !OBJECT_INTRODUCERS.has(prevValue) && !NON_BLOCK_KEYWORDS.has(prevValue));
        if (opensBlock) {
          current.push(tok);
          flush();
          stack.push('B');
          continue;
        }
      }
      stack.push(tok.value);
      current.push(tok);
      continue;
    }
    if (tok.type === 'punct' && [')', ']', '}'].includes(tok.value)) {
      if (stack.at(-1) === 'B' && tok.value === '}') {
        stack.pop();
        flush();
        statements.push({ tokens: [tok], text: tok.value, startLine: tok.line, endLine: tok.line });
        continue;
      }
      if (stack.length > 0 && stack.at(-1) !== 'B') stack.pop();
      current.push(tok);
      continue;
    }
    if (tok.type === 'punct' && tok.value === ';' && exprDepth() === 0) {
      current.push(tok);
      flush();
      continue;
    }
    current.push(tok);
  }
  flush();
  return statements;
}

/**
/**
 * Syntax-check ES module source without executing it (`node --check` on stdin).
 * @param {string} source
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function checkModuleSyntax(source) {
  const result = spawnSync(process.execPath, ['--input-type=module', '--check'], {
    input: source,
    encoding: 'utf8',
    timeout: 15_000,
  });
  if (result.error) return { ok: false, error: `Syntax check could not run: ${result.error.message}` };
  if (result.status === 0) return { ok: true };
  const lines = (result.stderr || '').split(/\r?\n/).filter(Boolean);
  const message = lines.find((l) => /Error:/.test(l)) ?? lines.join('\n');
  const location = lines[0]?.match(/\[stdin\]:(\d+)/);
  return { ok: false, error: location ? `line ${location[1]}: ${message}` : message };
}
