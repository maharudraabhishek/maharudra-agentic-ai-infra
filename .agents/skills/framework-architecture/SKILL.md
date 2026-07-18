---
name: framework-architecture
description: Use when designing or reviewing MahaRudra Agentic AI Infra framework architecture, package boundaries, clean architecture layers, dependency inversion, generated project contracts, local-first infrastructure, remote-safe architecture, or product roadmap decisions.
---

# Framework Architecture

Ground the work in the product contract before changing files.

## Workflow

1. Read `AGENTS.md`, `docs/00-start-here/product-overview.md`, and relevant architecture docs.
2. Treat MahaRudra Agentic AI Infra as a reusable framework product, not a project-specific MCP fork.
3. Keep package boundaries clean: public interfaces in core, CLI orchestration in create package, dashboard concerns in dashboard, test helpers in test utils.
4. Prefer dependency inversion, typed interfaces, small composable modules, and simple user-facing config profiles.
5. Keep generated project paths neutral and stable.
6. Preserve local STDIO MCP and remote-safe MCP/API as separate deployment surfaces.
7. Document decisions and learning notes whenever architecture changes.
8. Follow `AGENTS.md` documentation rules for code changes: explain non-obvious intent, platform behavior, safety boundaries, generated contracts, and maintenance expectations in comments or docs.
9. Do not apply documentation narrowly: for all code added, modified, or included in an active documentation pass, add language-appropriate API documentation before every class/function/method/type (JSDoc/TSDoc for JS/TS, Javadoc for Java, Dartdoc for Dart, docstrings for Python, XML docs for C#, Rustdoc for Rust, Go doc comments for Go; use JSDoc as the fallback), inline rationale comments inside non-trivial methods, and package/module READMEs that map classes, features, and execution flow.
10. Documentation and visual explanations: Do not use Mermaid, PlantUML, Graphviz, image diagrams, or extension-dependent diagram formats. Use plain Markdown-compatible diagrams that visually resemble Mermaid-style diagrams where practical, using ASCII/Unicode boxes, arrows, sequence-style text diagrams, class/interface relationship diagrams, tree diagrams, decision trees, workflow blocks, and Markdown tables. Diagrams must render correctly as plain text, GitHub Markdown, and VS Code raw Markdown. Use fenced `txt` code blocks for complex diagrams and add a short explanation before or after each diagram. Use diagrams wherever they improve understanding of architecture, runtime flow, CLI setup, retrieval/context flow, agent harness behavior, token-efficient multi-agent orchestration, dashboard data flow, CI/CD, release readiness, and package/module relationships. Use tables for timeline, Gantt-like, matrix, comparison, and breakdown diagrams. Do not add decorative or inaccurate diagrams. Public docs must remain professional and must not expose internal phase/build-history wording; internal planning diagrams belong under `docs/internal/`.

## Package Dependency Layers

Dependencies flow downward only. No package may import from a package above it in this diagram.

```txt
  ┌─────────────────────────────────────────────────────┐
  │         User Project / Generated Setup              │
  └───────────────────────┬─────────────────────────────┘
                          │ uses CLI to generate
                          ▼
  ┌─────────────────────────────────────────────────────┐
  │       @maharudra/create-agentic-ai-infra            │
  │  CLI · template renderer · safe writer · doctor     │
  └───────────────────────┬─────────────────────────────┘
                          │ imports contracts from
                          ▼
  ┌─────────────────────────────────────────────────────┐
  │       @maharudra/agentic-ai-infra-core              │
  │  contracts · profiles · validators · policy types   │
  │  NO runtime startup · NO DB · NO UI side effects    │
  └───────────────────────┬─────────────────────────────┘
                          │ implemented by
                          ▼
  ┌─────────────────────────────────────────────────────┐
  │       @maharudra/agentic-ai-infra-runtime           │
  │  local MCP · remote-safe adapters · retrieval       │
  │  context builder · storage · agent harness · tokens │
  └───────────────────────┬─────────────────────────────┘
                          │ data flows to
                          ▼
  ┌─────────────────────────────────────────────────────┐
  │       @maharudra/agentic-ai-infra-dashboard         │
  │  sanitized JSON/HTML views · loopback server        │
  │  explicit start only · no secrets/raw text          │
  └─────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────┐
  │       @maharudra/agentic-ai-infra-test-utils        │
  │  smoke-test helpers · scaffold assertions           │
  │  used by tests across all packages — not runtime    │
  └─────────────────────────────────────────────────────┘
```

## Local vs Remote Deployment Surface

These are two separate runtime surfaces. Never merge them or expose local capabilities through the remote surface.

```txt
  LOCAL (developer machine)         REMOTE (team / CI / production)
  ─────────────────────────         ────────────────────────────────
  STDIO MCP                         HTTPS MCP  /  API service
  ─────────────────────────         ────────────────────────────────
  ✓ local filesystem tools          ✗ local filesystem tools
  ✓ shell command tools             ✗ shell command tools
  ✓ approval-gated write tools      ✗ write tools
  ✓ migration helpers               ✗ migration tools
  ✓ local DB access                 ✓ bounded retrieval only
  ✗ stdout logging (MCP protocol)   ✓ auth + rate-limit + audit hooks
  ─────────────────────────         ────────────────────────────────
  Codex / Claude Code client        Remote agents / web callers
```

## Verification

Use pnpm-only commands. For scaffold or architecture changes, run `pnpm typecheck`, `pnpm build`, and relevant tests when available.
