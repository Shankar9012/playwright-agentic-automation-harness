import { isHostAllowed } from './validate-target-url.mjs';

/**
 * Shell command policy used by the PreToolUse hook. It blocks a small, explicit set of
 * destructive or unauthorized operations and allows everything else (inspection, npm, git
 * read/write, Playwright runs). Rules are deliberately specific so ordinary work is not blocked.
 */

/**
 * @typedef {{ decision: 'allow' } | { decision: 'deny', rule: string, reason: string, segment: string }} PolicyVerdict
 */

/**
 * Split a command line into segments on `;`, `&&`, `||`, `|` and newlines, outside quotes.
 * Pipes are kept as a marker so pipe-to-shell can be detected.
 * @param {string} command
 * @returns {{ text: string, pipedFrom: string | null }[]}
 */
export function splitSegments(command) {
  const segments = [];
  let current = '';
  let quote = null;
  let pipedFrom = null;
  const push = (nextPipedFrom) => {
    if (current.trim()) segments.push({ text: current.trim(), pipedFrom });
    pipedFrom = nextPipedFrom;
    current = '';
  };
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"') { current += ch + (command[i + 1] ?? ''); i += 1; continue; }
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
    if (ch === '\n' || ch === ';') { push(null); continue; }
    if ((ch === '&' || ch === '|') && command[i + 1] === ch) { push(null); i += 1; continue; }
    if (ch === '|') { const prev = current.trim(); push(prev); continue; }
    current += ch;
  }
  push(null);
  return segments;
}

/**
 * Shell-like word splitting with quote removal.
 * @param {string} text
 * @returns {string[]}
 */
export function splitWords(text) {
  const words = [];
  let current = '';
  let quote = null;
  let has = false;
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; has = true; continue; }
    if (/\s/.test(ch)) {
      if (has || current) words.push(current);
      current = '';
      has = false;
      continue;
    }
    current += ch;
    has = true;
  }
  if (has || current) words.push(current);
  return words;
}

const PROTECTED_RM_TARGETS = /^(\/|~|~\/|\.|\.\/|\.\.|\.\.\/.*|\*|\/\*|\$HOME|%USERPROFILE%|[A-Za-z]:[\\/]?|\/[a-z]|\.git|\.claude|tests|utils|scripts|docs|src|app|\.env)\/?$/i;

/** @param {string} target */
const isProtectedTarget = (target) => {
  const normalized = target.replace(/\\/g, '/').replace(/^(\.\/)+(?=.)/, '');
  return PROTECTED_RM_TARGETS.test(normalized) || normalized.split('/').includes('..');
};

/** @param {string[]} words */
function commandName(words) {
  let i = 0;
  while (i < words.length && (/^[A-Z_][A-Z0-9_]*=/.test(words[i]) || ['sudo', 'env', 'command', 'exec', 'time', 'rtk'].includes(words[i]))) i += 1;
  return { name: (words[i] ?? '').replace(/\.exe$/i, '').toLowerCase(), args: words.slice(i + 1) };
}

/** @param {string[]} args @param {string} short @param {string} long */
const hasFlag = (args, short, long) => args.some((a) => a === `--${long}` || (/^-[A-Za-z]+$/.test(a) && a.includes(short)));

/**
 * Extract hosts from URLs in a command segment.
 * @param {string} text
 */
