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

## 4a. Synchronization (app readiness)
`async`/`await` only waits for Playwright's action to be *performed*; it does not prove the app *reacted*. Server-rendered apps (Next.js, Nuxt, Angular SSR) show full HTML before their JavaScript attaches event handlers (hydration), so an early click can land and do nothing. Rules:
- Always open pages with the Page Object's `goto()`. `BasePage.goto()` waits for `load` **and** for hydration (`tests/support/app-ready.js`).
- After any full-document navigation that bypasses `goto()` (`page.reload()`, a form post, a hard redirect, a new tab), call `await somePage.waitForReady()` before interacting.
- Waits must be explicit and condition-based: web-first assertions (`toBeVisible`, `toHaveURL`, `toHaveAttribute`), `locator.waitFor()`, `page.waitForURL()`, `waitForReady()`, or `expect(...).toPass()` around an action whose effect is checked. Never `waitForTimeout`, never fixed sleeps, never `force: true`, never raising timeouts to hide a race.
- Symptom of a readiness race: the action succeeds, then an assertion fails with `Received:` equal to the **pre-action state** (e.g. button still "Show password", field still empty, URL unchanged), and the test passes on rerun. Treat it as a synchronization defect in the test (**SYNC**), not a product defect and not a locator problem. Confirm with `npx playwright test <spec> -g "<TC-ID>" --repeat-each=20` and fix the wait in the Page Object/`BasePage`/`tests/support/`, not in the assertion. Re-run with `--repeat-each=20` to prove the fix (0 failures).
- If a site needs a readiness signal `app-ready.js` does not detect, extend `isAppInteractive()` there (one place, all pages benefit) rather than adding waits to individual tests.

## 5. Locator strategy
`getByRole(+name)` → `getByLabel` → `getByPlaceholder` → `getByText` → `getByTestId` → scoped CSS. Scope ambiguous elements with a parent (`page.getByRole('main').getByRole('link', { name })`) instead of `.first()`. Use `{ exact: true }` when a name is a prefix of another.

## 6. Test data
Synthetic data from `tests/data/test-data.js`; credentials only from env; observed business values (product names, prices, messages) copied verbatim from docs.

## 7. Validate and run
1. `npm run lint` and `node scripts/check-syntax.mjs` → 0 errors.
2. Always run the new/changed specs: `node scripts/run-tests.mjs tests/specs/<feature>.spec.js` → record run ID, exit code, counts. The same command builds the Allure report into `allure-report/` (project root; replaced by each run); if the `[qa] allure report:` line says "not generated", run `npm run report:allure -- --run <runId>` and report the result.
3. Fix authoring mistakes (your wrong locator/step, or a missing readiness wait — see 4a). Any failure that does not reproduce on every run is checked with `--repeat-each=20` before it is reported. If behaviour contradicts docs consistently, keep the assertion failing and report it. Never weaken assertions.
4. Update `Automation status` in `docs/test-cases.md` and the Page Object column in `docs/locator-map.md`.
