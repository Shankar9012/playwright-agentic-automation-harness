---
name: run-and-report
description: Execute Playwright tests for a scope, parse the JSON results, classify failures, collect evidence and write an evidence-based QA report. Use for "run the tests", "run smoke", "what failed", or reporting after a healing run.
---

# Run and report

## Execute
| Need | Command |
|---|---|
| Full chromium suite | `npm test` (= `node scripts/run-tests.mjs`) |
| Smoke | `npm run test:smoke` |
| One feature | `node scripts/run-tests.mjs tests/specs/<feature>.spec.js` |
| By tag / title | `node scripts/run-tests.mjs --grep @auth` |
| Run + classify + heal queue | `npm run test:heal -- <scope>` |
| Headed / UI debugging | `npm run test:headed`, `npm run test:ui` |

Every run gets a run ID and writes `artifacts/runs/<runId>/`: `report.json` (Playwright JSON — source of truth), `run.json` (command, exit code, triage), `summary.json`, `summary.md`, plus `allure-results/`. The Allure report is built into the single project folder `allure-report/` (always the latest run; rebuild any kept run with `npm run report:allure -- --run <runId>`). Evidence lives in `test-results/` (screenshot, trace, video, error-context) and the HTML report in `playwright-report/`. For heal runs the Allure report covers the initial run only; the final result is in `summary.md`.
Exit codes: 0 all passed · 1 test failures · 2 no usable report (infrastructure). Record the real exit code; never re-label it.

## Classify failures
`npm run test:heal` classifies automatically. To understand a failure manually, read the error in `summary.md`/`report.json`:
- `expect(...)… failed` with a concrete `Received:` → **ASSERTION_MISMATCH** (possible defect or outdated expectation; never auto-fixed).
- `locator.<action>: Timeout … waiting for <locator>` with no "locator resolved to" → locator problem (healable if the element exists under another identity).
- "locator resolved to … element is not enabled/visible/stable" → timing/state problem, not a locator problem.
- Action succeeded, but `Received:` equals the **pre-action state** (e.g. "Show password" after clicking it, empty field, unchanged URL) and the test passes on rerun → **SYNC** (the app was not interactive yet, e.g. before hydration). The classifier labels it ASSERTION_MISMATCH, so check: rerun `npx playwright test <spec> -g "<TC-ID>" --repeat-each=20`. Intermittent → report as SYNC/flaky test issue (not a suspected product defect) and route to the executer to fix the readiness wait; consistent → treat as ASSERTION_MISMATCH. Never heal SYNC.
- `strict mode violation` → ambiguous locator.
- `page.goto: net::ERR_…` → navigation/environment. `apiRequestContext…`/`ECONNREFUSED` → API.

## Report
1. `node scripts/build-report.mjs --run <runId>` (regenerates the summary from artifacts; `--strict` makes the exit code reflect unresolved failures).
2. Present: scope, target URL, commands + exit codes; initial vs final counts; verified repairs (only HEALED records whose tests passed the confirmation rerun); unsuccessful repairs; flaky tests (separately); unresolved failures with category and evidence paths; suspected defects phrased as suspicions with observed vs expected values; files changed; what was not verified.
3. Ensure `allure-report/` shows this run: if it is missing or was built for another run, run `npm run report:allure -- --run <runId>` and record its exit code.
4. Point the user to `artifacts/runs/<runId>/summary.md`, the Allure report (`npm run report:allure:open -- --run <runId>`) and `npx playwright show-report`.
