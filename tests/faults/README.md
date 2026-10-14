# Fault-injection proofs

Deliberately broken tests that prove the healing workflow against the real site. They run only with `npm run test:faults` or `npm run test:heal -- --project=faults`, never in the normal suite.

- **Test A (broken locator):** a Page Object locator is renamed so it no longer matches an element that is still on the page. Expected result: queued, then repaired by the self-healer, then HEALED after the rerun, then logged.
- **Test B (wrong expected value):** an assertion expects a wrong value. Expected result: classified `ASSERTION_MISMATCH`, never queued, file unchanged, still failing.

This folder is intentionally empty in the framework-only build. The same two scenarios are proven offline and automatically by `tests/unit/healing-workflow.test.mjs`. Live versions get added here once the site's Page Objects exist. Reset them after verification.
