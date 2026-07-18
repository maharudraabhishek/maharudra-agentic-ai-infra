---
name: cli-template-design
description: Use when designing or reviewing MahaRudra Agentic AI Infra CLI generation behavior, config profiles, template folders, generated project paths, scaffold verification, or template documentation.
---

# CLI Template Design

Design CLI and template work around the generated project contract.

## Workflow

1. Read `AGENTS.md` and `docs/03-cli/generated-project-contract.md`.
2. Keep profiles simple: `minimal`, `secure-readonly`, `controlled-write`, `local-context`, `full-agentic-context`, and `remote-safe`.
3. Preserve neutral generated paths and avoid Rudraloka-specific names.
4. Do not add generator writes before the target behavior is documented and testable.
5. Add or update template docs, example docs, and verification steps with meaningful scaffold changes.
6. Follow `AGENTS.md` documentation rules for code changes: explain non-obvious intent, platform behavior, safety boundaries, generated contracts, and maintenance expectations in comments or docs.
7. Do not apply documentation narrowly: for all generator code added, modified, or included in an active documentation pass, add language-appropriate API documentation before every class/function/method/type (JSDoc/TSDoc for JS/TS, Javadoc for Java, Dartdoc for Dart, docstrings for Python, XML docs for C#, Rustdoc for Rust, Go doc comments for Go; use JSDoc as the fallback), inline comments for non-trivial template/write-plan logic, and README mappings for generated folders and CLI flow.
8. Documentation and visual explanations: Do not use Mermaid, PlantUML, Graphviz, image diagrams, or extension-dependent diagram formats. Use plain Markdown-compatible diagrams that visually resemble Mermaid-style diagrams where practical, using ASCII/Unicode boxes, arrows, sequence-style text diagrams, class/interface relationship diagrams, tree diagrams, decision trees, workflow blocks, and Markdown tables. Diagrams must render correctly as plain text, GitHub Markdown, and VS Code raw Markdown. Use fenced `txt` code blocks for complex diagrams and add a short explanation before or after each diagram. Use diagrams wherever they improve understanding of architecture, runtime flow, CLI setup, retrieval/context flow, agent harness behavior, token-efficient multi-agent orchestration, dashboard data flow, CI/CD, release readiness, and package/module relationships. Use tables for timeline, Gantt-like, matrix, comparison, and breakdown diagrams. Do not add decorative or inaccurate diagrams. Public docs must remain professional and must not expose internal phase/build-history wording; internal planning diagrams belong under `docs/internal/`.

## Profile Decision Tree

Use this tree to choose the correct profile for a given use case. Each profile is a strict superset of the one above it.

```txt
  What does the user need?
  │
  ├─ Just an MCP server stub, no context DB
  │    └──► minimal
  │
  ├─ Read-only tools only, no writes
  │    └──► secure-readonly
  │
  ├─ Controlled writes with approval gating
  │    └──► controlled-write
  │
  ├─ Local context DB + retrieval (Postgres/pgvector)
  │    └──► local-context
  │
  ├─ Full retrieval suite + embeddings + agent harness
  │    └──► full-agentic-context
  │
  └─ Remote deployment (team / CI / internet-facing)
       └──► remote-safe
            (pairs with any of the above for tool policy)
```

## CLI Execution Flow

This is the order of operations for the `init` command. Each step is gated — a failure stops the flow.

```txt
  User: create-agentic-ai-infra init --profile <name> [--dry-run] [--force]
        │
        ▼
  [1] Validate flags and profile name
        │ fail → print usage error, exit
        ▼
  [2] Load config + resolve profile defaults
        │ fail → print validation issues, exit
        ▼
  [3] Build write plan (list of files to generate)
        │
        ▼
  [4] Check for conflicts (existing files, sensitive paths)
        │ conflict + no --force → print conflict report, exit
        ▼
  [5] --dry-run? ──► print write plan, exit (nothing written)
        │ not dry-run
        ▼
  [6] Execute writes (template render → safe writer)
        │
        ▼
  [7] Append managed .gitignore block (idempotent)
        │
        ▼
  [8] Print success summary + next steps to user
```

## Verification

Use pnpm commands only. Future CLI work should include scaffold tests before user-facing generation behavior is considered complete.
