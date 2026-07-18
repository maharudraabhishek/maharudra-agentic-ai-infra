# MahaRudra Agentic AI Infra — Claude Code Instructions

<!--
  File:    CLAUDE.md
  Purpose: Claude Code's primary instruction file for this repository.
           Read automatically by Claude Code at the start of every session.
  Logic:   Imports AGENTS.md (shared engineering rules used by both Codex and Claude Code)
           and the framework-architecture skill (default skill, always active).
           Claude Code-specific notes (environment, commands, switching) are added below
           the imports so they don't need to be duplicated in AGENTS.md.
  Usage:   Do not remove @AGENTS.md or the framework-architecture import.
           Add Claude Code-specific rules here; add shared rules to AGENTS.md instead.
  See also: .claude/commands/   — slash commands (on-demand skills)
            .claude/settings.json — project-level permission allowlist
            docs/internal/agent-switching/switching-guide.md — agent switching workflow
-->

<!--
  Import: AGENTS.md
  Why:    AGENTS.md is the single source of truth for shared engineering rules.
          Both Codex (reads directly) and Claude Code (imports here) pick up
          the same rules from one file. Update rules in AGENTS.md only.
-->
@AGENTS.md

<!--
  Import: framework-architecture skill
  Why:    This is the only skill active by default every session. It governs
          package boundaries, clean architecture layers, and dependency inversion
          decisions that arise in any piece of work regardless of task type.
          All other skills are on-demand — loaded via /command-name or by the
          skill routing rules in AGENTS.md when the task matches their trigger.
-->
## Default Skill (always active)

The framework architecture skill is loaded by default every session — it governs package boundaries, clean architecture layers, and dependency inversion decisions that arise in any piece of work.

@.agents/skills/framework-architecture/SKILL.md

---

## Session Protocol

<!--
  Why this exists:
  STATUS.md is the persistent architectural ground truth for this monorepo.
  It records which files exist, what is implemented vs stubbed, key exports,
  and known gaps across all 5 packages. Reading it at session start prevents
  re-deriving state that is already recorded and keeps architecture decisions
  consistent across Claude Code and Codex sessions.
  session-summary.md is auto-generated hook output (ephemeral metadata) —
  it is not a substitute for STATUS.md.
-->

At the start of every session:
- Read `STATUS.md` at the project root — this is the ground truth for current
  architectural state across all 5 packages. Do not rely on memory or prior
  session summaries.
- Read `kb.md` at the project root if it exists — this is the orchestrator's
  episodic memory: decisions made, concepts locked, open questions across
  sessions. It supplements STATUS.md with reasoning, not just state.

At the end of every session:
- Update `STATUS.md` to reflect any changes made: files added/modified,
  implementation status changes, new gaps found, or gaps resolved.
- Do not overwrite the full file unnecessarily — update only the sections
  that changed.
- Update `STRUCTURE.md` whenever a new source file, doc, or script is added.
  Update only the affected section; do not rewrite sections that did not change.
- Before declaring any phase complete or printing a successful `RESULTS_SUMMARY`,
  update `prompts/stage-{N}[-{sub}]/verification-summary.md`. Create it when
  absent, record the completed phase's work, files, verification, decisions,
  blockers, and handoff context, and preserve the ledger for every known phase.
  This is the shared mandatory rule in `AGENTS.md` under "Per-Stage Verification
  Summary Discipline (D46)"; the stage summary is living, while the per-phase
  changelog remains immutable.

`STATUS.md` is the persistent state layer. `STRUCTURE.md` is the layout
reference. `session-summary.md` is
auto-generated metadata — do not confuse the two.

## Results Summary Rule (Orchestrator Handback)

<!--
  Why this exists:
  When Claude Code is driven by an orchestrator (another Claude instance, Codex,
  or any automated system that submits prompts), the orchestrator needs a
  machine-readable summary of what happened so it can decide next steps.
  Printing it to the terminal (stdout) makes it capturable without file I/O.
-->

After completing any multi-step task — whether a full stage, a single change
request, or an implementation prompt from an orchestrator — output the following
block verbatim to the terminal as the final part of the response:

```
RESULTS_SUMMARY
task: <one-line description of what was done>
status: <success | partial | failed>
files_changed:
  - <file path> (<created | modified>)
  - ...
verification: <pnpm typecheck ✓ | build ✓ | test N/N ✓ | lint ✓ — or failure detail>
key_decisions:
  - <any non-obvious choice made, e.g. "made execute() async to support session tracking">
  - ...
next_steps:
  - <what the orchestrator should do next, if known>
  - ...
END_RESULTS_SUMMARY
```

