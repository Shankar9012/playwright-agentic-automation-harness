#!/usr/bin/env node
/**
 * PreToolUse hook (Bash | PowerShell): blocks destructive, production and payment commands.
 *
 * Input:  hook event JSON on stdin ({ hook_event_name, tool_name, tool_input: { command } }).
 * Output: allowed  -> exit 0, no stdout (normal permission flow continues).
 *         denied   -> exit 0 with { hookSpecificOutput: { permissionDecision: 'deny', ... } }.
 *         malformed input -> exit 2 with a diagnostic on stderr (Claude Code blocks the call
 *         and shows the message), so a broken payload is never silently accepted.
 */
import process from 'node:process';
import { text } from 'node:stream/consumers';
import { evaluateCommand } from '../../utils/guardrails/command-policy.mjs';
import { getRuntimeConfig, loadDotEnv } from '../../utils/config/runtime-config.mjs';
import { parseJson } from '../../utils/io/read-json.mjs';

function fail(message) {
  process.stderr.write(`guard-commands: ${message}\n`);
  process.exit(2);
}

let event;
try {
  event = parseJson(await text(process.stdin), 'PreToolUse hook input');
} catch (error) {
  fail(error.message);
}
if (!event || typeof event !== 'object') fail('hook input must be a JSON object.');

const command = event.tool_input?.command;
if (typeof command !== 'string') {
  fail(`expected tool_input.command to be a string for tool "${event.tool_name ?? 'unknown'}".`);
}

let allowedHosts;
try {
  loadDotEnv();
  ({ allowedHosts } = getRuntimeConfig());
} catch (error) {
  fail(`cannot load runtime policy: ${error.message}`);
}

const verdict = evaluateCommand(command, { allowedHosts });
if (verdict.decision === 'deny') {
  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `[harness guardrail: ${verdict.rule}] ${verdict.reason} Segment: ${verdict.segment}`,
    },
  })}\n`);
}
process.exit(0);
