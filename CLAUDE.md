# Playwright QA Agent Harness

AI-assisted, application-agnostic Playwright E2E harness. Claude Code explores an authorized site, documents it, writes Page-Object-based tests, runs them, repairs broken locators in source under hard guardrails, and reports only what execution evidence supports. Default target: `https://qa-demo-website.vercel.app` (set `BASE_URL` + `ALLOWED_HOSTS` in `.env` for another site).

Stack: Node.js ≥ 20, JavaScript ES modules only, `@playwright/test` (pinned), Playwright MCP for browser exploration, `node:test` for harness unit tests.

## Code conventions
- ESM only: `import`/`export`, never `require`/`module.exports`. Relative imports include the extension (`./login-page.js`). Built-ins use the `node:` prefix.
- `.js` for project modules and tests, `.mjs` for CLI scripts, hooks and `utils/`.
- `async`/`await` everywhere; small single-purpose modules; JSDoc where it helps.
- No TypeScript, no new dependencies without a stated reason.

## Test conventions
- Page Object Model: one class per page in `tests/pages/`, extending `BasePage`. Every locator is defined once in the constructor as `this.name = page.getBy...(...)` — this is the only shape the healer may edit.
- Specs in `tests/specs/<feature>.spec.js` import `test`/`expect` from `tests/fixtures/test.js`, receive Page Objects as fixtures, follow Arrange–Act–Assert, and never put `page.locator/getBy*` inside `expect()`.
- Tests are isolated (no ordering dependencies), tagged (`tests/support/tags.js`), and use web-first assertions. No `waitForTimeout`, no `test.only`.
- Locator priority: `getByRole` (+ name) → `getByLabel` → `getByPlaceholder` → `getByText` → `getByTestId` → scoped CSS. Avoid XPath, positional `.nth()/.first()` and styling classes.
- Test data in `tests/data/`; credentials only from env (`TEST_USER_EMAIL/PASSWORD`). Never invent credentials, requirements or expected values.

## Discovery and documentation
- Undocumented app → explore first (planner agent + `explore-site` skill) and write `docs/app-context.md`, `site-map.md`, `test-plan.md`, `test-cases.md`, `locator-map.md`.
- Feature-specific request → reuse existing `docs/`; explore only the missing page/flow and update the docs incrementally.
- Keep **Observed** behaviour, **Specified** expectations and **Assumptions** separate. Unobserved functionality is never documented as confirmed.

## Agents (`.claude/agents/`)
| Agent | Owns | Must not |
|---|---|---|
| `qaautomation` | Routing, ordering, delegation, running validation scripts | Write tests or heal directly |
| `planner` | MCP exploration, docs | Edit test code; perform destructive actions |
| `executer` | Page Objects, fixtures, specs, test runs | Change docs' observed facts; heal |
| `self-healer` | One queued locator repair at a time | Touch assertions, expected values, skips, app source |
| `result-driven` | Evidence-based reports | Claim anything not in reports/logs |

Subagents cannot spawn subagents: orchestration runs in the main thread via the `/qa-automation` skill (or `claude --agent qaautomation`).

## Self-healing policy
- Eligible only when the classifier marks a failure `LOCATOR` (not found with plausible candidates, strict-mode ambiguity, wrong element type) **and** the healer confirms the intended target in the page snapshot.
- Never eligible: assertion/value mismatches, unexpected login result or destination, API/backend errors, genuinely absent elements, timeouts without evidence.
- One attempt per failed test per run. The healer edits the locator definition only, then runs `scripts/validate-healing.mjs`, which validates the patch, reruns with the original assertions, keeps or restores, and logs the outcome. Never use git to revert.

## Hooks and guardrails
- `PreToolUse` (`Bash|PowerShell`) → `.claude/hooks/guard-commands.mjs`: blocks destructive git/rm, system, production-deploy, payment and unauthorized network-write commands.
- `PostToolUse` (`Write|Edit|MultiEdit`) → `.claude/hooks/validate-after-edit.mjs`: syntax + convention checks on the edited JS file; fix anything it reports.
- Hard rules live in `utils/guardrails/` and are unit-tested; do not bypass or edit them to make work pass.

## Commands
```bash
npm test                         # chromium suite → artifacts/runs/<runId>/summary.md
npm run test:smoke               # @smoke only
npm run test:heal                # initial run + classification + repair queue (exit 42 = queue ready)
node scripts/validate-healing.mjs --run <runId> --item <itemId> --diagnosis "..."
node scripts/test-with-healing.mjs --finalize --run <runId>   # confirmation rerun + final report
npm run test:report -- --run <runId|latest>
npm run validate                 # eslint + syntax sweep + unit tests
```

## Security
Only authorized hosts (`ALLOWED_HOSTS`). Never complete real payments or orders, never use live payment keys, never perform destructive production actions, never read or print `.env` secrets, never modify the target application's source.

## Definition of done
Code passes `npm run validate`; affected E2E tests were actually executed; docs reflect observed behaviour; the report states real pass/fail counts, repairs (only those verified by rerun), unresolved failures with evidence paths, and anything not verified.
