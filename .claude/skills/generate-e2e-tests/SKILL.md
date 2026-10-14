---
name: generate-e2e-tests
description: Turn documented test cases into JavaScript Playwright tests using Page Objects, fixtures, AAA and resilient locators, then validate and run them. Use when writing or extending automation for a page or feature of the target site.
---

# Generate E2E tests

## 1. Select cases
- Read `docs/test-cases.md` for the requested feature. Automate cases whose expected results are **Observed** (or explicitly specified). Skip cases marked blocked/unavailable and say why.
- Order by priority (P1 first). One test per behaviour; do not bundle unrelated checks.

## 2. Page Objects (`tests/pages/`)
```js
import { BasePage } from './base-page.js';

export class LoginPage extends BasePage {
  static path = '/login';

  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    super(page);
    this.heading = page.getByRole('heading', { level: 1, name: 'Log in' });
    this.emailInput = page.getByRole('textbox', { name: 'Email' });
    this.passwordInput = page.getByRole('textbox', { name: 'Password' });
    this.submitButton = page.getByRole('button', { name: 'Log in' });
  }

  /** @param {{ email: string, password: string }} credentials */
  async login({ email, password }) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }
}
```
Rules: kebab-case file `<name>-page.js`; one locator definition per statement in the constructor (the healable shape); use names/labels exactly as in `docs/locator-map.md`; shared widgets (header, cart badge) get their own component class reused by pages; no assertions in Page Objects.

## 3. Fixtures (`tests/fixtures/test.js`)
Register every Page Object: `loginPage: async ({ page }, use) => { await use(new LoginPage(page)); },`. Specs never call `new XPage(page)`.

## 4. Specs (`tests/specs/<feature>.spec.js`)
```js
import { test, expect } from '../fixtures/test.js';
import { TAG } from '../support/tags.js';
import { syntheticEmail } from '../data/test-data.js';

test.describe('Login', { tag: TAG.AUTH }, () => {
  test('TC-AUTH-002 rejects invalid credentials', { tag: TAG.SMOKE }, async ({ loginPage }) => {
    // Arrange
    await loginPage.goto();
    // Act
    await loginPage.login({ email: syntheticEmail('invalid'), password: 'wrong-password' });
    // Assert
    await expect(loginPage.errorMessage).toHaveText('<exact observed message from docs>');
    await expect(loginPage.page).toHaveURL(/\/login/);
  });
});
```
Rules: title starts with the test-case ID; AAA comments; web-first assertions with exact observed values; independent tests (no shared state, each navigates itself); `test.skip(!getCredentials(), 'reason')` for credentialed cases; no `waitForTimeout`, no `test.only`, no inline locators inside `expect()`.

## 5. Locator strategy
`getByRole(+name)` → `getByLabel` → `getByPlaceholder` → `getByText` → `getByTestId` → scoped CSS. Scope ambiguous elements with a parent (`page.getByRole('main').getByRole('link', { name })`) instead of `.first()`. Use `{ exact: true }` when a name is a prefix of another.

## 6. Test data
Synthetic data from `tests/data/test-data.js`; credentials only from env; observed business values (product names, prices, messages) copied verbatim from docs.

## 7. Validate and run
1. `npm run lint` and `node scripts/check-syntax.mjs` → 0 errors.
2. `node scripts/run-tests.mjs tests/specs/<feature>.spec.js` → record run ID, exit code, counts.
3. Fix authoring mistakes (your wrong locator/step). If behaviour contradicts docs, keep the assertion failing and report it. Never weaken assertions.
4. Update `Automation status` in `docs/test-cases.md` and the Page Object column in `docs/locator-map.md`.
