/**
 * Failure classifier. Decides, from Playwright's own error output plus page evidence, whether a
 * failed test is an eligible locator-repair candidate. Rules are ordered and the first match
 * wins; assertion mismatches are checked before any locator rule so they act as a veto.
 *
 * Patterns were verified against @playwright/test 1.64 output (see tests/unit/fixtures).
 * If Playwright is upgraded, re-capture the fixtures and re-run `npm run test:unit`.
 */

export const CATEGORY = Object.freeze({
  LOCATOR: 'LOCATOR',
  ASSERTION_MISMATCH: 'ASSERTION_MISMATCH',
  NAVIGATION: 'NAVIGATION',
  API: 'API',
  ENVIRONMENT: 'ENVIRONMENT',
  ELEMENT_ABSENT: 'ELEMENT_ABSENT',
  TIMEOUT_INSUFFICIENT_EVIDENCE: 'TIMEOUT_INSUFFICIENT_EVIDENCE',
  UNKNOWN: 'UNKNOWN',
});

/** @param {string} text */
// eslint-disable-next-line no-control-regex -- ANSI escape sequences are control characters by definition
export const stripAnsi = (text) => String(text ?? '').replace(/\u001b\[[0-9;]*m/g, '');

/**
 * @typedef {object} FailureInput
 * @property {string} status Playwright result status (failed | timedOut | interrupted ...)
 * @property {{ message?: string, stack?: string }[]} errors
 * @property {string | null} [pageSnapshot] ARIA snapshot YAML captured at failure time
 *
 * @typedef {object} Classification
 * @property {string} category
 * @property {string | null} subtype
 * @property {boolean} eligible true only for confirmed locator-repair candidates
 * @property {string} rule
 * @property {string} reason
 * @property {string | null} locator Playwright's description of the failing locator
 * @property {string | null} action e.g. locator.click, expect.toHaveText
 * @property {{ role?: string, name: string, line: string }[]} candidates snapshot elements that may be the intended target
 */

/**
 * Extract the "Call log:" lines from an error message.
 * @param {string} message
 */
export function parseCallLog(message) {
  const idx = message.indexOf('Call log:');
  if (idx === -1) return [];
  const lines = [];
  for (const line of message.slice(idx + 'Call log:'.length).split(/\r?\n/)) {
    if (/^\s*$/.test(line)) { if (lines.length) break; continue; }
    if (/^\s{0,1}>?\s*\d+\s*\|/.test(line)) break; // source snippet begins
    lines.push(line.trim());
  }
  return lines;
}

/**
 * Pull the locator description out of a Playwright error message.
 * @param {string} message
 * @returns {string | null}
 */
export function extractLocator(message) {
  const patterns = [
    /strict mode violation: (.+?) resolved to \d+ elements/,
    /^Locator:\s+(.+)$/m,
    /^\s*- waiting for (.+)$/m,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(message);
    if (match) return match[1].trim();
  }
  return null;
}

/**
 * Parse a locator description such as `getByRole('button', { name: 'Add to bag' })`
 * into its user-facing identity (best effort, last chained step wins).
 * @param {string | null} locator
 */
export function describeLocatorIdentity(locator) {
  if (!locator) return {};
  const identity = {};
  const role = [...locator.matchAll(/getByRole\('([^']+)'(?:,\s*\{\s*name:\s*(?:'([^']*)'|\/([^/]*)\/\w*))?/g)].at(-1);
  if (role) {
    identity.role = role[1];
    if (role[2] !== undefined || role[3] !== undefined) identity.name = role[2] ?? role[3];
  }
  const text = [...locator.matchAll(/getBy(?:Text|Label|Placeholder|AltText|Title)\('([^']*)'/g)].at(-1);
  if (text && !identity.name) identity.name = text[1];
  const testId = /getByTestId\('([^']*)'\)/.exec(locator);
  if (testId) identity.testId = testId[1];
  return identity;
}

/**
 * Parse an ARIA snapshot YAML into flat elements: `- button "Add to cart" [ref=e5]`.
 * @param {string | null | undefined} snapshot
 * @returns {{ role: string, name: string, line: string }[]}
 */
