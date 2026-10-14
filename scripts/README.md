# `scripts/` — command-line entry points

Thin ESM scripts that call `utils/`. They work the same in Claude Code, in a terminal and in CI.

| Script | npm alias | What it does | Exit codes |
|---|---|---|---|
| `run-tests.mjs [pw args]` | `npm test`, `test:smoke`, `test:faults` | Runs Playwright (default project `chromium`) and writes `artifacts/runs/<runId>/` (report.json, run.json, summary.*). Prunes old runs. | 0 pass · 1 failures · 2 no usable report |
| `test-with-healing.mjs [pw args]` | `npm run test:heal` | **Phase 1** of healing: initial run with retries=0, classification, backups, `repair-queue.json`. | 0 pass · 1 failures, none eligible · 2 infra · **42 queue ready** |
| `test-with-healing.mjs --status --run <id>` | — | Prints the status of each queue item. | 42 items still queued · 0 none queued |
| `validate-healing.mjs --run <id> --item <id> [--diagnosis "…"]` | — | **Phase 2:** verifies one applied repair (scope, locator-only patch, rerun, dependents) and keeps or restores it. | 0 HEALED · 1 FAILED_RERUN · 3 REJECTED · 2 error |
| `validate-healing.mjs --run <id> --item <id> --abandon "reason"` | — | Gives up on an item and restores its files. | 1 |
| `validate-healing.mjs --check --file <f> --before <copy>` | — | Dry-run patch validation; no tests, no state change. | 0 ok · 3 rejected |
| `test-with-healing.mjs --finalize --run <id>` | — | **Phase 3:** reruns every initially failing test, then writes the final report. | 0 all pass · 1 unresolved · 2 infra |
| `build-report.mjs [--run <id>] [--strict]` | `npm run test:report` | Rebuilds `summary.json`/`summary.md` from artifacts. | 0 written (with `--strict`: 1 if unresolved) · 2 missing artifacts |
| `check-target.mjs [url]` | — | Is this URL authorized under `ALLOWED_HOSTS`? | 0 yes · 1 no |
| `check-syntax.mjs` | `npm run check:syntax` | Runs the post-edit checks on every project JS file. | 0 clean · 1 errors |

## The healing handshake (why there are three phases)

A Node script cannot call a Claude Code subagent. The deterministic work is split from the AI work:

```
npm run test:heal                         → exit 42, artifacts/runs/<runId>/repair-queue.json
  (Claude: self-healer edits one locator per item)
node scripts/validate-healing.mjs --run <runId> --item <itemId> --diagnosis "…"   (per item)
node scripts/test-with-healing.mjs --finalize --run <runId>
```

You can also play the self-healer's part by hand: edit the locator, then run `validate-healing.mjs`. The same guardrails apply.
