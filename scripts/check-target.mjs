#!/usr/bin/env node
/**
 * Validate a target URL against the harness policy before exploring or testing it.
 *
 *   node scripts/check-target.mjs [url]
 *     exit 0 authorized (prints the normalized URL)   exit 1 not authorized (prints why)
 *
 * Without an argument, checks the configured BASE_URL. Authorization comes from ALLOWED_HOSTS
 * (defaults to the BASE_URL host). The harness never switches to a different site silently.
 */
import process from 'node:process';
import { getRuntimeConfig, loadDotEnv } from '../utils/config/runtime-config.mjs';
import { validateTargetUrl } from '../utils/guardrails/validate-target-url.mjs';

loadDotEnv();
try {
  const config = getRuntimeConfig();
  const url = process.argv[2] ?? config.baseURL;
  const verdict = validateTargetUrl(url, { allowedHosts: config.allowedHosts });
  if (!verdict.ok) {
    console.error(`[target] NOT AUTHORIZED: ${verdict.reason}`);
    console.error('[target] To authorize it, set BASE_URL and ALLOWED_HOSTS in .env (see .env.example).');
    process.exit(1);
  }
  const isConfigured = new URL(config.baseURL).origin === verdict.url.origin;
  console.log(`[target] authorized: ${verdict.url.href}`);
  if (!isConfigured) console.log(`[target] note: BASE_URL is ${config.baseURL}; run tests with BASE_URL=${verdict.url.origin} to target this site.`);
} catch (error) {
  console.error(`[target] ${error.message}`);
  process.exit(1);
}
