---
name: heal-locator-failures
description: Repair an eligible broken or ambiguous locator in test/Page Object source from a repair-queue item, verify it with a real Playwright rerun via scripts/validate-healing.mjs, and keep or restore it with an audit record. Use only for items queued by scripts/test-with-healing.mjs.
---

# Heal locator failures

## Eligibility (decided by code, confirmed by you)
`utils/healing/classify-failure.mjs` queues an item only for:
| Subtype | Meaning |
|---|---|
| `NOT_FOUND` | action timed out, locator matched nothing, page snapshot shows plausible candidates |
| `PRESENCE_MISS` | visibility assertion found nothing, candidates exist |
| `STRICT_MODE` | locator matched several elements |
| `WRONG_ELEMENT` | locator resolved to the wrong element type for the action |

Never healed (not queued): `ASSERTION_MISMATCH` (wrong value/URL/title), `ELEMENT_ABSENT` (possible product defect), `API`, `NAVIGATION`, `ENVIRONMENT`, `TIMEOUT_INSUFFICIENT_EVIDENCE`, `UNKNOWN`. Even for queued items **you** must confirm the intended element's identity; if you cannot, abandon.

## Evidence to read
From the queue item: `errorMessage`, `locator`, `target` (file/line/statement), `candidates`, `evidence.pageSnapshot` (ARIA YAML), `evidence.errorContext`, `evidence.screenshot`, `evidence.trace` (open with `npx playwright show-trace <path>` if needed). Plus the spec, the Page Object and `docs/locator-map.md`.

## Repair rules
- Edit only the one locator definition statement in `target.file` (or one file in `allowedFiles`).
- Allowed: change the locator chain (`page.getByRole(...)`, `.getByLabel`, `.getByText`, `.getByTestId`, `.locator`, `.filter`, `.and`, `.or`, scoping chains, `{ name, exact, hasText, level, ... }` options). `.first()/.last()/.nth()` only as a last resort — it is flagged as a degraded heal.
- Forbidden (the validator rejects and restores): any `expect` change, expected values or other non-locator literals, test titles, `skip/only/fixme`, timeouts, `force`, waits, try/catch, `evaluate`, new statements, imports, files outside `allowedFiles`, application source.

## Verify (mandatory)
```bash
node scripts/validate-healing.mjs --run <runId> --item <itemId> --diagnosis "<old> → <new>: <evidence>"
```
The script: (1) checks no file outside `allowedFiles` changed (sha256 manifest); (2) validates the patch is locator-only against the byte-exact backup; (3) reruns the affected tests with `--retries=0 --repeat-each=2`, then reruns specs that import the edited Page Object; (4) keeps the patch only if all pass, else restores the backup; (5) appends to `artifacts/healing-log/<runId>.json`.
Exit: 0 HEALED · 1 FAILED_RERUN (restored) · 3 REJECTED (restored) · 2 error.

Abandon when identity cannot be confirmed:
```bash
node scripts/validate-healing.mjs --run <runId> --item <itemId> --abandon "<reason>"
```

Optional dry check of a proposed patch: `node scripts/validate-healing.mjs --check --file <file> --before <copy-of-original>`.

## After all items
The orchestrator runs `node scripts/test-with-healing.mjs --finalize --run <runId>`; only that confirmation rerun determines final pass/fail.
