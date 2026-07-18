# Codex And Claude Compatibility

## Concept

A tool compatibility layer lets the same project work with more than one AI coding assistant without giving each assistant a separate rulebook.

In Rudraloka, Codex remains the native setup. `AGENTS.md`, `.agents/skills/`, `docs/`, and `rudraloka-dev-mcp` are the existing source of truth and safety system. `CLAUDE.md` is added so Claude Code can understand that system instead of inventing a parallel one.

## Mental Model

Think of Rudraloka as having one engineering handbook and multiple assistants who can read it.

`AGENTS.md` is the handbook. It explains the rules, security boundaries, documentation expectations, package manager policy, and MCP behavior. `CLAUDE.md` is a signpost for one visitor. It says: start with the handbook, then use the existing skills, docs, and MCP workflows.

## Why It Matters

AI coding tools often look for different project instruction files. If every tool gets a full independent copy of the rules, those copies can drift. One file might say pnpm only, another might forget. One file might block `.mcp-local`, another might not mention it.

A compatibility bridge reduces that risk. It gives Claude Code enough orientation to behave correctly while keeping `AGENTS.md` as the place where durable rules change first.

## Why AGENTS.md Remains Source Of Truth

`AGENTS.md` already defines Rudraloka's development operating system:

- pnpm-only package management.
- Secret and blocked-folder rules.
- TypeScript and MCP tool design expectations.
- Documentation structure and learning journal rules.
- Architecture decision behavior.
- Local MCP safety boundaries.

Keeping those rules in one authoritative place makes reviews simpler. When a rule changes, the team knows where to update it first.

## Why CLAUDE.md Is A Bridge, Not A Duplicate

A duplicate `CLAUDE.md` would feel helpful on day one but become risky over time. Long duplicated instructions are easy to forget during future edits.

A bridge file stays short. It points Claude Code to `AGENTS.md`, names the important local systems, and reminds the assistant about the highest-risk rules: pnpm-only, no secrets, no blocked folders, MCP-controlled workflows, learning notes, and decision hygiene.

## Codex Vs Claude Code Primitives

Codex and Claude Code have similar goals, but they use different project entry points.

`AGENTS.md` vs `CLAUDE.md`: Codex reads `AGENTS.md` as project guidance. Claude Code commonly looks for `CLAUDE.md`. Rudraloka uses `CLAUDE.md` as a pointer back to `AGENTS.md`.

`.agents/skills/**/SKILL.md` and Claude skills: Rudraloka skills are Codex-native reusable workflows. Claude has its own skill concepts. The bridge treats Rudraloka skills as conceptual workflow docs that Claude Code can read when relevant.

MCP in both ecosystems: MCP is a shared protocol idea. Rudraloka's local MCP server provides safe reads, controlled writes, allowlisted pnpm scripts, observability summaries, and security evals. The important rule is not which assistant calls it, but that local MCP remains local and safety-focused.

Hooks later: Claude hooks could automate checks or guardrails, but hooks add another execution path. Rudraloka is deliberately starting with documentation-only compatibility before adding hook behavior.

## Rudraloka Example

Suppose Claude Code is asked to update MCP docs. The correct flow is:

1. Read `CLAUDE.md`.
2. Follow its signpost to `AGENTS.md`.
3. Read the relevant `.agents/skills/` workflow if the task matches one.
4. Use `docs/03-mcp/` and `docs/05-security/` for context.
5. Prefer `rudraloka-dev-mcp` controlled reads, writes, checks, and evals when available.
6. Add or update a learning note if the work teaches an important concept.

The assistant changes behavior by following the same Rudraloka operating system, not by creating a Claude-only policy island.

## Tradeoffs

Benefits:

- The project becomes more portable across AI coding assistants.
- Codex and Claude Code can be compared on the same engineering rules.
- The team avoids vendor lock-in around instruction files.
- Security and documentation rules stay anchored in one place.

Costs:

- Bridge files must be kept aligned with `AGENTS.md`.
- Too much duplicated text can create rule drift.
- Tool-specific features such as hooks may need separate security review before use.
- Assistants may still differ in how well they follow project documents.

## Common Mistakes

- Copying the full contents of `AGENTS.md` into `CLAUDE.md`.
- Letting `CLAUDE.md` become stricter, weaker, or different from `AGENTS.md` without an explicit decision.
- Treating `.agents/skills/` as optional decoration when a task clearly matches a skill.
- Bypassing MCP-controlled workflows for risky local reads, writes, or checks.
- Adding hooks before the repository has a clear, repeated, well-tested need for them.
- Forgetting to update docs indexes after adding a new runbook or learning note.

## How It Connects To Existing Architecture

This compatibility layer fits the current AI development operating system described in `docs/00-start-here/ai-dev-operating-system.md`.

The architecture stays Codex-native first:

- `AGENTS.md` is permanent project guidance.
- `.agents/skills/` contains reusable workflows.
- `docs/` explains concepts, decisions, runbooks, security, MCP, and AI infrastructure.
- `mcp/rudraloka-dev-mcp` enforces local safety boundaries.
- `CLAUDE.md` points Claude Code back to those existing pieces.

## Related Docs

- [Claude Code Compatibility Runbook](../06-runbooks/claude-code-compatibility.md)
- [Start Here](../00-start-here/README.md)
- [AI Development Operating System](../00-start-here/ai-dev-operating-system.md)
- [MCP](../03-mcp/README.md)
- [Local MCP Architecture](../03-mcp/local-mcp-architecture.md)
- [MCP Security Policy](../05-security/mcp-security-policy.md)
