import { isAbsolute, relative, resolve } from 'node:path';
import { readJson } from '../io/read-json.mjs';
import { toPosixRelative } from '../guardrails/validate-healing-patch.mjs';

/**
 * Parser for Playwright's JSON reporter output. A missing or structurally invalid report is an
 * infrastructure error, never an implicit "all green".
 */

export class ReportError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'ReportError';
  }
}

/**
 * @typedef {object} TestRecord
 * @property {string} testId stable id: `${projectName}::${file}::${titlePath.join(' > ')}`
 * @property {string} title
 * @property {string[]} titlePath describe titles + test title (file excluded)
 * @property {string} file repo-relative POSIX path
 * @property {number} line
 * @property {string} projectName
 * @property {'expected' | 'unexpected' | 'flaky' | 'skipped'} status Playwright outcome
 * @property {string} finalStatus status of the last attempt
 * @property {number} attempts
 * @property {string[]} tags
 * @property {any[]} results raw results
 * @property {any | null} failure first failed result (errors/attachments), if any
 */

/**
 * @param {any} report parsed JSON report
 * @param {{ root: string }} options
 * @returns {{ stats: { total: number, expected: number, unexpected: number, flaky: number, skipped: number, duration: number, startTime?: string }, tests: TestRecord[], globalErrors: string[] }}
 */
export function parseReport(report, { root }) {
  if (!report || typeof report !== 'object' || !Array.isArray(report.suites) || !report.stats) {
    throw new ReportError('Playwright JSON report is missing "suites" or "stats"; the run likely crashed before completing.');
  }
  // Playwright reports spec.file relative to config.rootDir (the top-level testDir).
  const baseDir = report.config?.rootDir ?? root;
  /** @type {TestRecord[]} */
  const tests = [];

  const visit = (suite, describePath) => {
    const isFileSuite = describePath === null;
    const nextPath = isFileSuite ? [] : [...describePath, suite.title];
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const absolute = isAbsolute(spec.file) ? spec.file : resolve(baseDir, spec.file);
        const file = toPosixRelative(relative(root, absolute));
        const titlePath = [...nextPath, spec.title];
        const results = test.results ?? [];
        tests.push({
          testId: `${test.projectName}::${file}::${titlePath.join(' > ')}`,
          title: spec.title,
          titlePath,
          file,
          line: spec.line,
          projectName: test.projectName,
          status: test.status,
          finalStatus: results.at(-1)?.status ?? 'skipped',
          attempts: results.length,
          tags: spec.tags ?? [],
          results,
          failure: results.find((r) => ['failed', 'timedOut', 'interrupted'].includes(r.status)) ?? null,
        });
      }
    }
    for (const child of suite.suites ?? []) visit(child, nextPath);
  };
  for (const fileSuite of report.suites) visit(fileSuite, null);

  const { expected = 0, unexpected = 0, flaky = 0, skipped = 0, duration = 0, startTime } = report.stats;
  return {
    stats: { total: expected + unexpected + flaky + skipped, expected, unexpected, flaky, skipped, duration, startTime },
    tests,
    globalErrors: (report.errors ?? []).map((e) => e.message ?? String(e)),
  };
}

/**
 * Read and parse a JSON report file.
 * @param {string} path
 * @param {{ root: string }} options
 */
export async function readReport(path, options) {
  let report;
  try {
    report = await readJson(path);
  } catch (error) {
    throw new ReportError(`No usable Playwright JSON report at ${path}: ${error.message}`, { cause: error });
  }
  return parseReport(report, options);
}
