# .claude/ Directory

<!--
  Purpose: Claude Code project-level configuration directory.
           Read by Claude Code when opened in this workspace.
  Contents:
    settings.json  — project permission allowlist + Stop hook for quota tracking
    commands/      — slash commands invoked with /command-name during a session
    agents/        — production-grade sub-agent definitions; Claude Code invokes
                     each via the Agent tool with subagent_type:"<name>"
    README.md      — this file; documents the directory and settings.json fields
                     (JSON does not support inline comments, so they live here)
-->

This directory contains Claude Code project configuration and slash commands for the
`maharudra-agentic-ai-infra` repository.

---

## settings.json

`settings.json` does not support inline comments (it is strict JSON), so all field
documentation is here.

### What it does

Defines which `Bash(...)` commands Claude Code may run **without prompting** the user
for permission. Every other command still requires explicit user approval.

### Why these commands are pre-approved

All entries in `permissions.allow` are read-only or idempotent verification commands
that Claude runs frequently during normal development. Pre-approving them removes
repetitive confirmation dialogs for safe, expected operations.

None of the pre-approved commands write files, mutate state, publish packages,
start servers, run migrations, or execute Docker. Write-capable commands (git commit,
npm publish, docker-compose up, etc.) are intentionally NOT listed and will always
prompt the user.

### Field reference

```
permissions.allow   Array of Bash command patterns that run without user confirmation.
                    Uses glob-style * wildcard matching on the command string.
                    Pattern format: "Bash(<command or pattern>)"

permissions.deny    Array of Bash command patterns that are always blocked.
                    Currently empty — denial is handled by omission from the allow list.
```

### Pre-approved command patterns and why each is safe

| Pattern | Why safe |
| --- | --- |
| `Bash(pnpm.cmd typecheck)` | Read-only TypeScript check — no output written |
| `Bash(pnpm.cmd build)` | Compiles packages to dist/ — idempotent, no external side effects |
| `Bash(pnpm.cmd test)` | Runs test suite — read-only, no state mutation |
| `Bash(pnpm.cmd lint)` | Lint check — read-only |
| `Bash(pnpm.cmd install)` | Installs dependencies from lockfile — expected and safe |
| `Bash(pnpm.cmd run ci)` | Runs the full CI sequence (typecheck + build + test + lint) |
| `Bash(pnpm.cmd run release:check)` | Dry-run release gate — does not publish |
| `Bash(pnpm.cmd -r list*)` | Lists workspace packages and their versions — read-only |
| `Bash(pnpm.cmd --filter * run *)` | Runs package-specific scripts (build/test/typecheck/lint) |
| `Bash(node scripts/quota-check.mjs*)` | Quota tracking script — writes only to `.agentic-local/` (gitignored), never touches source files |

---

## hooks

### UserPromptSubmit hook — sub-agent auto-routing

```
hooks.UserPromptSubmit  Fires once before every user prompt is sent.
                        Runs: node scripts/subagent-routing-hook.mjs
                        Timeout: 30 s
```

**Purpose:** Reads `subagent-routing.json` at the project root. When mode is
`auto`, emits a JSON envelope (`hookSpecificOutput.additionalContext`) that
tells Claude Code to spawn the `director` sub-agent before any other action;
the director then decomposes the task and routes to specialists from the
14-roster via `HANDBACK → <next>` markers. When mode is `manual`, the script
emits nothing (silent pass-through).

**Mirror on Codex CLI:** the same script is wired in `.codex/config.toml`
under `[[hooks.UserPromptSubmit.hooks]]` — both stacks share the same JSON
output shape so one script powers both.

**Always exit 0:** a misconfigured toggle never blocks a prompt. Default
mode (file missing or malformed) is `auto`.

**Toggle CLI:** `node scripts/subagent-routing.mjs status | on | off | get-mode`.

**Override:** name a sub-agent in your prompt ("use the debugger…") and the
director hands directly to it, skipping its own routing chain.

### Stop hook — weekly quota tracking

```
hooks.Stop  Fires once after every Claude Code response.
            Runs: node scripts/quota-check.mjs claude increment-and-check
```

**Purpose:** Automatically tracks how many response turns Claude Code has used this
week. Compares the count against `quota.config.json` and prints a warning when 15%
of the weekly budget remains, prompting the user to hand off to Codex before quota
runs out.

**Why a Stop hook and not a PreToolUse hook:**
Stop fires once per complete response — the right granularity for counting usage.
PreToolUse fires once per tool call within a response (could be many per response).

**Output behaviour:**

```txt
  < 50% budget used   →  silent (no output, does not interrupt workflow)
  50–84% budget used  →  single info line
  ≥ 85% budget used   →  ⚠️ warning block + handover prompt
  100% budget used    →  🚨 urgent block + handover prompt
```

**State file:** `.agentic-local/quota-state.json` (gitignored — never committed)
**Config file:** `quota.config.json` (committed — edit to adjust your weekly budget)

