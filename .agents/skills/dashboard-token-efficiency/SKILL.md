---
name: dashboard-token-efficiency
description: Use when designing MahaRudra Agentic AI Infra dashboard architecture, token usage observability, context-budget reporting, retrieval quality metrics, eval visibility, latency or cost dashboards, or multi-agent efficiency views.
---

# Dashboard Token Efficiency

Treat dashboard and token efficiency as core product architecture.

## Workflow

1. Read `AGENTS.md`, `docs/07-dashboard/dashboard-architecture.md`, and `docs/04-core-framework/agent-modes-and-token-efficiency.md`.
2. Keep dashboard behavior separate from core framework logic.
3. Prefer typed observability interfaces and bounded summaries.
4. Design for cost, latency, token usage, retrieval quality, eval results, and security-relevant events.
5. Do not add UI or metric collection before the data contracts and privacy boundaries are documented.
6. Follow `AGENTS.md` documentation rules for code changes: explain non-obvious intent, platform behavior, safety boundaries, generated contracts, and maintenance expectations in comments or docs.
7. Do not apply documentation narrowly: for all dashboard/observability code added, modified, or included in an active documentation pass, add language-appropriate API documentation before every class/function/method/type (JSDoc/TSDoc for JS/TS, Javadoc for Java, Dartdoc for Dart, docstrings for Python, XML docs for C#, Rustdoc for Rust, Go doc comments for Go; use JSDoc as the fallback), inline rationale comments inside non-trivial methods, and README mappings for signals and execution flow.
8. Documentation and visual explanations: Do not use Mermaid, PlantUML, Graphviz, image diagrams, or extension-dependent diagram formats. Use plain Markdown-compatible diagrams that visually resemble Mermaid-style diagrams where practical, using ASCII/Unicode boxes, arrows, sequence-style text diagrams, class/interface relationship diagrams, tree diagrams, decision trees, workflow blocks, and Markdown tables. Diagrams must render correctly as plain text, GitHub Markdown, and VS Code raw Markdown. Use fenced `txt` code blocks for complex diagrams and add a short explanation before or after each diagram. Use diagrams wherever they improve understanding of architecture, runtime flow, CLI setup, retrieval/context flow, agent harness behavior, token-efficient multi-agent orchestration, dashboard data flow, CI/CD, release readiness, and package/module relationships. Use tables for timeline, Gantt-like, matrix, comparison, and breakdown diagrams. Do not add decorative or inaccurate diagrams. Public docs must remain professional and must not expose internal phase/build-history wording; internal planning diagrams belong under `docs/internal/`.

## Data Flow: Agent Execution → Dashboard

Data is recorded during execution, sanitized before it leaves the runtime, and served only on explicit user request to loopback.

```txt
  Agent / harness execution
        │
        ├──► TokenRecorder          token counts per phase
        ├──► TrajectoryRecorder     safe event summaries (no raw task text)
        └──► ObservabilitySink      security warnings, cache events, eval signals
        │
        ▼
  ┌──────────────────────────┐
  │  DashboardDataProvider   │  pulls from runtime observability layer
  │  (inside runtime pkg)    │
  └────────────┬─────────────┘
               │ sanitize — strip secrets, raw text, vectors, paths, SQL
               ▼
  ┌──────────────────────────┐
  │  Dashboard package       │  dependency-free, no imports from runtime
  │  (sanitized data only)   │
  │                          │
  │  ├─ JSON renderer        │  machine-readable summary
  │  └─ HTML renderer        │  human-readable views
  └────────────┬─────────────┘
               │ explicit user command only
               ▼
  ┌──────────────────────────┐
  │  Dashboard HTTP server   │  binds to 127.0.0.1 (loopback) by default
  │  (loopback only)         │  never starts automatically
  └──────────────────────────┘

  What the dashboard SHOWS          What the dashboard NEVER shows
  ─────────────────────────         ──────────────────────────────
  token counts per phase            raw task text
  retrieval quality signals         secrets / .env contents
  cache hit/miss rates              approval text
  eval pass/fail summaries          raw SQL or vectors
  trajectory event counts           stack traces
  security warning counts           local absolute paths
  token savings estimate            raw full chunks
```

## Verification

Future dashboard work should include typechecks, UI tests where applicable, and docs explaining observable signals and privacy boundaries.
