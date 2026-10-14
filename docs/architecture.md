# Harness architecture

## Components and responsibilities

| Layer | Location | Responsibility |
|---|---|---|
| Project instructions | `CLAUDE.md` | Persistent rules Claude Code loads every session |
| Orchestration | `.claude/skills/qa-automation`, `.claude/agents/qaautomation.md` | Route requests, delegate, enforce order |
| Specialist agents | `.claude/agents/{planner,executer,self-healer,result-driven}.md` | Discovery, test engineering, locator repair, reporting |
| Workflow skills | `.claude/skills/*/SKILL.md` | Step-by-step procedures the agents follow |
| Hooks | `.claude/hooks/*.mjs`, registered in `.claude/settings.json` | Deterministic command guard + post-edit validation |
| Deterministic logic | `utils/` | Config, guardrails, classification, healing verification, reporting, IO |
| CLI | `scripts/` | Runnable entry points that orchestrate `utils/` |
| Tests | `tests/` | Page Objects, fixtures, data, specs, fault proofs, harness unit tests |
| Evidence | `artifacts/runs/<runId>/`, `artifacts/healing-log/`, `test-results/`, `playwright-report/` | Machine-readable results and audit trail |

Agents decide; code enforces. Any rule that must never be broken (scope of edits, locator-only patches, restore on failure, final status from a real rerun) lives in `utils/` and is unit-tested, so an agent cannot talk its way past it.

## Request flow

```
user prompt ──► /qa-automation skill (main thread = orchestrator)
                 │  check-target.mjs  ─ authorized host?
                 │  docs/ inventory   ─ already documented?
                 ├─► planner      (MCP exploration → docs/*.md)         only if needed
                 ├─► executer     (Page Objects + specs → run-tests.mjs)
                 ├─► heal loop    (test-with-healing.mjs ⇄ self-healer ⇄ validate-healing.mjs)
                 └─► result-driven (build-report.mjs → summary.md)
```
Subagents cannot start other subagents, so the orchestrator runs in the main conversation (the skill) or as the main-thread agent (`claude --agent qaautomation`).

## Healing handshake

```
test-with-healing.mjs ── initial run (retries=0) ──► report.json
        │ parse ► classify ► collect diagnostics ► back up target files ► manifest
        ▼
repair-queue.json (only ELIGIBLE items)          exit 42
        │
        ▼  orchestrator → self-healer (one item at a time)
self-healer: confirm target identity in page snapshot → edit ONE locator definition
        │
        ▼
validate-healing.mjs --run --item
   1 scope   : sha256 manifest – nothing outside allowedFiles changed
   2 patch   : validate-healing-patch – locator-only, assertions/literals/skips untouched, syntax OK
   3 rerun   : affected tests, --retries=0 --repeat-each=2; then specs importing the Page Object
   4 decide  : all pass → keep (HEALED) · else restore from backup (FAILED_RERUN / REJECTED)
   5 audit   : artifacts/healing-log/<runId>.json
        │
        ▼
test-with-healing.mjs --finalize   confirmation rerun of every initially failing test → final.json
build-report.mjs                   summary.json + summary.md from real artifacts
```

Exit codes — `test-with-healing`: 0 pass · 1 failures not healable · 2 infrastructure · 42 queue ready. `validate-healing`: 0 healed · 1 failed rerun · 3 rejected · 2 error.

## Failure classification (`utils/healing/classify-failure.mjs`)

Ordered rules, first match wins; the assertion rule runs before any locator rule (veto).

| Evidence | Category | Auto repair |
|---|---|---|
| browser launch, Target closed, ENOENT, Syntax/Type/ReferenceError | ENVIRONMENT | No |
| `page.goto:` / `net::ERR_*` | NAVIGATION | No |
| `apiRequestContext.*`, ECONNREFUSED, 4xx/5xx text | API | No |
| `expect(...)` with a concrete `Received` value / `unexpected value` | ASSERTION_MISMATCH | No — report |
| overall test timeout, no locator evidence | TIMEOUT_INSUFFICIENT_EVIDENCE | No |
| `strict mode violation` | LOCATOR / STRICT_MODE | Yes, after identity confirmed |
| "Element is not an <input>…" | LOCATOR / WRONG_ELEMENT | Yes |
| action timeout, call log "waiting for X" with no "locator resolved to"; snapshot has candidates | LOCATOR / NOT_FOUND | Yes |
| `toBeVisible` with "element(s) not found"; snapshot has candidates | LOCATOR / PRESENCE_MISS | Yes |
| locator resolved but element never actionable | TIMEOUT_INSUFFICIENT_EVIDENCE | No |
| locator matched nothing, no snapshot | TIMEOUT_INSUFFICIENT_EVIDENCE | No |
| locator matched nothing, nothing similar on the page | ELEMENT_ABSENT | No — possible defect |

Page evidence comes from Playwright's `error-context` attachment or the `healing-aria-snapshot` attached by `tests/fixtures/test.js`. Patterns were captured from real `@playwright/test` 1.64 output (`tests/unit/fixtures/`); Playwright is pinned, and an upgrade requires re-capturing those fixtures.

## Patch validation (`utils/guardrails/validate-healing-patch.mjs`)

No parser dependency: a tokenizer (`js-source.mjs`) splits the original and patched file into statements; an LCS diff finds changed statements. Each changed statement must be `<same target> = <locator expression>` (or `return <locator expression>`), where the expression matches a whitelist grammar: root identifier → `.locator/.getBy*/.filter/.and/.or/.first/.last/.nth/.frameLocator(...)` with literal arguments and allowed option keys. Defence-in-depth invariants then check the whole file: identical `expect` statements, no new `skip/only/fixme/fail`, `timeout`, `force`, waits, `evaluate`, try/catch, identical imports, identical multiset of non-locator literals. One statement per attempt; `.first()/.nth()` accepted but flagged `DEGRADED_HEAL`.

## Hooks

| Event | Matcher | Script | Behaviour |
|---|---|---|---|
| PreToolUse | `Bash\|PowerShell` | `guard-commands.mjs` | `permissionDecision: "deny"` for destructive git/rm, system, deploy, payment, unauthorized network writes; exit 2 on malformed input |
| PostToolUse | `Write\|Edit\|MultiEdit` | `validate-after-edit.mjs` | syntax + ESM + convention checks on the edited JS file; `decision: "block"` feedback on errors, `additionalContext` for warnings |

Inspect with `/hooks` in Claude Code; test manually:
```bash
echo '{"tool_name":"Bash","tool_input":{"command":"git reset --hard"}}' | node .claude/hooks/guard-commands.mjs
echo '{"tool_name":"Edit","tool_input":{"file_path":"tests/pages/base-page.js"}}' | node .claude/hooks/validate-after-edit.mjs
```
Both are covered by `tests/unit/guardrails.test.mjs`.

## Retention

- `artifacts/runs/` keeps the newest `RUN_RETENTION` runs (default 20); older run directories are pruned by `run-tests.mjs` / `test-with-healing.mjs`. Git-ignored.
- `artifacts/healing-log/` is never pruned and is tracked in git: it is the audit trail of every source repair.
- `test-results/` and `playwright-report/` are overwritten by each Playwright run.
