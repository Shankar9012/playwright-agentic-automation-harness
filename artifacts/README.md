# `artifacts/` — run results and the healing audit trail

```
artifacts/
├── runs/<runId>/                   one directory per run (git-ignored, pruned to RUN_RETENTION)
│   ├── report.json                 Playwright JSON report of the initial run (source of truth)
│   ├── run.json                    mode, project, args, commands + exit codes, triage of every failure
│   ├── repair-queue.json           healing runs only: eligible locator failures + status per item
│   ├── manifest.json               sha256 of protected files when the queue was built (scope check)
│   ├── items/<itemId>/page-snapshot.yml   ARIA snapshot at failure time
│   ├── backups/<itemId>/           byte-exact copies of files the healer may edit (+ journal.json while pending)
│   ├── reruns/<itemId>/*.json      targeted and dependent-spec rerun reports
│   ├── final.json                  confirmation rerun of initially failing tests (after --finalize)
│   ├── summary.json                machine-readable summary
│   └── summary.md                  human-readable report
└── healing-log/<runId>.json        every healing attempt and its outcome (tracked in git, never pruned)
```

Run ID format: `YYYYMMDD-HHMMSS-<8 hex>`. Use `latest` wherever a script accepts `--run`.

## Healing log record
`runId`, `itemId`, `testIds`, `originalStatus`, `category`, `subtype`, `originalLocator`, `replacementLocator`, `filesChanged`, `diagnosis`, `outcome` (`HEALED` | `FAILED_RERUN` | `REJECTED` | `ABANDONED`), `verification` (stage, rerun commands and exit codes, stats, violations, restored files), `evidence` (snapshot, screenshot, trace, rerun reports), `recordedAt`.

## Related outputs outside this folder
- `test-results/`: screenshots, traces, videos and error-context for failed tests. Overwritten on each run.
- `playwright-report/`: the HTML report. Open it with `npm run report:open`.
