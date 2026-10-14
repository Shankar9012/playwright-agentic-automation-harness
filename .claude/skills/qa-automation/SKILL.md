---
name: qa-automation
description: Entry point for every QA request in this Playwright harness. Use when the user asks to explore a website, write automation for a URL/page/feature (e.g. "write automation for the login page"), run tests, run and heal failing locators, or produce a QA report. Routes the request and delegates to the planner, executer, self-healer and result-driven agents.
argument-hint: "[request, e.g. 'write automation for the login page' or 'explore https://example.com']"
---

# QA automation router

You (the main conversation) are the orchestrator. Subagents cannot spawn other subagents, so **you** delegate each stage with the Agent tool and run the deterministic scripts yourself. Do only the stages the request needs.

Request: $ARGUMENTS

## Step 0 — Target and context (always, ~1 minute)
1. Target URL = URL in the request, else `BASE_URL`. Run `node scripts/check-target.mjs <url>`; on exit 1 stop and explain how to authorize it. If the URL differs from `BASE_URL`, tell the user to update `.env` before tests can run against it.
2. Inventory existing context: `docs/*.md`, `tests/pages/`, `tests/specs/`, `tests/fixtures/test.js`. Decide which of the requested pages/flows are already documented (present in `docs/site-map.md` **and** `docs/locator-map.md`). A docs file whose header says `Status: NOT EXPLORED` counts as undocumented.

## Step 1 — Route
| The user says… | Run |
|---|---|
| "explore <url>", "map the site", new site with no docs | **A. Discover** |
| "write automation/tests for <url>" (whole site) | A (if undocumented) → **B. Automate** for the top-priority flows in `docs/test-plan.md` |
| "write automation for the login page / cart / <feature>" | A *scoped to that feature* only if it is undocumented → **B** for that feature |
| "run tests / smoke / login tests" | **C. Run** |
| "run and heal", "fix broken locators", "tests broke after UI change" | **D. Heal** |
| "report", "what failed", "summary of last run" | **E. Report** |

Combine stages when asked ("write login tests and run them" → B then C). State the route you chose in one line before starting.

## A. Discover → `planner` agent
Brief: target URL, scope (whole site or the named feature), existing docs to update, safety limits (no payments/orders/account changes, no invented credentials). Expect: docs updated, test-case IDs, unavailable features, assumptions. Skill used by the agent: `explore-site`.

## B. Automate → `executer` agent
Brief: feature, the test-case IDs from `docs/test-cases.md`, existing Page Objects/fixtures to reuse, and "run the new spec and report results". Expect: files changed, lint/syntax status, run ID, pass/fail per test. Skill used: `generate-e2e-tests`.
- If the executer reports a missing fact, run a scoped A, then resume B.
- If new tests fail because the app differs from the docs, do **not** heal; report it (route E).

## C. Run → `executer` agent (or directly)
`node scripts/run-tests.mjs [spec files | --grep @tag]`. Then route E with the run ID.

## D. Heal (strict sequence)
1. `node scripts/test-with-healing.mjs [scope]` → note run ID and exit code (0 pass, 1 failures not eligible, 2 infra error, 42 queue ready).
2. Exit 42: read `artifacts/runs/<runId>/repair-queue.json`; for each `QUEUED` item, **one at a time**, delegate to `self-healer` with `runId` + `itemId`. Wait for its outcome before the next item.
3. `node scripts/test-with-healing.mjs --finalize --run <runId>` (confirmation rerun; this decides final pass/fail).
4. Route E.
Never edit tests yourself during D, never retry an item in the same run, never treat ASSERTION_MISMATCH / ELEMENT_ABSENT / API / NAVIGATION / TIMEOUT_INSUFFICIENT_EVIDENCE failures as healable.

## E. Report → `result-driven` agent
Brief: run ID. Expect the report structure from `run-and-report`. Relay it to the user without upgrading any result.

## Final message to the user
Route taken, agents used, files changed, commands + real exit codes, results (initial/final/healed/unresolved), report path (`artifacts/runs/<runId>/summary.md`, HTML via `npx playwright show-report`), open assumptions and anything not verified.
