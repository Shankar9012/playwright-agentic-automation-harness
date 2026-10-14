import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CATEGORY, classifyFailure, describeLocatorIdentity, parseAriaSnapshot } from '../../utils/healing/classify-failure.mjs';
import { extractPageSnapshot } from '../../utils/healing/collect-diagnostics.mjs';

// Real Playwright 1.64 JSON report and error-context captured from deliberate failures.
const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const report = JSON.parse(readFileSync(fixture('pw-failures.report.json'), 'utf8'));
const snapshot = extractPageSnapshot(readFileSync(fixture('error-context-not-found.md'), 'utf8'));
const result = (title) => {
  const spec = report.suites[0].specs.find((s) => s.title === title);
  assert.ok(spec, `fixture spec "${title}" exists`);
  return spec.tests[0].results[0];
};
const classify = (title, pageSnapshot = snapshot) => {
  const r = result(title);
  return classifyFailure({ status: r.status, errors: r.errors, pageSnapshot });
};

test('accepts a confirmed locator failure when the intended element is still present', () => {
  const c = classify('locator-not-found');
  assert.equal(c.category, CATEGORY.LOCATOR);
  assert.equal(c.subtype, 'NOT_FOUND');
  assert.equal(c.eligible, true);
  assert.equal(c.locator, "getByRole('button', { name: 'Add to bag' })");
  assert.match(c.candidates[0].line, /button "Add to cart"/);
});

test('accepts strict-mode violations and surfaces Playwright suggestions', () => {
  const c = classify('strict-mode');
  assert.equal(c.subtype, 'STRICT_MODE');
  assert.equal(c.eligible, true);
  assert.ok(c.candidates.some((cand) => /getByRole\('button', \{ name: 'Buy' \}\)/.test(cand.name)));
});

test('accepts a locator that resolved to the wrong element type', () => {
  const c = classify('wrong-element');
  assert.equal(c.subtype, 'WRONG_ELEMENT');
  assert.equal(c.eligible, true);
});

for (const title of ['assert-text', 'assert-tobe', 'assert-url']) {
  test(`never treats an assertion/value mismatch as a locator repair (${title})`, () => {
    const c = classify(title);
    assert.equal(c.category, CATEGORY.ASSERTION_MISMATCH);
    assert.equal(c.eligible, false);
  });
}

test('does not approve a timeout without page evidence', () => {
  const c = classify('locator-not-found', null);
  assert.equal(c.category, CATEGORY.TIMEOUT_INSUFFICIENT_EVIDENCE);
  assert.equal(c.eligible, false);
});

test('does not approve an actionability timeout where the locator resolved', () => {
  const c = classify('actionability');
  assert.equal(c.category, CATEGORY.TIMEOUT_INSUFFICIENT_EVIDENCE);
  assert.equal(c.rule, 'R-TMO-01');
  assert.equal(c.eligible, false);
});

test('does not approve an overall test timeout', () => {
  const c = classify('test-timeout');
  assert.equal(c.category, CATEGORY.TIMEOUT_INSUFFICIENT_EVIDENCE);
  assert.equal(c.eligible, false);
});

test('reports a genuinely absent element as a possible defect, not a repair', () => {
  const c = classify('visible-missing');
  assert.equal(c.category, CATEGORY.ELEMENT_ABSENT);
  assert.equal(c.eligible, false);
  const noButtons = classify('locator-not-found', '- main:\n  - heading "Shop" [level=1]\n  - paragraph: $149.99');
  assert.equal(noButtons.category, CATEGORY.ELEMENT_ABSENT);
});

test('classifies navigation and API failures without locator repair', () => {
  assert.equal(classify('navigation').category, CATEGORY.NAVIGATION);
  assert.equal(classify('api').category, CATEGORY.API);
  assert.equal(classify('navigation').eligible, false);
  assert.equal(classify('api').eligible, false);
});

test('handles empty or malformed input safely', () => {
  assert.equal(classifyFailure({ errors: [] }).category, CATEGORY.UNKNOWN);
  assert.equal(classifyFailure(undefined).eligible, false);
  assert.equal(classifyFailure({ errors: [{ message: 'something odd' }] }).category, CATEGORY.UNKNOWN);
});

test('parses locator identity and ARIA snapshots', () => {
  assert.deepEqual(describeLocatorIdentity("getByRole('button', { name: 'Add to bag' })"), { role: 'button', name: 'Add to bag' });
  assert.deepEqual(describeLocatorIdentity("getByTestId('banner')"), { testId: 'banner' });
  const elements = parseAriaSnapshot(snapshot);
  assert.ok(elements.some((e) => e.role === 'button' && e.name === 'Add to cart'));
});