Rules:
- Always output this block, even for small tasks. Omit sections that have
  nothing to report (e.g. `key_decisions` and `next_steps` may be empty lists).
- `files_changed` lists every file written, created, or edited in this turn.
- `verification` reports the last CI run outcome. If CI was not run, say so.
- Keep each line under 120 characters.
- Do not put this block inside a markdown code fence — output it as plain text
  so terminal capture tools can parse it without stripping fences.

---

## Claude Code Environment Notes

<!--
  Why this section exists:
  This project runs on Windows 11 with PowerShell. pnpm's .ps1 shim may be blocked
  by the system execution policy. pnpm.cmd bypasses this and works reliably.
  All verification commands in this project use pnpm.cmd for this reason.
-->

This project runs on **Windows with PowerShell**. Use `pnpm.cmd` if PowerShell blocks the `.ps1` runner:

```powershell
pnpm.cmd typecheck
pnpm.cmd build
pnpm.cmd test
pnpm.cmd lint
```

Package-specific commands:

```powershell
pnpm.cmd --filter @maharudra/agentic-ai-infra-core run build
pnpm.cmd --filter @maharudra/agentic-ai-infra-runtime run build
pnpm.cmd --filter @maharudra/agentic-ai-infra-dashboard run build
pnpm.cmd --filter @maharudra/create-agentic-ai-infra run build
pnpm.cmd --filter @maharudra/agentic-ai-infra-test-utils run build
```

---

## Available Slash Commands

<!--
  How commands work:
  Each file in .claude/commands/<name>.md is a slash command invoked with /name.
  The 6 skill commands are thin wrappers — they contain only an @import pointing
  to the shared .agents/skills/<name>/SKILL.md. This means Codex and Claude Code
  share one skill definition with no duplication.
  Skill auto-selection:
  You do not need to invoke these manually for every task. AGENTS.md contains a
  Skill Routing section that instructs the agent to self-select the matching skill
  based on what the task involves. Use /command-name to explicitly re-focus when
  a skill is the primary concern of the session.
-->

Slash commands live in `.claude/commands/`. Invoke them with `/command-name` during a session.
Each command mirrors the equivalent Codex skill in `.agents/skills/`.

| Command | Codex skill equivalent | Purpose |
| --- | --- | --- |
| `/production-subagents` | `.agents/skills/production-subagents` | Route the task to the production-grade sub-agent roster (planner, design-architect, implementor, clean-coder, refactorer, debugger, validator, executor, documentation, security-reviewer, release-manager, ai-agentic-specialist, web-extractor, web-scraper) |
| `/framework-architecture` | `.agents/skills/framework-architecture` | Design or review framework architecture, package boundaries, clean architecture layers, dependency inversion |
| `/mcp-security-review` | `.agents/skills/mcp-security-review` | Review MCP security surface, local vs remote safety, secret blocking, audit policy |
| `/cli-template-design` | `.agents/skills/cli-template-design` | Design or review CLI generation behavior, config profiles, templates, generated project paths |
| `/agentic-context-design` | `.agents/skills/agentic-context-design` | Design retrieval, context engineering, token efficiency, single-agent or multi-agent modes |
| `/dashboard-token-efficiency` | `.agents/skills/dashboard-token-efficiency` | Design dashboard architecture, token usage observability, context-budget reporting |
| `/package-release-readiness` | `.agents/skills/package-release-readiness` | Prepare packages for publishing, release workflows, CI/CD gates |

---

## Production-Grade Sub-Agents (always available)

<!--
  Why this section exists:
  AGENTS.md § Sub-Agent Routing makes the production-grade roster mandatory for
  every non-trivial task. This section surfaces the same roster in CLAUDE.md so
  Claude Code sees the list at session start without re-reading the full skill.
  See .claude/agents/<name>.md for each sub-agent's contract, .agents/skills/
  production-subagents/SKILL.md for routing and handback rules.
-->

Sub-agent definitions live at `.claude/agents/<name>.md`. Each file has YAML
frontmatter (`name`, `description`, `tools`, `model`) and a system prompt
written to make the sub-agent think like a world-class lead engineer in its
specialisation. Claude Code parses these automatically — invoke via the
`Agent` tool with `subagent_type: "<name>"`.

