import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);

/**
 * Run Playwright Test as a child process and write a JSON report to `outputFile`.
 * The JSON report (not console output) is the source of truth for results.
 *
 * @param {object} options
 * @param {string} options.root project root (cwd for Playwright)
 * @param {string[]} [options.targets] files, `file:line` filters or directories
 * @param {string} [options.project] Playwright project name
 * @param {string} [options.grep]
 * @param {number} [options.retries] overrides config retries when set
 * @param {number} [options.repeatEach]
 * @param {number} [options.workers]
 * @param {string} options.outputFile JSON report destination
 * @param {string} [options.runId]
 * @param {string[]} [options.extraArgs]
 * @param {Record<string, string>} [options.env]
 * @param {boolean} [options.keepConfigReporters] keep list/html reporters from the config
 * @param {'inherit' | 'pipe'} [options.stdio]
 * @returns {Promise<{ exitCode: number, command: string, outputFile: string, stdout: string }>}
 */
export async function runPlaywright({
  root, targets = [], project, grep, retries, repeatEach, workers, outputFile, runId,
  extraArgs = [], env = {}, keepConfigReporters = false, stdio = 'inherit',
}) {
  const cli = require.resolve('@playwright/test/cli', { paths: [root] });
  const args = ['test', ...targets];
  if (project) args.push(`--project=${project}`);
  if (grep) args.push(`--grep=${grep}`);
  if (retries !== undefined) args.push(`--retries=${retries}`);
  if (repeatEach !== undefined) args.push(`--repeat-each=${repeatEach}`);
  if (workers !== undefined) args.push(`--workers=${workers}`);
  if (!keepConfigReporters) args.push('--reporter=list,json');
  args.push(...extraArgs);

  await mkdir(dirname(outputFile), { recursive: true });
  const childEnv = {
    ...process.env,
    ...env,
    PLAYWRIGHT_JSON_OUTPUT_FILE: outputFile,
    ...(runId ? { QA_RUN_ID: runId } : {}),
    ...(project === 'faults' ? { QA_ENABLE_FAULTS: '1' } : {}),
    FORCE_COLOR: '0',
  };

  const command = `playwright ${args.join(' ')}`;
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: root,
      env: childEnv,
      stdio: stdio === 'pipe' ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    let stdout = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stdout += chunk; });
    child.on('error', (error) => reject(new Error(`Failed to start Playwright: ${error.message}`, { cause: error })));
    child.on('close', (code, signal) => {
      resolvePromise({ exitCode: code ?? (signal ? 130 : 1), command, outputFile, stdout });
    });
  });
}
