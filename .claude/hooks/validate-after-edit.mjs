#!/usr/bin/env node
/**
 * PostToolUse hook (Write | Edit | MultiEdit): lightweight validation of the edited file.
 *
 * The edit has already happened, so this hook gives feedback rather than preventing it:
 * on errors it returns { decision: 'block', reason } which Claude Code feeds back to Claude
 * so it fixes the file. Warnings are passed as additionalContext. It never runs the E2E suite.
 * Hard healing restrictions are enforced separately by scripts/validate-healing.mjs.
 */
import process from 'node:process';
import { text } from 'node:stream/consumers';
import { PROJECT_ROOT } from '../../utils/config/runtime-config.mjs';
import { formatFindings, validateChangedFile } from '../../utils/guardrails/validate-changed-files.mjs';
import { parseJson } from '../../utils/io/read-json.mjs';

function fail(message) {
  process.stderr.write(`validate-after-edit: ${message}\n`);
  process.exit(2);
}

let event;
try {
  event = parseJson(await text(process.stdin), 'PostToolUse hook input');
} catch (error) {
  fail(error.message);
}

const filePath = event?.tool_input?.file_path ?? event?.tool_input?.notebook_path;
if (typeof filePath !== 'string' || filePath === '') {
  fail(`no tool_input.file_path in event for tool "${event?.tool_name ?? 'unknown'}".`);
}

const root = process.env.CLAUDE_PROJECT_DIR || event.cwd || PROJECT_ROOT;
const result = await validateChangedFile(filePath, root);
if (result.skipped) process.exit(0);

const errors = result.findings.filter((f) => f.severity === 'error');
const warnings = result.findings.filter((f) => f.severity === 'warning');

if (errors.length > 0) {
  process.stdout.write(`${JSON.stringify({
    decision: 'block',
    reason: `Harness validation failed for ${result.file}:\n${formatFindings({ file: result.file, findings: result.findings })}\nFix these issues before continuing.`,
  })}\n`);
} else if (warnings.length > 0) {
  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: `Harness validation warnings for ${result.file}:\n${formatFindings({ file: result.file, findings: warnings })}`,
    },
  })}\n`);
}
process.exit(0);
