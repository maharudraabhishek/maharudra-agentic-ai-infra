---
name: mcp-security-review
description: Use when reviewing MahaRudra Agentic AI Infra local MCP, remote-safe MCP/API, filesystem access, command policy, write approval, secret blocking, audit logging, retrieval indexing, or generated security docs.
---

# MCP Security Review

Review MCP-related work with a fail-closed security bias.

## Workflow

1. Read `AGENTS.md` and `docs/05-security/local-vs-remote-safe-mcp.md`.
2. Confirm whether the surface is local STDIO MCP or remote-safe MCP/API.
3. Check least privilege, path boundaries, secret blocking, write approvals, command allowlists, audit behavior, and safe errors.
4. Ensure local filesystem and shell capabilities never appear in remote-safe surfaces.
5. Ensure retrieval and indexing designs exclude secrets, private local state, generated output, and blocked folders.
6. Report findings before summaries when performing a review.
7. Follow `AGENTS.md` documentation rules for code changes: explain non-obvious intent, platform behavior, safety boundaries, generated contracts, and maintenance expectations in comments or docs.
8. Do not apply documentation narrowly: for all security-sensitive code added, modified, or included in an active documentation pass, add language-appropriate API documentation before every class/function/method/type (JSDoc/TSDoc for JS/TS, Javadoc for Java, Dartdoc for Dart, docstrings for Python, XML docs for C#, Rustdoc for Rust, Go doc comments for Go; use JSDoc as the fallback), inline rationale comments for guardrails, and module READMEs that map trust boundaries and execution flow.
9. Documentation and visual explanations: Do not use Mermaid, PlantUML, Graphviz, image diagrams, or extension-dependent diagram formats. Use plain Markdown-compatible diagrams that visually resemble Mermaid-style diagrams where practical, using ASCII/Unicode boxes, arrows, sequence-style text diagrams, class/interface relationship diagrams, tree diagrams, decision trees, workflow blocks, and Markdown tables. Diagrams must render correctly as plain text, GitHub Markdown, and VS Code raw Markdown. Use fenced `txt` code blocks for complex diagrams and add a short explanation before or after each diagram. Use diagrams wherever they improve understanding of architecture, runtime flow, CLI setup, retrieval/context flow, agent harness behavior, token-efficient multi-agent orchestration, dashboard data flow, CI/CD, release readiness, and package/module relationships. Use tables for timeline, Gantt-like, matrix, comparison, and breakdown diagrams. Do not add decorative or inaccurate diagrams. Public docs must remain professional and must not expose internal phase/build-history wording; internal planning diagrams belong under `docs/internal/`.

## Trust Boundary

Every security review starts by identifying which side of this boundary the code lives on. Capabilities that exist on the left must never appear on the right.

```txt
  ┌─────────────────────────┐         ┌──────────────────────────────┐
  │   LOCAL STDIO MCP       │         │   REMOTE-SAFE MCP / API      │
  │   (developer only)      │         │   (team / CI / internet)     │
  ├─────────────────────────┤         ├──────────────────────────────┤
  │ ✓ filesystem read/write │  ─────► │ ✗ BLOCKED                    │
  │ ✓ shell / exec          │  ─────► │ ✗ BLOCKED                    │
  │ ✓ migration helpers     │  ─────► │ ✗ BLOCKED                    │
  │ ✓ local DB direct       │  ─────► │ ✗ BLOCKED                    │
  │ ✓ approval-gated writes │  ─────► │ ✗ BLOCKED                    │
  ├─────────────────────────┤         ├──────────────────────────────┤
  │ ✓ bounded retrieval     │  ─────► │ ✓ allowed (sanitized)        │
  │ ✓ read-only summaries   │  ─────► │ ✓ allowed (sanitized)        │
  ├─────────────────────────┤         ├──────────────────────────────┤
  │ stdout: MCP protocol    │         │ ✓ auth + rate-limit required  │
  │ No stdout logging!      │         │ ✓ audit log required         │
  │                         │         │ ✓ loopback default           │
  └─────────────────────────┘         └──────────────────────────────┘

  Rule: if unsure which side — fail closed. Do not expose. Do not guess.
```

## What Must Never Cross the Boundary

The following must never appear in remote-safe surface code, tool registrations, or outputs:

```txt
  Secrets / .env contents          ──►  blocked at indexing + output layer
  Local absolute paths             ──►  blocked in remote-mode outputs
  Raw SQL / raw vectors            ──►  blocked from dashboard + trajectory
  Stack traces                     ──►  blocked from remote error responses
  Raw approval text                ──►  never stored, logged, or displayed
  Shell command output             ──►  blocked from all summaries
  Raw task text (default)          ──►  blocked from persistence by default
```

## Verification

Future MCP implementation should include security evals, typechecks, tests, and docs updates before being considered complete.
