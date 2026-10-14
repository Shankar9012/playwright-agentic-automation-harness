# Test plan

> **Status: explored 2026-10-14 — scope: authentication (Login, Signup, Logout redirect).** Other features: NOT EXPLORED.

## Scope
- Login page `/login`: rendering, navigation to/from it, client-side validation, invalid-credential error, show/hide password, successful login destination (credential-dependent).
- Signup page `/signup`: rendering, navigation to/from it, client-side validation (required fields, email format, password min length 8), duplicate-email error, successful signup destination.
- Logout redirect (only as the cleanup step of authenticated tests).

## Out of scope (with reason)
- Catalog, product detail, cart, orders, profile, checkout/Stripe — not part of this request; not explored.
- Email confirmation — no mailbox; the app does not require it to log in.
- Password reset — no UI exists on `/login`.
- Visual/layout and cross-browser checks — harness runs Chromium; native validation text is browser-specific.

## Risk-based priorities
- **P1** — valid login (needs env creds), invalid-credential rejection, signup success, duplicate-email rejection, navigation to login/signup from header.
- **P2** — required-field / email-format / password-length validation, links between login and signup, show/hide password, logout redirect.
- **P3** — headings and cosmetic text, home CTA "Create an account".

## Test types and environments
- E2E UI tests with `@playwright/test`, Chromium project, against `BASE_URL=https://qa-demo-website.vercel.app`.
- Native validation is asserted via the input's validity state / unchanged URL rather than Chromium bubble text (see app-context A2).
- Data: synthetic emails `qa-harness+<timestamp>@example.invalid`; valid login only from `TEST_USER_EMAIL`/`TEST_USER_PASSWORD`, skipped with a clear reason when unset.

## Entry / exit criteria
- **Entry:** target host reachable and in `ALLOWED_HOSTS`; docs/locator-map.md current.
- **Exit:** all P1/P2 cases automated or marked Blocked with reason; suite executed with real pass/fail counts reported; failures classified.

## Risks / open questions
- Signup success creates a persistent account on every run (no delete UI was explored). Confirm with the owner whether automated signup is acceptable on this demo instance, or keep that case opt-in.
- Signup shows "Check your email to confirm" while already logging the user in — possible defect; clarify the expected behaviour before asserting the post-signup session state.
