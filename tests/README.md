# `tests/` — Playwright tests and harness unit tests

```
tests/
├── pages/       Page Objects (one class per page, extends BasePage)
├── fixtures/    test.js — extended `test` with Page Object fixtures + failure evidence
├── data/        test-data.js — env credentials, synthetic data helpers; auth-data.js — observed auth values
├── support/     tags.js — tag constants (@smoke, @auth, …); app-ready.js — load + hydration wait
├── specs/       E2E specs, one file per feature (project "chromium")
├── faults/      deliberate fault-injection proofs (project "faults", opt-in only)
└── unit/        node:test suites for utils/, hooks and the healing workflow
```

## How a test is put together

```
spec (tests/specs/login.spec.js)
  imports { test, expect } from ../fixtures/test.js
  receives  loginPage fixture ───► new LoginPage(page)  (tests/pages/login-page.js)
  Arrange   await loginPage.goto()
  Act       await loginPage.login({ email, password })
  Assert    await expect(loginPage.errorMessage).toHaveText('<observed text>')
```

- **Page Objects** define every locator once, in the constructor: `this.submitButton = page.getByRole('button', { name: 'Log in' })`. This is the only shape the self-healer may edit, so keep it.
- **Specs** never build locators inside `expect()` (ESLint enforces this) and never construct Page Objects by hand.
- **Fixture `healingEvidence`** runs automatically. When a test fails, it attaches an ARIA snapshot and the page URL. The failure classifier uses them to decide whether a locator can be repaired.
- **Credentials:** use `getCredentials()` / `getTestUserEmail()` and skip with a reason when they are missing. Never hard-code credentials.
- **Account creation:** tests that create real accounts check `isAccountCreationAllowed()` (`ALLOW_ACCOUNT_CREATION=true`) and skip otherwise.
- **Synchronization:** `BasePage.goto()` waits for `load` and for the app to finish hydrating (`support/app-ready.js`: React/Next.js, Vue/Nuxt, Angular), so clicks reach real event handlers. After a reload or hard redirect call `waitForReady()`. Waits are always explicit conditions; never `waitForTimeout`.
- **Native form validation:** browser pop-up texts differ by browser and locale, so assert the field is invalid (`BasePage.validityOf(field)`) and the URL is unchanged, not the pop-up text.
- **Expected values:** copy them word for word from `docs/test-cases.md`, where they were recorded from observed behaviour.

## Current suite

| Spec | Cases | Fixtures used | Needs |
|---|---|---|---|
| `specs/login.spec.js` | TC-AUTH-LOGIN-001 … 011 | `header`, `loginPage`, `signupPage`, `productsPage` | `TEST_USER_*` for 002, 004, 011 |
| `specs/signup.spec.js` | TC-AUTH-SIGNUP-001 … 011 | `header`, `homePage`, `signupPage`, `loginPage` | `ALLOW_ACCOUNT_CREATION=true` for 003; `TEST_USER_EMAIL` for 004 |

Page Objects: `base-page.js`, `header-component.js` (banner links + "Log out"), `home-page.js`, `login-page.js`, `signup-page.js`, `products-page.js`.

Every run through `scripts/run-tests.mjs` also writes Allure results and the Allure report to `artifacts/runs/<runId>/`.

## Projects
| Project | Directory | Runs with |
|---|---|---|
| `chromium` | `tests/specs` | `npm test`, `npm run test:smoke`, `npm run test:heal` |
| `faults` | `tests/faults` | `npm run test:faults` (registered only when `QA_ENABLE_FAULTS=1`, which the script sets) |

`tests/faults/` holds fault-injection cases used to prove the healing workflow: a broken locator that must be healed, and a wrong expected value that must stay failed. They are never part of the normal suite. Put them in, prove the workflow, then reset them.

## Unit tests (`tests/unit/`, `npm run test:unit`)
| File | Covers |
|---|---|
| `classify-failure.test.mjs` | eligible locator failures, assertion veto, timeouts without evidence, absent elements, nav/API, malformed input. Uses real Playwright 1.64 output in `unit/fixtures/`. |
| `validate-healing-patch.test.mjs` | accepts locator-only changes; rejects changes to assertions, expected values, skip/only, timeouts, force, logic, syntax, scope |
| `guardrails.test.mjs` | command policy, hook JSON schema, malformed hook input, post-edit checks, URL policy, JSON errors |
| `restore-and-log.test.mjs` | restores only the affected file (unrelated edits preserved), crash recovery, healing-log persistence |
| `reporting.test.mjs` | report parsing, flaky ≠ repaired, final status from the confirmation rerun |
| `healing-workflow.test.mjs` | **end to end with real Playwright runs** against an offline sandbox: broken locator → HEALED; wrong repair → restored; wrong assertion never queued; tampering → REJECTED |
