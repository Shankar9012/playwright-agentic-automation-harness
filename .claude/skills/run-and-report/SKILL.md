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

Every run gets a run ID and writes `artifacts/runs/<runId>/`: `report.json` (Playwright JSON — source of truth), `run.json` (command, exit code, triage), `summary.json`, `summary.md`. Evidence lives in `test-results/` (screenshot, trace, video, error-context) and the HTML report in `playwright-report/`.
Exit codes: 0 all passed · 1 test failures · 2 no usable report (infrastructure). Record the real exit code; never re-label it.

## Classify failures
`npm run test:heal` classifies automatically. To understand a failure manually, read the error in `summary.md`/`report.json`:
- `expect(...)… failed` with a concrete `Received:` → **ASSERTION_MISMATCH** (possible defect or outdated expectation; never auto-fixed).
- `locator.<action>: Timeout … waiting for <locator>` with no "locator resolved to" → locator problem (healable if the element exists under another identity).
- "locator resolved to … element is not enabled/visible/stable" → timing/state problem, not a locator problem.
- `strict mode violation` → ambiguous locator.
- `page.goto: net::ERR_…` → navigation/environment. `apiRequestContext…`/`ECONNREFUSED` → API.

## Report
1. `node scripts/build-report.mjs --run <runId>` (regenerates the summary from artifacts; `--strict` makes the exit code reflect unresolved failures).
2. Present: scope, target URL, commands + exit codes; initial vs final counts; verified repairs (only HEALED records whose tests passed the confirmation rerun); unsuccessful repairs; flaky tests (separately); unresolved failures with category and evidence paths; suspected defects phrased as suspicions with observed vs expected values; files changed; what was not verified.
3. Point the user to `artifacts/runs/<runId>/summary.md` and `npx playwright show-report`.