**Adjusting the budget:** Open `quota.config.json` and change `weeklyBudget` under
`providers.claude` to a number that reflects how many Claude responses you want to
use per week before switching. The counter resets automatically every Monday (ISO week).

### Windows note

All patterns use `pnpm.cmd` rather than `pnpm` because this project runs on Windows
with PowerShell. The `pnpm.ps1` shim may be blocked by the execution policy;
`pnpm.cmd` works reliably without that restriction.

---

## commands/

Each `.md` file in `commands/` is a Claude Code slash command.

| File | Command | Type | Description |
| --- | --- | --- | --- |
| `framework-architecture.md` | `/framework-architecture` | Default + on-demand | Delegates to `.agents/skills/framework-architecture/SKILL.md` |
| `production-subagents.md` | `/production-subagents` | On-demand (mandatory for non-trivial tasks) | Delegates to `.agents/skills/production-subagents/SKILL.md` — the sub-agent routing layer |
| `mcp-security-review.md` | `/mcp-security-review` | On-demand | Delegates to `.agents/skills/mcp-security-review/SKILL.md` |
| `cli-template-design.md` | `/cli-template-design` | On-demand | Delegates to `.agents/skills/cli-template-design/SKILL.md` |
| `agentic-context-design.md` | `/agentic-context-design` | On-demand | Delegates to `.agents/skills/agentic-context-design/SKILL.md` |
| `dashboard-token-efficiency.md` | `/dashboard-token-efficiency` | On-demand | Delegates to `.agents/skills/dashboard-token-efficiency/SKILL.md` |
| `package-release-readiness.md` | `/package-release-readiness` | On-demand | Delegates to `.agents/skills/package-release-readiness/SKILL.md` |
| `handover.md` | `/handover` | On-demand | Claude Code-only — generates `handover.md` for agent switching |

---

## agents/

Production-grade sub-agent definitions. Each `.md` file in `.claude/agents/` is
a Claude Code native sub-agent (parsed automatically from YAML frontmatter) and
a Codex role profile (read directly when adopting a hat). The full routing
layer is at `.agents/skills/production-subagents/SKILL.md`; the mandatory rule
is in `AGENTS.md` § Sub-Agent Routing.

| File | Invocation | Specialisation | Model |
| --- | --- | --- | --- |
| `director.md` | `Agent(subagent_type:"director")` | First call on every prompt when auto-routing is on; decomposes task and emits Routing Plan with HANDBACK → markers | opus |
| `planner.md` | `Agent(subagent_type:"planner")` | Multi-step task decomposition + verification gates | opus |
| `design-architect.md` | `Agent(subagent_type:"design-architect")` | Public types, error codes, cross-package contracts | opus |
| `implementor.md` | `Agent(subagent_type:"implementor")` | Strict-mode TypeScript from an approved design | sonnet |
| `clean-coder.md` | `Agent(subagent_type:"clean-coder")` | SOLID, DI, naming, dead-code removal | sonnet |
| `refactorer.md` | `Agent(subagent_type:"refactorer")` | Behaviour-preserving structural rewrites | sonnet |
| `debugger.md` | `Agent(subagent_type:"debugger")` | Reproduce → isolate → root-cause → minimal fix | opus |
| `validator.md` | `Agent(subagent_type:"validator")` | Mandatory pnpm.cmd CI gate before `RESULTS_SUMMARY` | haiku |
| `executor.md` | `Agent(subagent_type:"executor")` | Pure command runner with full output capture | haiku |
| `documentation.md` | `Agent(subagent_type:"documentation")` | TSDoc, READMEs, learning notes, ASCII diagrams | sonnet |
| `security-reviewer.md` | `Agent(subagent_type:"security-reviewer")` | Fail-closed MCP, secrets, local↔remote boundary | opus |
| `release-manager.md` | `Agent(subagent_type:"release-manager")` | Version bump, CHANGELOG, exports, publish dry-run | sonnet |
| `ai-agentic-specialist.md` | `Agent(subagent_type:"ai-agentic-specialist")` | MCP, RAG, retrieval, supervisor routing, token efficiency | opus |
| `web-extractor.md` | `Agent(subagent_type:"web-extractor")` | Single targeted doc fetch (verbatim quote + citation) | haiku |
| `web-scraper.md` | `Agent(subagent_type:"web-scraper")` | Multi-source research with comparison table | sonnet |

**Mandatory:** `AGENTS.md` § Sub-Agent Routing makes this roster the required
routing layer for every non-trivial task. Skipping `validator` before
`RESULTS_SUMMARY` is forbidden. Skipping `security-reviewer` when the change
touches a write surface, an MCP tool, an auth path, or the local/remote
boundary is forbidden.

**Design:** The 6 skill commands are thin `@import` wrappers pointing at `.agents/skills/`.
This keeps a single source of truth — updating a skill file updates behavior for both
Codex (reads the file directly) and Claude Code (loads it via the command).

**Auto-selection:** Skills also self-load based on task type via the Skill Routing rules
in `AGENTS.md`. You do not need to invoke `/command-name` manually for most tasks.