| Sub-agent | When to invoke | Model | Hands back to |
| --- | --- | --- | --- |
| `director` | First call on every prompt when auto-routing is ON | opus | named first specialist in chain |
| `planner` | Task with 3+ steps or unclear scope | opus | named executor sub-agent |
| `design-architect` | New public type, error code, cross-package contract | opus | `implementor` |
| `implementor` | Translating an approved design into TypeScript | sonnet | `clean-coder` → `validator` |
| `clean-coder` | Tightening recently written code (≤150 LOC pass) | sonnet | `validator` |
| `refactorer` | Behaviour-preserving structural rewrite | sonnet | `validator` |
| `debugger` | Failing test, crash, regression | opus | `implementor` → `validator` |
| `validator` | Final pnpm CI gate before `RESULTS_SUMMARY` | haiku | requester (or fixer if RED) |
| `executor` | Run a long/scripted command exactly as told | haiku | requester |
| `documentation` | TSDoc, README, learning notes, diagrams | sonnet | `validator` |
| `security-reviewer` | MCP, write surface, auth, local↔remote boundary | opus | `design-architect`/`implementor` |
| `release-manager` | Version bump, CHANGELOG, publish prep | sonnet | user (for publish confirmation) |
| `ai-agentic-specialist` | MCP, RAG, retrieval, context budgets, multi-agent | opus | `design-architect` |
| `web-extractor` | Single targeted doc lookup (quote + cite) | haiku | requester |
| `web-scraper` | Multi-source research and comparison | sonnet | `design-architect` |

### Auto-routing toggle

`subagent-routing.json` at the project root controls whether the `director`
runs on every prompt. Default is `auto`. A UserPromptSubmit hook in
`.claude/settings.json` runs `scripts/subagent-routing-hook.mjs` on every
prompt; when mode is `auto`, the hook injects an `additionalContext` line
telling Claude Code to spawn the director first. When mode is `manual`, the
hook is silent and the user must name sub-agents explicitly.

```powershell
node scripts/subagent-routing.mjs status   # show current mode
node scripts/subagent-routing.mjs on       # set to "auto"
node scripts/subagent-routing.mjs off      # set to "manual"
```

Override: name a sub-agent in your prompt ("use the debugger…") and the
director hands directly to it. See `AGENTS.md` § Sub-Agent Auto-Routing
Toggle for the full contract.

**Mandatory:** see `AGENTS.md` § Sub-Agent Routing. Skipping `validator`
before `RESULTS_SUMMARY` is forbidden. Skipping `security-reviewer` when the
change touches a write surface, an MCP tool, an auth path, or the local/remote
boundary is forbidden.

### Upfront-permissions contract (D50)

The director enumerates every Bash, Edit/Write, MCP, and network surface in the routing plan's "Permissions required across the chain" block. User grants once. Specialists never re-prompt for permissions mid-chain — they `HANDBACK → director` with `RE-PLAN REQUIRED:` instead. Full rule: `AGENTS.md` § Sub-Agent Routing.

### Mid-chain re-routing rule (D51)

Every user message — including mid-chain ones — routes through the director when `mode = "auto"`. Director picks **Fold**, **Branch**, or **Suspend** and states which in ≤2 lines. Full rule: `AGENTS.md` § Sub-Agent Auto-Routing Toggle.

---

## Switching Between Claude Code and Codex

The active stage verification summary is the sole operational handoff. Do not
create `handover.md`. Resume work by reading `AGENTS.md`, `STATUS.md`, `kb.md`,
and the active `prompts/stage-{N}[-{sub}]/verification-summary.md` in that
order. The summary is a newest-first phase stack with the detailed files,
verification, blockers, and next action for the active stage.

Full workflow is documented in `docs/internal/agent-switching/switching-guide.md`.

---

## Memory System

<!--
  Why this exists:
  Claude Code maintains persistent memory across sessions in a local directory.
  This supplements STATUS.md and the stage verification summary. Memory captures
  standing preferences and durable context; the stage summary captures verified
  phase-by-phase implementation state.
-->

Claude Code maintains persistent project memory across sessions at:

```
C:\Users\abhi1\.claude\projects\c--Users-abhi1-react-maharudra-agentic-ai-infra\memory\
```

This stores learned preferences, feedback, project context, and reference
pointers. It does not replace the active stage verification summary when
switching agents.
