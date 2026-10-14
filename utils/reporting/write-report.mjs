import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { writeJsonAtomic } from '../io/write-json-atomic.mjs';

/**
 * Writes summary.json (machine-readable) and summary.md (human-readable) for a run.
 */

const esc = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const code = (value) => (value ? `\`${esc(value)}\`` : '—');

/**
 * Render the summary as Markdown.
 * @param {ReturnType<import('./build-summary.mjs').buildSummary>} s
 */
export function renderMarkdown(s) {
  const lines = [];
  lines.push(`# QA run report — ${s.runId}`, '');
  lines.push(`- Target: ${s.baseURL}`, `- Generated: ${s.generatedAt}`,
    `- Final results ${s.final.confirmedByRerun ? 'confirmed by a Playwright rerun of the initially failing tests' : 'taken from the initial run (no confirmation rerun)'}`, '');

  lines.push('## Results', '', '| | Total | Passed | Failed | Flaky | Skipped |', '|---|---|---|---|---|---|');
  lines.push(`| Initial | ${s.initial.total} | ${s.initial.passed} | ${s.initial.failed} | ${s.initial.flaky} | ${s.initial.skipped} |`);
  lines.push(`| Final | ${s.final.total} | ${s.final.passed} | ${s.final.failed} | ${s.final.flaky} | ${s.final.skipped} |`, '');

  if (Object.keys(s.triage).length > 0) {
    lines.push('## Failure classification (initial run)', '', '| Category | Count |', '|---|---|');
    for (const [category, n] of Object.entries(s.triage)) lines.push(`| ${category} | ${n} |`);
    lines.push('');
  }

  lines.push('## Self-healing', '',
    `Queued: ${s.healing.queued} · Healed: ${s.healing.healed} · Failed rerun: ${s.healing.failedRerun} · Rejected: ${s.healing.rejected} · Abandoned: ${s.healing.abandoned} · Pending: ${s.healing.pending}`, '');
  if (s.repaired.length > 0) {
    lines.push('### Verified repairs', '', '| Item | Original locator | Replacement locator | Files | Notes |', '|---|---|---|---|---|');
    for (const r of s.repaired) {
      const notes = [r.subtype, ...(r.degraded.length ? [`⚠ ${r.degraded.join(', ')} — needs human confirmation`] : [])].filter(Boolean).join('; ');
      lines.push(`| ${r.itemId} | ${code(r.originalLocator)} | ${code(r.replacementLocator)} | ${esc(r.filesChanged.join(', '))} | ${esc(notes)} |`);
    }
    lines.push('', 'A repair is listed only when the affected tests passed a Playwright rerun (retries=0, repeat-each=2) with their original assertions intact.', '');
  }
  if (s.unsuccessfulRepairs.length > 0) {
    lines.push('### Unsuccessful repair attempts (files restored)', '', '| Item | Outcome | Stage | Detail |', '|---|---|---|---|');
    for (const r of s.unsuccessfulRepairs) {
      const detail = r.violations.map((v) => `${v.code}: ${v.detail}`).join('; ') || r.diagnosis || '';
      lines.push(`| ${r.itemId} | ${r.outcome} | ${r.stage ?? '—'} | ${esc(detail)} |`);
    }
    lines.push('');
  }

  if (s.flaky.length > 0) {
    lines.push('## Flaky tests (passed on retry — not repairs)', '');
    for (const t of s.flaky) lines.push(`- ${esc(t.title)} (${t.file})`);
    lines.push('');
  }

  lines.push('## Unresolved failures', '');
  if (s.unresolved.length === 0) lines.push('None.', '');
  else {
    lines.push('| Test | Category | Reason | Evidence |', '|---|---|---|---|');
    for (const t of s.unresolved) {
      const evidence = t.evidence ? [...t.evidence.screenshot, ...t.evidence.trace].join('<br>') : '';
      lines.push(`| ${esc(t.title)} (${t.file}) | ${t.category ?? '—'} | ${esc(t.reason)} | ${evidence} |`);
    }
    lines.push('');
  }

  if (s.suspectedDefects.length > 0) {
    lines.push('## Suspected application defects', '',
      'These failures were not repaired because the evidence points at application behaviour (wrong value, missing element or backend error). They are suspicions that need human confirmation, not confirmed bugs.', '');
    for (const d of s.suspectedDefects) lines.push(`- **${esc(d.title)}** (${d.file}) — ${d.category}: ${esc(d.reason)}`);
    lines.push('');
  }

  if (s.globalErrors.length > 0) {
    lines.push('## Global errors', '');
    for (const e of s.globalErrors) lines.push(`- ${esc(e)}`);
    lines.push('');
  }

  if (s.commands.length > 0) {
    lines.push('## Commands executed', '', '| Purpose | Command | Exit code |', '|---|---|---|');
    for (const c of s.commands) lines.push(`| ${esc(c.purpose)} | ${code(c.command)} | ${c.exitCode} |`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

/**
 * @param {string} runDir
 * @param {ReturnType<import('./build-summary.mjs').buildSummary>} summary
 */
export async function writeReport(runDir, summary) {
  await mkdir(runDir, { recursive: true });
  await writeJsonAtomic(join(runDir, 'summary.json'), summary);
  await writeFile(join(runDir, 'summary.md'), renderMarkdown(summary), 'utf8');
  return { json: join(runDir, 'summary.json'), markdown: join(runDir, 'summary.md') };
}
