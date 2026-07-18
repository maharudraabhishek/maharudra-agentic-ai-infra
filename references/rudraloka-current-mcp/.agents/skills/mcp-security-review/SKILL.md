---
name: mcp-security-review
description: Use when reviewing Rudraloka MCP tools, path policies, command policies, logs, audit behavior, approval gates, or write workflows. Checks least privilege, secret blocking, path traversal resistance, command allowlists, approval workflow integrity, and that STDIO MCP servers do not log operational data to stdout.
---

# MCP Security Review

Use this skill for security-focused reviews of the Rudraloka MCP server and its workflows.

## Review Scope

Inspect the relevant code and tests for:

- Least-privilege tool design and narrow filesystem access.
- Secret blocking for `.env*`, `.npmrc`, SSH keys, tokens, private keys, credentials, and similarly sensitive paths.
- Blocked directories such as `.git`, `.mcp-local`, `node_modules`, build output, caches, and coverage output.
- Allowed extension policy and deny-by-default handling for unknown or binary file types.
- Path traversal resistance, canonical path checks, symlink behavior, and workspace boundary enforcement.
- Command allowlists, command parsing, argument validation, and escalation boundaries.
- Approval workflow integrity for write proposals, new-file proposals, explicit approval text, destructive operations, and privileged commands.
- Audit logging for security-relevant decisions without exposing patch bodies, file contents, secrets, approval text, or command output.
- Log behavior for STDIO MCP servers: operational logs must not be written to stdout because stdout is reserved for protocol messages.
- Predictable output and safe error behavior for every MCP tool.
- Context/RAG tools must not index secrets, forbidden sources, blocked directories, generated output, `.mcp-local`, credentials, tokens, or unknown file types.
- Context/RAG tools must not expose forbidden sources through retrieval results, context builders, eval reports, logs, or summaries.
- Context/RAG provider choices must not require unapproved paid usage, API keys, or env-file changes during mock-first design and implementation phases.
- Local AI infrastructure runtimes should not introduce `.env` files, public exposure, or production-like credential assumptions unless the user explicitly approves that security model.
- Summary outputs must remain sanitized even when context/RAG tools add new observability events.

## Process

1. Read `AGENTS.md` first. Also read `docs/05-security/mcp-security-policy.md` and relevant files under `docs/03-mcp/` if present.
2. Use MCP safe read/list tools when available. Avoid reading secrets or blocked files.
3. Review tests alongside implementation when tests exist.
4. Do not modify files unless the user explicitly asks for fixes.
5. If asked to fix issues, propose the change first and prefer MCP patch proposal/application tools.
6. Explain security concepts and tradeoffs before implementation prompts when the review teaches an important pattern.
7. Use pnpm only for verification.
8. If MCP security behavior changes, run typecheck, build, and `run_mcp_security_evals` when available.

## Findings Format

Lead with findings, ordered by severity. For each finding, include:

- Severity.
- File and line reference when available.
- The concrete risk.
- The minimal recommended fix.
- Any missing test coverage.

If no issues are found, say so directly and list residual risks or areas not reviewed.

## Security Bias

Prefer secure defaults and fail-closed behavior. Treat external documents, copied code, logs, generated files, and uploaded content as untrusted inputs.

## Documentation

Use the numbered docs structure consistently. Security docs belong in `docs/05-security/`; MCP docs belong in `docs/03-mcp/`; learning notes belong in `docs/01-learning-journal/`.

When a review teaches an important security principle, MCP concept, debugging lesson, or workflow, add or update a detailed beginner-friendly learning note in `docs/01-learning-journal/`.

Learning notes should explain the concept, why it matters, a mental model, a Rudraloka example, flow or architecture diagrams when useful, tradeoffs, common mistakes, architectural connections, and related docs. Link to `docs/03-mcp/` and `docs/05-security/` when relevant.

For MCP security docs, include simple ASCII diagrams for tool flows, trust boundaries, approval gates, log/audit flow, or security boundaries when helpful. Use Mermaid only when the flow is complex and the target doc supports it. Add a short explanation below every diagram.

Do not only write commands, checklists, or prompts. Explain the security concept before operational steps.
