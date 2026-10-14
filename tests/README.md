# `tests/` — Playwright tests and harness unit tests

```
tests/
├── pages/       Page Objects (one class per page, extends BasePage)
├── fixtures/    test.js — extended `test` with Page Object fixtures + failure evidence
├── data/        test-data.js — env credentials, synthetic data helpers
├── support/     tags.js — tag constants (@smoke, @auth, …)
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
- **Credentials:** use `getCredentials()` and skip with a reason when it is missing. Never hard-code credentials.
- **Expected values:** copy them word for word from `docs/test-cases.md`, where they were recorded from observed behaviour.

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
