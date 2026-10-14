import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

/**
 * Generate (and optionally serve) an Allure report from a run's raw `allure-results`.
 * Uses the pinned Allure 3 CLI from node_modules (Node-based, no Java required).
 *
 * @param {object} options
 * @param {string} options.root project root
 * @param {string} options.resultsDir raw results written by the allure-playwright reporter
 * @param {string} options.reportDir output directory for the generated report
 * @param {string} [options.name] report name shown in the Allure UI
 * @param {'inherit' | 'pipe'} [options.stdio]
 * @returns {Promise<{ exitCode: number, command: string, reportDir: string }>}
 */
export async function generateAllureReport({ root, resultsDir, reportDir, name = 'QA Report', stdio = 'pipe' }) {
  if (!existsSync(resultsDir) || (await readdir(resultsDir)).length === 0) {
    throw new Error(`No Allure results in ${resultsDir}. Run the tests through playwright.config.js reporters first.`);
  }
  // Allure 3 does not replace an existing report: it leaves the old index.html in place and writes
  // the new build to a plugin subfolder (awesome/), so the folder would keep showing a stale run.
  await rm(reportDir, { recursive: true, force: true });
  const args = ['generate', resultsDir, '--output', reportDir, '--report-name', name];
  return { ...(await runAllure(root, args, stdio)), reportDir };
}

/**
 * Serve a generated Allure report in the default browser (blocks until the server stops).
 * @param {string} root
 * @param {string} reportDir
 */
export async function openAllureReport(root, reportDir) {
  if (!existsSync(reportDir)) throw new Error(`No Allure report at ${reportDir}. Generate it first.`);
  return runAllure(root, ['open', reportDir], 'inherit');
}

/**
 * @param {string} root
 * @param {string[]} args
 * @param {'inherit' | 'pipe'} stdio
 */
function runAllure(root, args, stdio) {
  const cli = join(root, 'node_modules', 'allure', 'cli.js');
  if (!existsSync(cli)) return Promise.reject(new Error('Allure CLI not installed. Run "npm install".'));
  const command = `allure ${args.join(' ')}`;
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: root,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: stdio === 'pipe' ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    let output = '';
    child.stdout?.on('data', (chunk) => { output += chunk; });
    child.stderr?.on('data', (chunk) => { output += chunk; });
    child.on('error', (error) => reject(new Error(`Failed to start Allure: ${error.message}`, { cause: error })));
    child.on('close', (code) => {
      if (code === 0) resolvePromise({ exitCode: 0, command });
      else reject(new Error(`${command} exited with ${code}${output ? `:\n${output.trim()}` : ''}`));
    });
  });
}