function urlsIn(text) {
  return [...text.matchAll(/https?:\/\/[^\s'"<>|)]+/gi)].map((m) => {
    try { return new URL(m[0]); } catch { return null; }
  }).filter(Boolean);
}

/**
 * Evaluate one segment.
 * @param {{ text: string, pipedFrom: string | null }} segment
 * @param {{ allowedHosts: string[] }} policy
 * @returns {PolicyVerdict}
 */
function evaluateSegment(segment, policy) {
  const { text } = segment;
  const words = splitWords(text);
  const { name, args } = commandName(words);
  const deny = (rule, reason) => ({ decision: 'deny', rule, reason, segment: text });

  // Destructive file deletion of root, home, project or source directories.
  if (name === 'rm' && hasFlag(args, 'r', 'recursive')) {
    const targets = args.filter((a) => !a.startsWith('-'));
    const bad = targets.find(isProtectedTarget);
    if (bad) return deny('destructive-delete', `Recursive delete of protected path "${bad}" is blocked.`);
  }
  if (['remove-item', 'rmdir', 'rd', 'del', 'ri'].includes(name) && /-recurse|\/s\b/i.test(text)) {
    const targets = args.filter((a) => !a.startsWith('-') && !a.startsWith('/'));
    const bad = targets.find(isProtectedTarget);
    if (bad) return deny('destructive-delete', `Recursive delete of protected path "${bad}" is blocked.`);
  }

  // Git operations that discard work or rewrite shared history.
  if (name === 'git') {
    const sub = args.find((a) => !a.startsWith('-')) ?? '';
    const rest = args.slice(args.indexOf(sub) + 1);
    if (sub === 'reset' && rest.includes('--hard')) return deny('git-discard', 'git reset --hard discards uncommitted work. Restore specific files instead.');
    if (sub === 'clean' && rest.some((a) => /^-[a-z]*f/i.test(a) || a === '--force')) return deny('git-discard', 'git clean -f deletes untracked files.');
    if (sub === 'checkout' && (rest.includes('.') || (rest.includes('--') && rest.slice(rest.indexOf('--') + 1).some((a) => ['.', '*', ':/'].includes(a))))) {
      return deny('git-discard', 'git checkout of the whole tree discards uncommitted work.');
    }
    if (sub === 'restore' && rest.some((a) => ['.', '*', ':/'].includes(a)) && !rest.includes('--staged')) {
      return deny('git-discard', 'git restore of the whole tree discards uncommitted work.');
    }
    if (sub === 'push' && rest.some((a) => /^(--force|--force-with-lease|-f|--mirror|--delete)/.test(a) || /^\+/.test(a))) {
      return deny('git-history', 'Force/destructive push is blocked.');
    }
    if (sub === 'stash' && ['drop', 'clear'].includes(rest[0])) return deny('git-discard', 'Dropping stashes discards work.');
    if (sub === 'branch' && rest.some((a) => a === '-D' || a === '--delete' && rest.includes('--force'))) return deny('git-discard', 'Force-deleting branches is blocked.');
    if (['filter-branch', 'filter-repo'].includes(sub) || (sub === 'reflog' && rest[0] === 'expire')) return deny('git-history', 'History rewriting is blocked.');
  }

  // System-level destruction.
  if (['mkfs', 'diskpart', 'format', 'shutdown', 'reboot', 'halt', 'poweroff', 'stop-computer', 'restart-computer', 'clear-disk', 'format-volume'].includes(name)
    || /^mkfs\./.test(name)) {
    return deny('system-destructive', `"${name}" is a system-level destructive command.`);
  }
  if (name === 'dd' && args.some((a) => /^of=\/dev\//.test(a))) return deny('system-destructive', 'Writing raw devices with dd is blocked.');
  if (/:\(\)\s*\{\s*:\|:&\s*\};:/.test(text.replace(/\s+/g, ''))) return deny('system-destructive', 'Fork bomb detected.');

  // Remote code piped into a shell.
  if (segment.pipedFrom && ['sh', 'bash', 'zsh', 'iex', 'invoke-expression', 'pwsh', 'powershell'].includes(name)
    && /\b(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b/i.test(segment.pipedFrom)) {
    return deny('remote-exec', 'Piping downloaded content into a shell is blocked.');
  }

  // Production deploys, publishing and payment actions.
  if (name === 'npm' && args[0] === 'publish') return deny('production', 'npm publish is not part of QA work.');
  if (['vercel', 'netlify'].includes(name) && args.some((a) => a === '--prod' || a === '--production')) return deny('production', 'Production deployments are blocked.');
  if (name === 'supabase' && args.some((a) => ['reset', 'push'].includes(a))) return deny('production', 'Database reset/push is blocked.');
  if (name === 'stripe' && !args.some((a) => ['--help', '-h', 'version', 'login'].includes(a))) {
    return deny('payment', 'Stripe CLI actions are blocked; QA must never create real payments, refunds or charges.');
  }
  if (/\bsk_live_[0-9a-z]+/i.test(text) || /\brk_live_[0-9a-z]+/i.test(text)) return deny('payment', 'Live payment secret keys must not be used.');

  // Network writes to hosts that are not explicitly authorized.
  if (['curl', 'wget', 'invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm', 'http', 'xh'].includes(name)) {
    const payment = urlsIn(text).find((u) => /(^|\.)stripe\.com$/i.test(u.hostname));
    if (payment) return deny('payment', `Direct calls to the payment provider (${payment.hostname}) are blocked.`);
    const writes = /(^|\s)(-X|--request|-Method)\s*(POST|PUT|PATCH|DELETE)\b/i.test(text)
      || /(^|\s)(-d|--data[\w-]*|-F|--form|--post-data|--post-file|-Body|-InFile)\b/.test(text);
    if (writes) {
      const forbidden = urlsIn(text).find((u) => !isHostAllowed(u.hostname, policy.allowedHosts));
      if (forbidden) return deny('network-write', `Write request to unauthorized host "${forbidden.hostname}" is blocked.`);
    }
  }

  return { decision: 'allow' };
}

/**
 * Evaluate a full shell command.
 * @param {string} command
 * @param {{ allowedHosts: string[] }} policy
 * @returns {PolicyVerdict}
 */
export function evaluateCommand(command, policy) {
  if (typeof command !== 'string') {
    throw new TypeError(`Command must be a string, received ${command === null ? 'null' : typeof command}.`);
  }
  for (const segment of splitSegments(command)) {
    const verdict = evaluateSegment(segment, policy);
    if (verdict.decision === 'deny') return verdict;
    // Recurse into `bash -c "..."` / `sh -c` / `powershell -Command` payloads.
    const words = splitWords(segment.text);
    const { name, args } = commandName(words);
    const flagIdx = args.findIndex((a) => ['-c', '-command', '-Command', '/c'].includes(a));
    if (['bash', 'sh', 'zsh', 'pwsh', 'powershell', 'cmd'].includes(name) && flagIdx >= 0 && args[flagIdx + 1]) {
      const inner = evaluateCommand(args.slice(flagIdx + 1).join(' '), policy);
      if (inner.decision === 'deny') return inner;
    }
  }
  return { decision: 'allow' };
}
