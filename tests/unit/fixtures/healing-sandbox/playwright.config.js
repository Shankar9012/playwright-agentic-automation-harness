import { defineConfig } from '@playwright/test';

// Offline sandbox project used by tests/unit/healing-workflow.test.mjs. Tests render their own
// HTML with page.setContent(), so no network or live site is involved.
export default defineConfig({
  testDir: './tests/specs',
  retries: 0,
  workers: 2,
  timeout: 15_000,
  expect: { timeout: 1_500 },
  reporter: [['json']],
  use: { actionTimeout: 1_500, screenshot: 'only-on-failure', trace: 'off' },
  projects: [{ name: 'chromium' }],
});
