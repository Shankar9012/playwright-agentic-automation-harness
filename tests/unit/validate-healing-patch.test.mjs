import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHealablePath, validateHealingPatch } from '../../utils/guardrails/validate-healing-patch.mjs';

const PAGE = `import { BasePage } from './base-page.js';

export class ProductPage extends BasePage {
  constructor(page) {
    super(page);
    this.addToCartButton = page.getByRole('button', { name: 'Add to bag' });
    this.price = page.getByTestId('price');
  }

  async addToCart() {
    await this.addToCartButton.click();
  }
}
`;

const SPEC = `import { test, expect } from '../fixtures/test.js';

test('shows the price', async ({ productPage }) => {
  await productPage.goto();
  await expect(productPage.price).toHaveText('$149.99');
});
`;

const page = (after) => validateHealingPatch({ filePath: 'tests/pages/product-page.js', before: PAGE, after });
const spec = (after) => validateHealingPatch({ filePath: 'tests/specs/product.spec.js', before: SPEC, after });
const codes = (verdict) => verdict.violations.map((v) => v.code);

test('accepts a locator-only change in a Page Object', () => {
  const verdict = page(PAGE.replace("'Add to bag'", "'Add to cart'"));
  assert.equal(verdict.ok, true, JSON.stringify(verdict.violations));
  assert.deepEqual(verdict.changes, [{
    lhs: 'this . addToCartButton',
    line: 6,
    before: "page.getByRole('button', { name: 'Add to bag' })",
    after: "page.getByRole('button', { name: 'Add to cart' })",
  }]);
});

test('accepts a scoped, multi-line locator refinement', () => {
  const verdict = page(PAGE.replace(
    "page.getByRole('button', { name: 'Add to bag' })",
    "page\n      .getByRole('main')\n      .getByRole('button', { name: /add to cart/i, exact: false })",
  ));
  assert.equal(verdict.ok, true, JSON.stringify(verdict.violations));
  assert.deepEqual(verdict.degraded, []);
});

test('flags positional locators as degraded heals', () => {
  const verdict = page(PAGE.replace("page.getByRole('button', { name: 'Add to bag' })", "page.getByRole('button').first()"));
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.degraded, ['POSITIONAL_LOCATOR_INTRODUCED']);
});

test('rejects changing an expected value in an assertion', () => {
  const verdict = spec(SPEC.replace('$149.99', '$149.98'));
  assert.equal(verdict.ok, false);
  assert.ok(codes(verdict).includes('ASSERTION_TOUCHED'));
  assert.ok(codes(verdict).includes('EXPECTED_LITERAL_CHANGED'));
});

test('rejects changing the matcher of an assertion', () => {
  const verdict = spec(SPEC.replace("toHaveText('$149.99')", () => "toContainText('$')"));
  assert.equal(verdict.ok, false);
  assert.ok(codes(verdict).includes('ASSERTION_TOUCHED'));
});

test('rejects deleting an assertion', () => {
  const verdict = spec(SPEC.replace("  await expect(productPage.price).toHaveText('$149.99');\n", ''));
  assert.equal(verdict.ok, false);
  assert.ok(codes(verdict).includes('ASSERTION_TOUCHED'));
});

test('rejects skipping a test or adding .only', () => {
  assert.ok(codes(spec(SPEC.replace("test('shows", "test.skip('shows"))).includes('SKIP_INTRODUCED'));
  assert.ok(codes(spec(SPEC.replace("test('shows", "test.only('shows"))).includes('ONLY_INTRODUCED'));
  assert.ok(codes(spec(SPEC.replace('await productPage.goto();', "test.fixme(true, 'later');\n  await productPage.goto();"))).includes('SKIP_INTRODUCED'));
});

test('rejects timeouts, forced actions and business-logic changes', () => {
  assert.equal(page(PAGE.replace('this.addToCartButton.click()', 'this.addToCartButton.click({ force: true })')).ok, false);
  assert.equal(page(PAGE.replace('this.addToCartButton.click()', 'this.addToCartButton.click({ timeout: 60000 })')).ok, false);
  assert.equal(page(PAGE.replace("page.getByTestId('price')", "page.evaluate(() => '$149.99')")).ok, false);
  assert.equal(page(PAGE.replace("this.price = page.getByTestId('price')", "this.total = page.getByTestId('price')")).ok, false);
});

test('rejects syntax errors and files outside the authorized scope', () => {
  assert.deepEqual(codes(page(PAGE.replace("'Add to bag' })", "'Add to bag' "))), ['SYNTAX_ERROR']);
  const outside = validateHealingPatch({ filePath: 'utils/healing/classify-failure.mjs', before: PAGE, after: PAGE.replace('bag', 'cart') });
  assert.deepEqual(codes(outside), ['OUT_OF_SCOPE_FILE']);
  assert.equal(isHealablePath('tests/pages/../../src/app.js'), false);
  assert.equal(isHealablePath('src/app/page.js'), false);
  assert.equal(isHealablePath('tests\\pages\\login-page.js'), true);
});

test('rejects unchanged or formatting-only patches', () => {
  assert.deepEqual(codes(page(PAGE)), ['NO_CHANGE']);
  assert.deepEqual(codes(page(PAGE.replace('    this.price', '      this.price'))), ['NO_LOCATOR_CHANGE']);
});

test('rejects more than one changed statement per attempt', () => {
  const verdict = page(PAGE.replace("'Add to bag'", "'Add to cart'").replace("'price'", "'product-price'"));
  assert.deepEqual(codes(verdict), ['TOO_MANY_STATEMENTS']);
});
