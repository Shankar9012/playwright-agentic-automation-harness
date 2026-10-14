# `.claude/` — Claude Code configuration

Everything Claude Code loads for this project: who does what (agents), how to do it (skills), and what is enforced automatically (hooks).

```
.claude/
├── settings.json              hook registration + narrow permission denies
├── agents/                    specialist subagents (Markdown + YAML frontmatter)
│   ├── qaautomation.md        orchestrator — routes requests, delegates, runs scripts
│   ├── planner.md             MCP exploration → docs/
│   ├── executer.md            Page Objects, fixtures, specs, test runs
│   ├── self-healer.md         one queued locator repair + verification
│   └── result-driven.md       evidence-based report
├── skills/                    procedures (loaded on demand)
│   ├── qa-automation/         entry point and router (/qa-automation)
│   ├── explore-site/          discovery checklist and docs format
│   ├── generate-e2e-tests/    POM/AAA/locator/test-data rules + templates
│   ├── heal-locator-failures/ eligibility, evidence, repair rules, verification
│   └── run-and-report/        execution commands, failure reading, report structure
└── hooks/
    ├── guard-commands.mjs     PreToolUse  (Bash | PowerShell)
    └── validate-after-edit.mjs PostToolUse (Write | Edit | MultiEdit)
```

## How a request flows through these files

1. You type a request, either with `/qa-automation …` or in plain words.
2. The **qa-automation skill** loads into the main conversation. Claude now acts as the orchestrator: it checks the target URL and the existing `docs/`, then picks a route (Discover, Automate, Run, Heal or Report).
3. For each stage it **delegates** with the Agent tool to `planner`, `executer`, `self-healer` or `result-driven`. Each agent follows its own skill (`explore-site`, `generate-e2e-tests`, `heal-locator-failures` or `run-and-report`).
4. **Hooks** run around every tool call:
   - Before a shell command, `guard-commands.mjs` evaluates it and may deny it.
   - After a file edit, `validate-after-edit.mjs` checks the file and sends any errors back to Claude to fix.
5. The orchestrator collects real exit codes and report paths and answers you.

Subagents cannot start other subagents. That is why the orchestration lives in the **skill**, which runs in the main thread. `qaautomation.md` provides the same behaviour when you start Claude with `claude --agent qaautomation`.

## Agents at a glance

| Agent | Tools | Writes | Never |
|---|---|---|---|
| qaautomation | Agent(planner, executer, self-healer, result-driven), Read, Glob, Grep, Bash | nothing directly | write tests or heal |
| planner | Read/Write/Edit + Playwright MCP browser tools | `docs/*.md` | edit tests, pay, change data |
| executer | Read/Write/Edit, Bash, MCP snapshot | `tests/pages`, `tests/specs`, `tests/fixtures`, `tests/data` | weaken assertions, invent values |
| self-healer | Read/Edit, Bash, MCP snapshot | one locator statement in an allowed file | touch `expect`, skips, app code |
| result-driven | Read, Glob, Grep, Bash | report only | claim unverified results |

## Hooks

| Hook | Input | Blocks / reports | Exit codes |
|---|---|---|---|
| `guard-commands.mjs` | `tool_input.command` | destructive git (`reset --hard`, `clean -f`, `checkout -- .`, force push), recursive delete of protected paths, system commands, remote-script-to-shell, production deploys, Stripe/live keys, network writes to hosts outside `ALLOWED_HOSTS` | 0 (with a deny JSON when blocked) · 2 malformed input |
| `validate-after-edit.mjs` | `tool_input.file_path` | JS syntax, CommonJS, missing import extensions, `.only`; warnings for hard waits and inline locators in specs | 0 (with `decision: "block"` JSON on errors) · 2 malformed input |

The policy logic lives in `utils/guardrails/command-policy.mjs` and `utils/guardrails/validate-changed-files.mjs`. Both are unit-tested in `tests/unit/guardrails.test.mjs`.

**Check that the hooks are active:** run `/hooks` in Claude Code. You can also call a hook by hand:
```bash
echo '{"tool_name":"Bash","tool_input":{"command":"git reset --hard"}}' | node .claude/hooks/guard-commands.mjs
```

## Changing things safely
- **Add an agent:** create a new `agents/<name>.md` with `name`, `description` and `tools` frontmatter, then add it to `Agent(...)` in `qaautomation.md` and to the routing table in `skills/qa-automation/SKILL.md`.
- **Change a hook rule:** edit the policy in `utils/guardrails/`, not the hook script, then run `npm run test:unit`.
- **Personal settings:** put them in `.claude/settings.local.json`. It is git-ignored and merges on top of `settings.json`.