export function parseAriaSnapshot(snapshot) {
  if (!snapshot) return [];
  const elements = [];
  for (const raw of snapshot.split(/\r?\n/)) {
    const match = /^\s*-\s+([a-z]+)(?:\s+"((?:[^"\\]|\\.)*)")?/.exec(raw);
    if (match) elements.push({ role: match[1], name: match[2] ?? '', line: raw.trim() });
  }
  return elements;
}

const words = (s) => (s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);

/**
 * Snapshot elements that could plausibly be the intended target of a broken locator:
 * same role, or a name sharing at least one word with the original identity.
 * @param {ReturnType<typeof describeLocatorIdentity>} identity
 * @param {ReturnType<typeof parseAriaSnapshot>} elements
 */
export function findCandidates(identity, elements) {
  const wanted = new Set(words(`${identity.name ?? ''} ${identity.testId ?? ''}`));
  const scored = elements
    .filter((el) => el.role !== 'generic' || el.name)
    .map((el) => {
      const overlap = words(el.name).filter((w) => wanted.has(w)).length;
      const roleMatch = identity.role ? el.role === identity.role : false;
      return { ...el, score: overlap * 2 + (roleMatch ? 1 : 0) };
    })
    .filter((el) => el.score > 0 && (identity.role ? el.role === identity.role || el.score >= 2 : true));
  return scored.sort((a, b) => b.score - a.score).slice(0, 10).map(({ score, ...el }) => ({ ...el, score }));
}

/**
 * Classify one failed test result.
 * @param {FailureInput} input
 * @returns {Classification}
 */
