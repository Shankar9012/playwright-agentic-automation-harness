import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { validateTargetUrl, normalizeHost } from '../guardrails/validate-target-url.mjs';

/** Absolute repository root (two levels above utils/config). */
export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const DEFAULTS = Object.freeze({
  BASE_URL: 'https://qa-demo-website.vercel.app',
  TEST_TIMEOUT_MS: 30_000,
  EXPECT_TIMEOUT_MS: 5_000,
  ACTION_TIMEOUT_MS: 10_000,
  NAVIGATION_TIMEOUT_MS: 30_000,
  WORKERS: 2,
  RETRIES: 0,
  RUN_RETENTION: 20,
});

/**
 * Load KEY=VALUE pairs from .env into process.env without overriding real env vars.
 * Minimal parser (no dependency): supports comments, blank lines and quoted values.
 * @param {string} [file]
 */
export function loadDotEnv(file = join(PROJECT_ROOT, '.env')) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || line.trimStart().startsWith('#')) continue;
    const [, key, rawValue] = match;
    const value = rawValue.replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/**
 * @param {string} name
 * @param {number} fallback
 * @param {NodeJS.ProcessEnv} env
 */
function readInt(name, fallback, env) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Environment variable ${name} must be a non-negative integer, received "${raw}".`);
  }
  return value;
}

/** @returns {string} Sortable, unique run identifier. */
export function createRunId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `${stamp}-${randomUUID().slice(0, 8)}`;
}

/**
 * @typedef {object} RuntimeConfig
 * @property {string} baseURL
 * @property {string[]} allowedHosts
 * @property {string} runId
 * @property {{ test: number, expect: number, action: number, navigation: number }} timeouts
 * @property {number} workers
 * @property {number} retries
 * @property {number} runRetention
 * @property {boolean} ci
 * @property {{ root: string, runsDir: string, runDir: string, reportJson: string, healingLogDir: string, allureResults: string, allureReport: string, htmlReport: string, testResults: string }} paths
 * @property {{ email?: string, password?: string }} credentials
 */

/**
 * Build and validate the runtime configuration. Throws with a clear message on invalid input.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {RuntimeConfig}
 */
export function getRuntimeConfig(env = process.env) {
  const baseURL = (env.BASE_URL || DEFAULTS.BASE_URL).replace(/\/+$/, '');
  const allowedHosts = (env.ALLOWED_HOSTS || normalizeHost(baseURL))
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);

  const verdict = validateTargetUrl(baseURL, { allowedHosts });
  if (!verdict.ok) throw new Error(`Invalid BASE_URL: ${verdict.reason}`);

  const runId = env.QA_RUN_ID || createRunId();
  const runsDir = join(PROJECT_ROOT, 'artifacts', 'runs');
  const runDir = join(runsDir, runId);

  return {
    baseURL,
    allowedHosts,
    runId,
    timeouts: {
      test: readInt('TEST_TIMEOUT_MS', DEFAULTS.TEST_TIMEOUT_MS, env),
      expect: readInt('EXPECT_TIMEOUT_MS', DEFAULTS.EXPECT_TIMEOUT_MS, env),
      action: readInt('ACTION_TIMEOUT_MS', DEFAULTS.ACTION_TIMEOUT_MS, env),
      navigation: readInt('NAVIGATION_TIMEOUT_MS', DEFAULTS.NAVIGATION_TIMEOUT_MS, env),
    },
    workers: readInt('WORKERS', DEFAULTS.WORKERS, env) || 1,
    retries: readInt('RETRIES', env.CI ? 1 : DEFAULTS.RETRIES, env),
    runRetention: readInt('RUN_RETENTION', DEFAULTS.RUN_RETENTION, env),
    ci: Boolean(env.CI),
    paths: {
      root: PROJECT_ROOT,
      runsDir,
      runDir,
      reportJson: env.PLAYWRIGHT_JSON_OUTPUT_FILE || join(runDir, 'report.json'),
      healingLogDir: join(PROJECT_ROOT, 'artifacts', 'healing-log'),
      allureResults: join(runDir, 'allure-results'),
      allureReport: join(PROJECT_ROOT, 'allure-report'),
      htmlReport: join(PROJECT_ROOT, 'playwright-report'),
      testResults: join(PROJECT_ROOT, 'test-results'),
    },
    credentials: {
      email: env.TEST_USER_EMAIL || undefined,
      password: env.TEST_USER_PASSWORD || undefined,
    },
  };
}
