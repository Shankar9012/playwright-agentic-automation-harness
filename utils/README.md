# `utils/` — deterministic harness logic

Pure Node.js (built-ins only), ES modules (`.mjs`). The scripts in `scripts/`, the hooks in `.claude/hooks/` and the unit tests all call into this layer. **Hard rules live here**, so no agent can bypass them.

```
utils/
├── config/
│   ├── runtime-config.mjs   BASE_URL, ALLOWED_HOSTS, timeouts, workers, retries, run ID, artifact paths, .env loader
│   └── run-paths.mjs        locate runs (latest / by ID) and apply the RUN_RETENTION policy
├── guardrails/
│   ├── validate-target-url.mjs     http/https only, host must be in ALLOWED_HOSTS, no embedded credentials
│   ├── command-policy.mjs          shell-command allow/deny rules (used by guard-commands hook)
│   ├── validate-changed-files.mjs  post-edit checks: syntax, ESM, import extensions, .only, POM warnings
│   ├── validate-healing-patch.mjs  locator-only patch validator (allow-list grammar + whole-file invariants)
│   ├── js-source.mjs               tokenizer, statement splitter, `node --check` syntax check
│   └── safe-restore.mjs            byte-exact file backup/restore + crash journal (never git)
├── healing/
│   ├── classify-failure.mjs  Playwright error → LOCATOR | ASSERTION_MISMATCH | NAVIGATION | API | ENVIRONMENT | ELEMENT_ABSENT | TIMEOUT_INSUFFICIENT_EVIDENCE | UNKNOWN
│   ├── collect-diagnostics.mjs  page snapshot, screenshot/trace paths, stack frames, where the locator is defined
│   ├── repair-queue.mjs      build repair-queue.json (eligible items only), backups, sha256 manifest
│   ├── validate-healing.mjs  verify one item: scope → patch → rerun → keep/restore → log
│   └── record-healing.mjs    append-only audit log in artifacts/healing-log/<runId>.json
├── reporting/
│   ├── parse-playwright-json.mjs  JSON reporter → normalized test records (missing report = error)
│   ├── build-summary.mjs     initial vs final, repairs, flaky, unresolved, suspected defects
│   ├── write-report.mjs      summary.json + summary.md
│   └── generate-allure.mjs   build/serve the Allure report from a run's allure-results (pinned Allure 3 CLI)
├── execution/
│   └── run-playwright.mjs    spawn Playwright Test with a JSON report destination
└── io/
    ├── read-json.mjs         read/parse with contextual errors (JsonReadError)
    └── write-json-atomic.mjs temp file + rename, Windows lock retry
```

## Data flow during a healing run

```
run-playwright ─► report.json ─► parse-playwright-json ─► classify-failure ◄─ collect-diagnostics
                                                               │ eligible only
                                                               ▼
                                     repair-queue (+ safe-restore backups, manifest)
                                                               │ healer edits one locator
                                                               ▼
validate-healing: manifest diff ─► validate-healing-patch ─► run-playwright (rerun) ─► keep | safe-restore
                                                               │
                                                               ▼
                                     record-healing ─► build-summary ─► write-report
```

## Design rules
- **Allow-list, not deny-list.** A healing patch is accepted only if every changed statement *is* a locator definition built from known locator methods. Anything else is rejected.
- **Evidence or nothing.** A missing JSON report raises `ReportError`; it is never treated as "no failures". A timeout without a page snapshot is never eligible for repair.
- **File-scoped recovery.** Backups and restores touch only the files a repair targets, so unrelated working-tree changes survive.
- **Version-coupled patterns.** `classify-failure.mjs` matches Playwright's error text, which was verified against 1.64. When upgrading Playwright, re-capture `tests/unit/fixtures/pw-*.report.json` and run `npm run test:unit`.

Unit tests for this layer live in `tests/unit/`. Run them with `npm run test:unit`.