export function classifyFailure(input) {
  const errors = (input?.errors ?? []).map((e) => stripAnsi(e?.message ?? ''));
  const message = errors.join('\n\n');
  const primary = errors[0] ?? '';
  const callLog = parseCallLog(primary);
  const locator = extractLocator(primary);
  const actionMatch = /(?:^|\s)((?:locator|page|frame|elementHandle|apiRequestContext)\.\w+):/.exec(primary)
    ?? /expect\((?:locator|page|received)\)\.(\w+)\(/.exec(primary);
  const action = actionMatch ? (actionMatch[1].includes('.') ? actionMatch[1] : `expect.${actionMatch[1]}`) : null;

  /** @returns {Classification} */
  const result = (category, rule, reason, extra = {}) => ({
    category,
    subtype: null,
    eligible: false,
    rule,
    reason,
    locator,
    action,
    candidates: [],
    ...extra,
  });

  if (!primary.trim()) {
    return result(CATEGORY.UNKNOWN, 'R-UNK-00', 'No error message was recorded for this failure.');
  }

  // 1. Environment / harness failures.
  if (/Executable doesn't exist|browserType\.launch|Protocol error|Target (page, context or browser )?(has been )?closed|ENOENT|EACCES|Cannot find module|ERR_MODULE_NOT_FOUND|SyntaxError:|ReferenceError:|TypeError:/.test(message)) {
    return result(CATEGORY.ENVIRONMENT, 'R-ENV-01', 'Browser, filesystem or test-code error; not a locator problem.');
  }

  // 2. Navigation.
  if (/(^|\s)(page|frame)\.(goto|reload|waitForURL|goBack|goForward):/m.test(primary) || /net::ERR_[A-Z_]+/.test(primary)) {
    return result(CATEGORY.NAVIGATION, 'R-NAV-01', 'Navigation failed (network error, unreachable host or navigation timeout).');
  }

  // 3. API / backend.
  if (/(^|\s)apiRequestContext\.\w+:/m.test(primary) || /\b(ECONNREFUSED|ENOTFOUND|ECONNRESET|ETIMEDOUT|EPROTO|socket hang up)\b/.test(primary)
    || /\b(5\d\d|4\d\d) (Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout|Not Found|Unauthorized|Forbidden)\b/.test(primary)) {
    return result(CATEGORY.API, 'R-API-01', 'API or backend request failed; capture evidence and report, do not repair locators.');
  }

  // 4. Assertion mismatch veto: the locator resolved and a concrete value differed.
  const isExpect = /expect\((locator|page|received)\)\.\w+\(/.test(primary) || /Timed out \d+ms waiting for expect\(/.test(primary);
  const elementMissing = /element\(s\) not found|<element\(s\) not found>/.test(primary);
  const concreteReceived = /^\s*Received(?: string| array| value| number| pattern)?:\s+(?!<element)/m.test(primary)
    || /unexpected value/.test(primary)
    || /^\s*[-+] (Expected|Received)/m.test(primary);
  if (isExpect && (concreteReceived || !elementMissing)) {
    return result(CATEGORY.ASSERTION_MISMATCH, 'R-ASSERT-01',
      'Assertion compared a concrete value and it differed. Expected values are never changed by healing; report it.');
  }

  // 5. Test-level timeout with no action-level evidence.
  if (/Test timeout of \d+ms exceeded/.test(primary) && !locator) {
    return result(CATEGORY.TIMEOUT_INSUFFICIENT_EVIDENCE, 'R-TMO-03', 'The test hit its overall timeout without evidence of a specific locator failure.');
  }

  const resolved = callLog.some((line) => /locator resolved to|resolved to \d+ elements?/.test(line) && !/resolved to 0 elements/.test(line));
  const elements = parseAriaSnapshot(input.pageSnapshot);
  const identity = describeLocatorIdentity(locator);
  const candidates = findCandidates(identity, elements);

  // 6. Strict mode violation: the locator is ambiguous; Playwright lists the matches.
  if (/strict mode violation/.test(primary)) {
    const matches = [...primary.matchAll(/^\s*\d+\) .*? aka (.+)$/gm)].map((m) => ({ role: '', name: m[1].trim(), line: m[0].trim() }));
    return result(CATEGORY.LOCATOR, 'R-LOC-01',
      'Locator matched multiple elements; refine or scope it once the intended target is identified.',
      { subtype: 'STRICT_MODE', eligible: true, candidates: matches.length ? matches : candidates });
  }

  // 7. Locator resolved to the wrong kind of element.
  if (/Element is not an <input>|is not a <select> element|Not a checkbox or radio button|Element is not a checkbox/.test(primary)) {
    return result(CATEGORY.LOCATOR, 'R-LOC-03', 'Locator resolved to an element of the wrong type for the action.',
      { subtype: 'WRONG_ELEMENT', eligible: true, candidates });
  }

  const isActionTimeout = /(locator|frame|page)\.\w+: Timeout \d+ms exceeded/.test(primary)
    || (/Test timeout of \d+ms exceeded/.test(primary) && Boolean(locator));
  const isPresenceAssertion = isExpect && elementMissing;

  if (isActionTimeout || isPresenceAssertion) {
    // Element was found but never became actionable: timing/state problem, not a locator problem.
    if (resolved) {
      return result(CATEGORY.TIMEOUT_INSUFFICIENT_EVIDENCE, 'R-TMO-01',
        'The locator resolved to an element that never became actionable (disabled, hidden, covered or unstable). Changing the locator would be a guess.');
    }
    if (!locator) {
      return result(CATEGORY.TIMEOUT_INSUFFICIENT_EVIDENCE, 'R-TMO-02', 'Timeout without a parseable call log.');
    }
    if (elements.length === 0) {
      return result(CATEGORY.TIMEOUT_INSUFFICIENT_EVIDENCE, 'R-TMO-04',
        'Locator matched nothing, but no page snapshot is available to confirm the intended element still exists.');
    }
    if (candidates.length === 0 && (identity.role || identity.name || identity.testId)) {
      return result(CATEGORY.ELEMENT_ABSENT, 'R-ABS-01',
        'Nothing on the page resembles the intended element; it may be genuinely missing. Report as a possible product defect.');
    }
    return result(CATEGORY.LOCATOR, isPresenceAssertion ? 'R-LOC-04' : 'R-LOC-02',
      'Locator matched no element while the page contains plausible candidates for the intended target. Confirm target identity before repairing.',
      { subtype: isPresenceAssertion ? 'PRESENCE_MISS' : 'NOT_FOUND', eligible: true, candidates });
  }

  return result(CATEGORY.UNKNOWN, 'R-UNK-01', 'Failure does not match any known pattern; investigate manually.');
}
