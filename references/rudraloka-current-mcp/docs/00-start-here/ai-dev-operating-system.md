# Rudraloka AI Development Operating System

## Purpose

Rudraloka uses a local AI-assisted development setup made from project guidance, reusable skills, and a safety-focused MCP server. The goal is to let Codex help with real engineering work while keeping project rules, local files, writes, commands, and logs under explicit controls.

This setup exists because AI development is safest when policy is not only in prompts. The model gets guidance from `AGENTS.md` and skills, while `rudraloka-dev-mcp` enforces important boundaries inside local tools.

## Core Pieces

`AGENTS.md` is the permanent project guide. It defines workspace rules, pnpm-only package management, security boundaries, TypeScript expectations, MCP tool design rules, and future commerce constraints.

`.agents/skills/**/SKILL.md` files are reusable workflows. They tell Codex how to handle recurring Rudraloka tasks such as MCP refactors, MCP security reviews, architecture decisions, AI infrastructure design, and service scaffolding.

`mcp/rudraloka-dev-mcp` is the local development MCP server. It exposes controlled project tools over STDIO instead of opening a network port. The server is intentionally local and should not be exposed to public ChatGPT web connectors.

MCP tools provide the operational surface:

- `project_info` returns safe project metadata and policy limits.
- `safe_list_files` lists immediate visible children of a safe project-relative directory.
- `safe_read_file` reads small allowlisted text files.
- `propose_file_patch` creates a reviewed exact-replacement patch proposal.
- `apply_approved_patch` applies a proposed patch only with exact approval text.
- `propose_new_file` creates a reviewed new-file proposal.
- `apply_approved_new_file` creates the proposed file only with exact approval text.
- `run_allowed_pnpm_script` runs allowlisted pnpm scripts for allowlisted packages.
- `audit_read_summary` returns bounded audit metadata.
- `log_read_summary` returns bounded sanitized app-log metadata.
- `run_mcp_security_evals` runs local security evals.

Logs and audit data live under `.mcp-local/`, which is blocked from ordinary list/read tools. The server exposes summaries through purpose-built observability tools so proposal internals, command output, patch bodies, and secrets are not casually pulled into model context.

## Codex And Claude Code Comparison

Claude Code commonly uses project-level `CLAUDE.md` and skill-style files. Rudraloka's Codex setup uses the Codex-native combination of `AGENTS.md`, repo-scoped skills, and MCP tools.

The split is intentional:

- `AGENTS.md` provides stable project guidance.
- Skills provide task-specific operating procedures.
- MCP tools enforce local safety boundaries in code, not just instructions.
- Future hooks and evals can add deterministic checks around the workflow.

## Operating Rules

Use pnpm only. Do not use npm, npx, yarn, or bun.

Do not read or modify secrets, `.env*`, `.npmrc`, SSH keys, tokens, private keys, credentials, `node_modules`, `.git`, generated build output, coverage output, or `.mcp-local` internals directly.

Prefer MCP-controlled project reads, writes, and checks when available. If MCP cannot support a requested write, keep changes scoped to the user-approved files and preserve the same security intent.

Architecture and design decisions must present options, tradeoffs, a recommendation, and a clear user decision point.

