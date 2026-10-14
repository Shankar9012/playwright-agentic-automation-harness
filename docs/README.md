# `docs/` — knowledge about the target application

The planner agent writes these files from what it **observed** in the browser. The executer and the self-healer read them. They are the reason a feature-specific request ("write tests for the cart") does not re-explore the whole site.

| File | Written by | Read by | Contents |
|---|---|---|---|
| `app-context.md` | planner | everyone | base URL, auth model, data dependencies, hand-offs; **Observed / Specified / Assumptions / Unavailable** |
| `site-map.md` | planner | orchestrator, executer | routes, navigation tree, auth requirements |
| `test-plan.md` | planner | orchestrator | scope, exclusions, risk priorities (P1–P3) |
| `test-cases.md` | planner (cases), executer (automation status) | executer | `TC-<AREA>-<NNN>` cases with observed expected results |
| `locator-map.md` | planner (locators), executer (Page Object column) | executer, self-healer | element → role/name → preferred locator → Page Object property |
| `architecture.md` | maintained by hand | humans | how the harness works (flows, classification, hooks, retention) |

## Lifecycle
1. **New site:** every file except `architecture.md` starts with `Status: NOT EXPLORED`. The orchestrator treats such files as undocumented.
2. **Discovery** (`/qa-automation explore <url>`): the banner becomes `Status: explored <date> — scope: …` and the tables are filled in.
3. **Feature request:** only the missing page or flow is explored, and its rows are added. Existing rows stay.
4. **UI change detected by healing:** the self-healer's repaired locator is recorded in the healing log. Update `locator-map.md` when you accept the change.

## Rules
- Expected values (prices, messages, URLs) are copied word for word from the UI. Tests assert exactly these values.
- Anything not observed goes under **Assumptions** with a note on how to confirm it. It never goes under Observed.
- To point the harness at a different site, reset these files to the skeletons (or keep them in a branch per site) so knowledge about one site never leaks into another.
