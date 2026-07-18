# Claude Code Instructions for Rudraloka

## Source of Truth

Read `AGENTS.md` first. `AGENTS.md` is the authoritative project instruction file for Rudraloka.

This file is only a Claude Code compatibility bridge. If this file and `AGENTS.md` ever seem to disagree, follow `AGENTS.md` and update this bridge later.

## Project Rules

- Use pnpm only. Do not use npm, npm run, npx, yarn, or bun unless the user explicitly asks for npm compatibility.
- Never read or modify secrets or credential files, including `.env`, `.env.*`, `.npmrc`, SSH keys, tokens, private keys, or credentials.
- Never read or modify blocked local state or generated folders, including `.git`, `.mcp-local`, `node_modules`, `dist`, `build`, and `coverage`.
- Prefer TypeScript, strict checking, explicit schemas, least privilege, deterministic tools, secure defaults, and fail-closed behavior.
- Keep `AGENTS.md` as the source of truth instead of duplicating long rules here.

## Skills and Workflows

Reusable Rudraloka workflows live under `.agents/skills/**/SKILL.md`. Read the relevant skill when a task matches one of those workflows, and keep the workflow aligned with `AGENTS.md`.

## MCP

The local development MCP server is `mcp/rudraloka-dev-mcp`.

Prefer MCP-controlled reads, controlled writes, allowlisted pnpm checks, sanitized observability, and security evals when those tools are available. The local dev MCP server is for local development only and must not be exposed publicly or through public ChatGPT web connectors.

## Documentation

Engineering docs live under `docs/` using the numbered folder structure. Important concepts, MCP lessons, AI infra lessons, security principles, debugging lessons, and workflows should be documented in `docs/01-learning-journal/`.

Explanations should introduce concepts, mental models, examples, and tradeoffs before commands or detailed prompts.

## Decision Behavior

Architecture and process decisions must present options and tradeoffs, give a separate recommendation, and wait for the user to choose before implementation details are expanded.
