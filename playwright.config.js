import process from 'node:process';
import { defineConfig, devices } from '@playwright/test';
import { createRunId, getRuntimeConfig, loadDotEnv } from './utils/config/runtime-config.mjs';

loadDotEnv();
// Pin the run ID in the environment so worker processes (which re-evaluate this file) agree with the runner.
process.env.QA_RUN_ID ||= createRunId();

const config = getRuntimeConfig();

export default defineConfig({
  testDir: './tests',
  outputDir: config.paths.testResults,
  timeout: config.timeouts.test,
  expect: { timeout: config.timeouts.expect },
  fullyParallel: true,
  forbidOnly: config.ci,
  retries: config.retries,
  workers: config.workers,
  reporter: [
    ['list'],
    ['html', { outputFolder: config.paths.htmlReport, open: 'never' }],
    ['json', { outputFile: config.paths.reportJson }],
    // Raw Allure results per run; run-tests.mjs / scripts/allure-report.mjs build them into ./allure-report.
    ['allure-playwright', {
      resultsDir: config.paths.allureResults,
      detail: true,
      suiteTitle: true,
      environmentInfo: { baseURL: config.baseURL, runId: config.runId, node: process.version },
    }],
  ],
  use: {
    baseURL: config.baseURL,
    actionTimeout: config.timeouts.action,
    navigationTimeout: config.timeouts.navigation,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    testIdAttribute: 'data-testid',
  },
  projects: [
    {
      name: 'chromium',
      testDir: './tests/specs',
      use: { ...devices['Desktop Chrome'] },
    },
    // Deliberate fault-injection proofs for the healing workflow. Registered only when
    // QA_ENABLE_FAULTS=1 so a bare `playwright test` can never pick them up.
    ...(process.env.QA_ENABLE_FAULTS === '1'
      ? [{ name: 'faults', testDir: './tests/faults', use: { ...devices['Desktop Chrome'] } }]
      : []),
  ],
});
