# Locator map

> **Status: NOT EXPLORED.** Filled by the planner agent from ARIA snapshots; the executer adds the Page Object column. The self-healer reads this file to confirm a broken locator's intended target.

Locator priority: `getByRole` (+name) → `getByLabel` → `getByPlaceholder` → `getByText` → `getByTestId` → scoped CSS.

| Page | Element | Role | Accessible name / label | Preferred locator | Fallback | Page Object property |
|---|---|---|---|---|---|---|
