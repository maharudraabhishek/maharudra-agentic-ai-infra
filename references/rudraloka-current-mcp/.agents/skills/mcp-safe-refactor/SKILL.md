---
name: mcp-safe-refactor
description: Use when refactoring the local Rudraloka MCP server, especially code under mcp/rudraloka-dev-mcp. Requires reading AGENTS.md, docs/05-security/mcp-security-policy.md, and docs/03-mcp/local-mcp-architecture.md first, using MCP-controlled read/propose/apply workflows where possible, proposing changes before applying them, and running pnpm typecheck/build plus MCP security evals when available.
---

# MCP Safe Refactor

Use this skill for refactors that touch the local Rudraloka MCP server.

## Required First Reads

Read these files before proposing any change:

- `AGENTS.md`
- `docs/05-security/mcp-security-policy.md`
- `docs/03-mcp/local-mcp-architecture.md`

Treat them as project policy. If a doc is missing, state that clearly and continue with the stricter available policy from `AGENTS.md` and the surrounding code.

## Workflow

1. Use MCP-controlled tools for project reads, patch proposals, approved patch application, and allowed pnpm scripts whenever available.
2. Prefer `safe_list_files` and `safe_read_file` for inspection.
3. Prefer `propose_file_patch` or `propose_new_file` for edits when the target path is allowlisted by the MCP server.
4. Present the intended change before applying it. Do not apply a proposed patch until the user has approved it or the current workflow has an explicit approval token.
5. Keep the refactor behavior-preserving unless the user explicitly asks for behavior changes.
6. Preserve existing MCP tool names, input schemas, and predictable output contracts unless the user explicitly approves a breaking change.
7. Preserve the security policy: path allowlists, secret blocking, blocked directories, allowed extensions, command allowlists, explicit write approvals, audit logging, and STDIO-safe logging.
8. Do not weaken path, secret, command, write, audit, or logging restrictions to make a refactor easier.
9. Keep edits small and composable. Avoid broad rewrites when a local refactor solves the problem.
10. Use pnpm only. Never suggest or run npm, npx, yarn, bun, or npm-run commands.
11. Explain concepts and tradeoffs before implementation prompts when the refactor teaches an important pattern.
12. Use the numbered docs structure consistently when updating documentation.
13. For MCP workflows, tool flows, approval gates, logging, evals, and security boundaries, include simple ASCII diagrams where helpful. Use Mermaid only when the flow is complex and the target doc supports it. Add a short explanation below every diagram.

## Refactor Standards

- Keep TypeScript strict and explicit.
- Use schemas for tool inputs and validate untrusted inputs before use.
- Fail closed when a path, command, approval, or write target is uncertain.
- Add comments only when they explain security or design intent.
- Do not read or modify secrets, `.env*`, `.npmrc`, keys, tokens, or credentials.
- Do not remove `AGENTS.md`.
- Do not expose local filesystem access to public ChatGPT connectors.
- Context/RAG tools must not weaken MCP path policy, secret blocking, blocked directories, controlled writes, command allowlists, sanitized summaries, audit logging, or security eval behavior.
- Maintain learning notes in `docs/01-learning-journal/` when a refactor teaches an important concept.

## Learning Documentation

For every major MCP refactor, consider whether the user learned an MCP concept, security principle, debugging lesson, or workflow. If yes, add or update a detailed beginner-friendly note in `docs/01-learning-journal/`.

Learning notes should explain:

- What the concept means.
- Why it matters.
- A simple mental model.
- A practical Rudraloka example.
- Flow or architecture diagrams for workflows, system boundaries, tool flows, or security boundaries when useful.
- Tradeoffs and common mistakes.
- How it connects to the current MCP architecture.
- Related links to `docs/03-mcp/`, `docs/05-security/`, or runbooks when useful.

Do not only write copy-paste commands or prompts. Explain the concept first, then show commands after the reader understands why they exist.

## Verification

After approved changes are applied, run the MCP-controlled pnpm scripts when possible:

- `typecheck`
- `build`
- `run_mcp_security_evals` when available

If MCP-controlled script execution is unavailable, use the repository's pnpm workflow, scoped to the MCP package when practical. Report exactly which checks ran and whether they passed.
