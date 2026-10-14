---
name: explore-site
description: Explore an authorized website (or one page/flow) with Playwright MCP and record observed behaviour in docs/ (app-context, site-map, test-plan, test-cases, locator-map). Use for discovery of a new site or an undocumented feature before writing tests.
---

# Explore a site and document it

## 1. Prepare
- `node scripts/check-target.mjs <url>` must exit 0.
- Read existing `docs/*.md`. For a feature-scoped request, explore only that feature and update docs incrementally (keep existing content; mark changed facts with the date).

## 2. Explore with Playwright MCP
For each page/flow in scope:
1. `browser_navigate` to it, then `browser_snapshot` (the ARIA snapshot is the source of truth for roles and accessible names).
2. Record: URL/route, page title, h1, landmarks, navigation links (name → href), interactive controls (role, accessible name, label/placeholder, state), forms (fields, required markers, submit control).
3. Exercise behaviour safely:
   - Navigation links → record destination URL.
   - Forms → submit empty, then invalid input (e.g. `not-an-email`, short password). Record each validation message verbatim and where it appears (inline, alert, toast).
   - Authentication → invalid credentials with a synthetic email (`qa-harness+probe@example.invalid`); record the exact error and the URL afterwards. Valid login only with `TEST_USER_*` from `.env` if present.
   - Catalog/detail/cart → record names and prices exactly as shown; add an item to cart and observe the cart state; stop **before** any payment step (record the hand-off URL/host only).
4. Use `browser_console_messages` / `browser_network_requests` when something fails, and note errors.
5. Close the browser when done (`browser_close`).

Never: complete a payment, place an order, delete or modify persistent data, use real personal data, invent credentials, or follow links to unauthorized hosts.

## 3. Write the docs (create from these structures if missing)
Replace the `Status: NOT EXPLORED` banner with `Status: explored <YYYY-MM-DD> — scope: <pages/flows>`.
- **docs/app-context.md** — base URL, environment, tech hints, authentication model, test-data dependencies, third-party hand-offs, sections *Observed*, *Specified* (only given requirements), *Assumptions*, *Unavailable / unverified* (with reason).
- **docs/site-map.md** — route table (`Route | Page | Reached from | Auth required | Notes`) and a navigation tree.
- **docs/test-plan.md** — scope, out of scope (with reason), risk-based priorities (P1 revenue/auth/core navigation, P2 validation and secondary flows, P3 cosmetic), test types, environments, entry/exit criteria.
- **docs/test-cases.md** — table per feature: `ID | Title | Preconditions | Steps | Expected result (observed) | Priority | Tags | Automation status` (`Not automated` / `Automated: tests/specs/x.spec.js` / `Blocked: reason`). IDs are stable: `TC-<AREA>-<NNN>` (e.g. `TC-AUTH-001`).
- **docs/locator-map.md** — per page: `Element | Role | Accessible name / label | Preferred locator | Fallback | Page Object property`. Preferred locator follows the priority in CLAUDE.md.

## 4. Return
Pages/flows explored, docs changed, P1 test cases, unavailable features, assumptions and open questions for the user.
