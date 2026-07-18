# Claude Code Compatibility Runbook

## Purpose

Rudraloka is Codex-native first. Its durable instructions live in `AGENTS.md`, reusable workflows live in `.agents/skills/`, and safety-sensitive local operations are shaped by `mcp/rudraloka-dev-mcp`.

Claude Code expects a project-level `CLAUDE.md`. This repository includes one so Claude Code can enter the project cleanly without creating a second rulebook.

## Mental Model

Think of `AGENTS.md` as the engineering handbook and `CLAUDE.md` as the signpost at the door.

The handbook contains the real rules. The signpost tells Claude Code where the handbook is, which nearby systems matter, and which behaviors are important enough to remember immediately.

## How Claude Code Should Use AGENTS.md

Claude Code should read `AGENTS.md` first and treat it as authoritative project policy.

If `CLAUDE.md`, a skill, a doc, or a copied snippet seems to conflict with `AGENTS.md`, the safer reading of `AGENTS.md` wins. The bridge file should then be updated to point more clearly back to the handbook instead of expanding into a duplicate copy.

## How Claude Code Should Use Skills

`.agents/skills/**/SKILL.md` files are reusable task workflows. They are written for the Codex setup, but the concepts are portable: read the relevant workflow, follow its safety and documentation expectations, and keep the work aligned with `AGENTS.md`.

Claude Code should treat skills as focused operating procedures, not as a replacement for project policy.

## How Claude Code Should Use Docs

The `docs/` folder is the engineering knowledge base. It explains the project, architecture, MCP setup, AI infrastructure plans, security posture, and runbooks.

Claude Code should use docs to build context before changing behavior. When work teaches an important concept, workflow, security principle, MCP lesson, AI infrastructure concept, or debugging lesson, the learning should be added to `docs/01-learning-journal/`.

## How Claude Code Should Think About rudraloka-dev-mcp

`mcp/rudraloka-dev-mcp` is the local development MCP server. It is a safety boundary around local project reads, controlled writes, allowlisted pnpm scripts, sanitized summaries, and security evals.

The local dev MCP server is not a public service. It must not be exposed through public ChatGPT web connectors or public HTTP endpoints.

## Why Claude Should Not Bypass MCP Safety Workflows

Instructions are useful, but they are still instructions. MCP safety workflows enforce important boundaries in code: blocked secrets, blocked generated folders, path checks, controlled writes, allowlisted scripts, audit records, and sanitized observability.

For risky local changes, Claude Code should prefer the MCP-controlled workflow when available. If a task cannot use MCP tools, it should preserve the same intent manually: small scoped edits, no secrets, no blocked folders, no arbitrary commands, and clear verification.

## Why We Are Not Adding Hooks Yet

Hooks can be powerful, but they are also another execution path to secure, document, test, and maintain.

For now, the compatibility bridge stays low-risk: a short `CLAUDE.md`, a runbook, index links, and a learning note. Hooks should wait until Rudraloka has a repeated Claude-specific workflow that is worth automating and can be guarded safely.

## Future Options

- Claude-specific hooks for deterministic checks around repeated workflows.
- Claude-specific commands for common local development tasks.
- Claude MCP configuration that points at the safe local development server without exposing it publicly.
- Skill compatibility improvements so Codex skills and Claude skills can share more structure without creating competing rule sources.

## Tradeoffs

Pros:

- Portability across AI coding assistants.
- Easier comparison between Codex and Claude Code on the same project.
- Less vendor lock-in because the project policy is not trapped in one tool's format.

Cons:

- Rule drift if `CLAUDE.md` starts copying large sections of `AGENTS.md`.
- Extra maintenance when bridge files, docs, and skills need to stay aligned.
- More ways for an assistant to misunderstand which file is authoritative if the bridge is too long.

## Operating Rule

Avoid duplicate sources of truth.

When project rules change, update `AGENTS.md` first. Then update bridge files such as `CLAUDE.md` only when the pointer or short summary needs to change.
