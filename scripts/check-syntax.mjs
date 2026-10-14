#!/usr/bin/env node
/**
 * Syntax and convention sweep over every project JavaScript file (same checks as the
 * PostToolUse hook). Exit 1 when any file has errors; warnings are printed but do not fail.
 */
import process from 'node:process';
import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { PROJECT_ROOT } from '../utils/config/runtime-config.mjs';
import { formatFindings, validateChangedFile } from '../utils/guardrails/validate-changed-files.mjs';

const SKIP = new Set(['node_modules', 'playwright-report', 'allure-report', 'allure-results', 'test-results', 'artifacts', '.playwright-mcp', '.git', '.capture']);

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.m?js$/.test(entry.name)) yield full;
  }
}

let errors = 0;
let files = 0;
for await (const file of walk(PROJECT_ROOT)) {
  const result = await validateChangedFile(relative(PROJECT_ROOT, file), PROJECT_ROOT);
  if (result.skipped) continue;
  files += 1;
  if (result.findings.length > 0) console.log(formatFindings(result));
  errors += result.findings.filter((f) => f.severity === 'error').length;
}
console.log(`[check-syntax] ${files} file(s) checked, ${errors} error(s).`);
process.exit(errors > 0 ? 1 : 0);
