import { CATEGORY } from '../healing/classify-failure.mjs';
import { OUTCOME } from '../healing/record-healing.mjs';

/**
 * Aggregates initial results, triage, healing records and final results into one
 * machine-readable summary. Every number comes from a Playwright JSON report or the healing
 * log; nothing is inferred. Flaky retries are reported separately and never counted as repairs.
 */

const DEFECT_CATEGORIES = new Set([CATEGORY.ASSERTION_MISMATCH, CATEGORY.ELEMENT_ABSENT, CATEGORY.API]);

/**
 * @param {object} input
 * @param {string} input.runId
 * @param {string} input.baseURL
 * @param {ReturnType<import('./parse-playwright-json.mjs').parseReport>} input.initial
 * @param {any[]} [input.triage]
 * @param {{ items: any[] } | null} [input.queue]
 * @param {import('../healing/record-healing.mjs').HealingRecord[]} [input.healingRecords]
 * @param {ReturnType<import('./parse-playwright-json.mjs').parseReport> | null} [input.final] confirmation rerun of initially failing tests
 * @param {{ command: string, exitCode: number, purpose: string }[]} [input.commands]
 */
export function buildSummary({ runId, baseURL, initial, triage = [], queue = null, healingRecords = [], final = null, commands = [] }) {
  const triageById = new Map(triage.map((t) => [t.testId, t]));
  const finalById = new Map((final?.tests ?? []).map((t) => [t.testId, t]));
  const healedTestIds = new Set(healingRecords.filter((r) => r.outcome === OUTCOME.HEALED).flatMap((r) => r.testIds));

  const tests = initial.tests.map((t) => {
    const confirm = finalById.get(t.testId);
    let finalStatus;
    let finalSource;
    if (t.status === 'unexpected' && confirm) {
      finalStatus = confirm.status === 'expected' ? 'passed' : confirm.status === 'skipped' ? 'skipped' : 'failed';
      finalSource = 'confirmation-rerun';
    } else if (t.status === 'unexpected') {
      finalStatus = 'failed';
      finalSource = 'initial-run (not rerun)';
    } else {
      finalStatus = t.status === 'expected' ? 'passed' : t.status === 'flaky' ? 'flaky' : 'skipped';
      finalSource = 'initial-run';
    }
    const triageEntry = triageById.get(t.testId);
    return {
      testId: t.testId,
      title: t.titlePath.join(' > '),
      file: `${t.file}:${t.line}`,
      projectName: t.projectName,
      initialStatus: t.status === 'expected' ? 'passed' : t.status === 'unexpected' ? 'failed' : t.status,
      finalStatus,
      finalSource,
      healed: healedTestIds.has(t.testId) && finalStatus === 'passed',
      category: triageEntry?.category ?? null,
      reason: triageEntry?.reason ?? null,
      evidence: triageEntry?.evidence ?? null,
    };
  });

  const count = (status) => tests.filter((t) => t.finalStatus === status).length;
  const unresolved = tests.filter((t) => t.finalStatus === 'failed');
  const healing = {
    queued: queue?.items.length ?? 0,
    healed: healingRecords.filter((r) => r.outcome === OUTCOME.HEALED).length,
    failedRerun: healingRecords.filter((r) => r.outcome === OUTCOME.FAILED_RERUN).length,
    rejected: healingRecords.filter((r) => r.outcome === OUTCOME.REJECTED).length,
    abandoned: healingRecords.filter((r) => r.outcome === OUTCOME.ABANDONED).length,
    pending: (queue?.items ?? []).filter((i) => i.status === 'QUEUED').length,
  };

  const triageCounts = {};
  for (const entry of triage) triageCounts[entry.category] = (triageCounts[entry.category] ?? 0) + 1;

  return {
    runId,
    baseURL,
    generatedAt: new Date().toISOString(),
    initial: {
      total: initial.stats.total,
      passed: initial.stats.expected,
      failed: initial.stats.unexpected,
      flaky: initial.stats.flaky,
      skipped: initial.stats.skipped,
    },
    final: {
      total: tests.length,
      passed: count('passed'),
      failed: count('failed'),
      flaky: count('flaky'),
      skipped: count('skipped'),
      confirmedByRerun: Boolean(final),
    },
    triage: triageCounts,
    healing,
    repaired: healingRecords.filter((r) => r.outcome === OUTCOME.HEALED).map((r) => ({
      itemId: r.itemId,
      tests: r.testIds,
      category: r.category,
      subtype: r.subtype,
      originalLocator: r.originalLocator,
      replacementLocator: r.replacementLocator,
      filesChanged: r.filesChanged,
      diagnosis: r.diagnosis,
      degraded: r.verification?.degraded ?? [],
      rerunReports: r.verification?.rerunReports ?? [],
    })),
    unsuccessfulRepairs: healingRecords.filter((r) => r.outcome !== OUTCOME.HEALED).map((r) => ({
      itemId: r.itemId,
      tests: r.testIds,
      outcome: r.outcome,
      stage: r.verification?.stage ?? null,
      violations: r.verification?.violations ?? [],
      restored: r.verification?.restored ?? [],
      diagnosis: r.diagnosis,
    })),
    flaky: tests.filter((t) => t.initialStatus === 'flaky').map((t) => ({ testId: t.testId, title: t.title, file: t.file })),
    unresolved: unresolved.map((t) => ({ testId: t.testId, title: t.title, file: t.file, category: t.category, reason: t.reason, evidence: t.evidence })),
    suspectedDefects: unresolved.filter((t) => DEFECT_CATEGORIES.has(t.category)).map((t) => ({
      title: t.title, file: t.file, category: t.category, reason: t.reason, evidence: t.evidence,
    })),
    globalErrors: [...initial.globalErrors, ...(final?.globalErrors ?? [])],
    commands,
    tests,
    exitCode: unresolved.length > 0 || initial.globalErrors.length > 0 ? 1 : 0,
  };
}
