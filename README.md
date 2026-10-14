# Playwright QA Agent Harness

An AI-assisted, **application-agnostic** end-to-end testing harness. You describe what you want in plain English inside Claude Code (for example *"write automation for the login page"*). The harness then:

1. explores the site with the Playwright MCP browser,
2. documents what it actually observed,
3. writes Page-Object-based Playwright tests,
4. runs them,
5. repairs broken locators in the source code, under hard guardrails,
6. reports only what the test results prove.

The harness is built so it never fakes a pass. Wrong prices, wrong messages and missing features stay failed and are reported. Only locator drift (the page still has the element, under a new name or markup) is repaired, and a repair is kept only after a real Playwright rerun passes with the original assertions unchanged.

- **Default target:** `https://qa-demo-website.vercel.app`. To test any other site you are authorized to test, change `BASE_URL` and `ALLOWED_HOSTS` in `.env`; the code does not need to change.
- **Stack:** Node.js ≥ 20, JavaScript ES modules, `@playwright/test` 1.64.0 (pinned), Playwright MCP, Claude Code agents, skills and hooks.

> **Current state:** the framework is built and verified, and nothing has been explored yet. The `docs/` files are placeholders marked `Status: NOT EXPLORED`, and `tests/specs/` is empty until you ask Claude to explore the site or write tests (see [Working with Claude Code](#working-with-claude-code)).

---

## Quick start

```bash
npm install
npx playwright install chromium
cp .env.example .env            # adjust BASE_URL / ALLOWED_HOSTS / optional TEST_USER_*
npm run validate                # lint + syntax sweep + 45 harness unit tests
```

Open the folder in Claude Code. `CLAUDE.md`, the agents, the skills and the hooks are picked up from the project automatically. The Playwright MCP server must be available, either from your user settings or from a project `.mcp.json`.

---

## How the system works

```
                ┌───────────────────────────── Claude Code ─────────────────────────────┐
 your prompt ──►│ /qa-automation skill  (main thread = orchestrator)                     │
                │   1. check-target.mjs   → is the URL authorized?                       │
                │   2. read docs/         → is this page/feature already documented?     │
                │   3. route the request  → explore | automate | run | heal | report     │
                │                                                                       │
                │   planner ──► Playwright MCP browser ──► docs/*.md                    │
                │   executer ──► tests/pages + tests/specs ──► scripts/run-tests.mjs    │
                │   self-healer ──► one locator edit ──► scripts/validate-healing.mjs   │
                │   result-driven ──► scripts/build-report.mjs ──► summary.md           │
                │                                                                       │
                │   hooks: guard-commands (before shell commands)                       │
                │          validate-after-edit (after every file edit)                  │
                └───────────────────────────────────────────────────────────────────────┘
                                         │ deterministic code, unit-tested
                                         ▼
          utils/ (config · guardrails · healing · reporting · io)   scripts/ (CLI)
                                         │
                                         ▼
          artifacts/runs/<runId>/  ·  artifacts/healing-log/  ·  playwright-report/
```

- **Agents decide; code enforces.** The rules that must never be broken are implemented in `utils/` and are unit-tested, not just written in prompts:
  - which files may be edited during healing,
  - that a repair changes locators only,
  - that a failed repair is restored,
  - that the final status comes from a real rerun.
- **Playwright runs without the AI.** Every test is a normal Playwright test (`npx playwright test` works). Claude Code adds exploration, authoring and repair on top.
- **One orchestrator.** Claude Code subagents cannot start other subagents. The `/qa-automation` skill therefore turns the main conversation into the orchestrator. Alternatively, start Claude with `claude --agent qaautomation`.

---

## Working with Claude Code

Type requests naturally. Prefixing them with `/qa-automation` makes the routing explicit, but plain requests also work because the skill is described as the entry point for QA work. Each example below shows what you type and what the system does.

### 1. "Explore https://qa-demo-website.vercel.app"
**Route: Discover.**
1. `node scripts/check-target.mjs https://qa-demo-website.vercel.app` checks that the host is authorized.
2. The **planner** agent opens the site through Playwright MCP and visits the navigation, catalog, product detail, login, signup and cart pages. For each page it takes an accessibility snapshot. It tries invalid form input and records the validation messages word for word. It stops before any payment step.
3. It writes `docs/app-context.md`, `site-map.md`, `test-plan.md`, `test-cases.md` and `locator-map.md`. Each fact is labeled **Observed**, **Specified** or **Assumption**. Anything it could not reach (for example a page that needs credentials) is listed as *Unavailable*.
4. **You get:** the pages explored, the highest-priority test cases, unavailable features and open questions. No test code is written.

### 2. "Write automation for this URL: https://qa-demo-website.vercel.app"
**Route: Discover (only if `docs/` is unexplored), then Automate the P1 flows from `docs/test-plan.md`.**
1. If the docs are already filled in, exploration is skipped.
2. The **executer** agent:
   - creates Page Objects in `tests/pages/` (one per page; every locator defined once in the constructor),
   - registers them as fixtures in `tests/fixtures/test.js`,
   - writes specs in `tests/specs/<feature>.spec.js` using Arrange–Act–Assert and the exact values observed during exploration,
   - tags them (`@smoke`, `@auth`, …).
3. The `validate-after-edit` hook checks every file the executer writes. It fails the edit on syntax errors, CommonJS, a missing import extension or `test.only`, and warns about inline locators.
4. The executer runs `npm run lint` and then `node scripts/run-tests.mjs tests/specs/...`.
5. **You get:** the files created, real pass/fail counts, the run ID and the report path. If the site behaves differently from the docs, the test stays failing and is reported. The assertion is never weakened.

### 3. "Write automation code for the login page"
**Route: Automate (feature-scoped).**
1. The orchestrator checks `docs/site-map.md` and `docs/locator-map.md` for the login page.
   - **Already documented:** exploration is skipped completely.
   - **Not documented:** the planner explores **only `/login`**: the fields, the "Show password" toggle, the empty-submit and invalid-credential messages, and where the page goes afterwards.
2. The executer reuses existing Page Objects (for example a shared header) and creates `tests/pages/login-page.js` and `tests/specs/login.spec.js`. Typical cases:
   - page renders,
   - empty submit shows the required-field validation,
   - invalid credentials show the observed error,
   - "Show password" toggles the field type,
   - the link to signup works.
3. Tests that need a real account run only when `TEST_USER_EMAIL` and `TEST_USER_PASSWORD` are set in `.env`. Otherwise they are skipped with a stated reason. Credentials are never invented.
4. The new spec is run and the results are reported.

### 4. "Add a test that signup rejects an invalid email"
**Route: Automate, reusing the existing context.** No re-exploration happens if the signup page is already in `docs/`. If the exact validation message was never recorded, a short planner pass on `/signup` captures it first, so the expected text is observed rather than guessed.

### 5. "Run the smoke tests" / "Run the login tests"
**Route: Run.** The executer runs `npm run test:smoke` or `node scripts/run-tests.mjs tests/specs/login.spec.js`. The result is the run ID, the real exit code, the counts, and the paths to `artifacts/runs/<runId>/summary.md` and the HTML report.

### 6. "Run the tests and heal broken locators"
**Route: Heal.** This is a fixed sequence:
1. `npm run test:heal` runs the suite with retries=0, then sorts every failure into a category (rules in [docs/architecture.md](docs/architecture.md#failure-classification-utilshealingclassify-failuremjs)):
   - **Locator drift** goes into `repair-queue.json` (exit code 42).
   - **Wrong values, unexpected login results, API errors, missing elements and timeouts without evidence** are not queued; they are reported instead.
2. For each queued item, one at a time, the **self-healer** agent:
   - reads the page snapshot, screenshot and error,
   - confirms which element the test meant to use (for example the button renamed from "Add to bag" to "Add to cart"),
   - edits that one locator in the Page Object,
   - runs `scripts/validate-healing.mjs`.
3. `validate-healing.mjs` keeps the fix only if all of these hold:
   - no other file changed,
   - the change is a locator-only patch,
   - the affected tests pass twice in a rerun,
   - the specs that share the Page Object still pass.

   Otherwise it restores the file from its own backup (never with git). Every attempt is logged to `artifacts/healing-log/<runId>.json`.
4. `--finalize` reruns every test that failed at the start. That rerun alone decides the final pass/fail.
5. The **result-driven** agent reports initial results, final results, verified repairs, unsuccessful repairs, flaky tests, unresolved failures and suspected defects, with evidence paths.

### 7. "Give me a QA report for the last run"
**Route: Report.** `node scripts/build-report.mjs --run latest` rebuilds the summary from the artifacts. The result-driven agent presents it without upgrading any result.

### 8. "Write automation for https://staging.other-shop.com"
`check-target.mjs` rejects any host that is not in `ALLOWED_HOSTS`. Claude stops and tells you to add `BASE_URL=https://staging.other-shop.com` and `ALLOWED_HOSTS=staging.other-shop.com` to `.env`. After that, the same workflow runs against the new site. No code changes are needed, and the harness never switches sites on its own.

### What the system will refuse or block
| Request / action | What happens |
|---|---|
| "Make the failing price test pass" | Assertions and expected values are never changed. The failure is reported as a suspected defect or an outdated expectation. |
| A healing edit touching `expect`, `test.skip`, timeouts or another file | `validate-healing.mjs` rejects the edit and restores the file. |
| `git reset --hard`, `git clean -f`, `rm -rf tests`, force push | Blocked by the `guard-commands` hook. |
| Stripe CLI, `api.stripe.com`, live keys, production deploys | Blocked by the `guard-commands` hook. |
| Completing a checkout or payment | The planner and executer stop at the payment hand-off. |
| Testing an unlisted host | `check-target.mjs` refuses it. |

---

## Running without Claude (CI or local)

| Command | Purpose |
|---|---|
| `npm test` | Chromium suite; writes `artifacts/runs/<runId>/summary.md` and the HTML report |
| `npm run test:smoke` | `@smoke` tests only |
| `npm run test:headed` / `npm run test:ui` | Debugging |
| `npm run test:heal` | Initial run, classification and repair queue (exit 42 means items are waiting for Claude) |
| `node scripts/validate-healing.mjs --run <id> --item <id>` | Verify, keep or restore one repair |
| `node scripts/test-with-healing.mjs --finalize --run <id>` | Confirmation rerun and final report |
| `npm run test:report -- --run latest` | Rebuild the report from artifacts |
| `npm run validate` | ESLint, syntax sweep and harness unit tests |
| `npm run report:open` | Open the Playwright HTML report |

Exit codes: `0` passed · `1` test failures · `2` infrastructure error · `3` healing patch rejected · `42` repair queue waiting for the orchestrator.

---

## Repository map

| Path | What it is | Details |
|---|---|---|
| `CLAUDE.md` | Project rules Claude Code loads in every session | — |
| `.claude/` | Agents, skills, hooks, settings | [.claude/README.md](.claude/README.md) |
| `docs/` | What is known about the target site, plus the harness architecture | [docs/README.md](docs/README.md) |
| `tests/` | Page Objects, fixtures, data, specs, fault proofs, harness unit tests | [tests/README.md](tests/README.md) |
| `utils/` | Deterministic logic: config, guardrails, healing, reporting, IO | [utils/README.md](utils/README.md) |
| `scripts/` | Command-line entry points | [scripts/README.md](scripts/README.md) |
| `artifacts/` | Per-run results and the healing audit log | [artifacts/README.md](artifacts/README.md) |
| `playwright.config.js` | ESM config: base URL, projects, timeouts, HTML + JSON reporters | — |

For the deep dive (classification table, patch-validation design, hook schema), see [docs/architecture.md](docs/architecture.md).
