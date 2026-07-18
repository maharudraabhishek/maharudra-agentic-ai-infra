---
name: agentic-context-design
description: Use when designing MahaRudra Agentic AI Infra retrieval, context engineering, token efficiency, single-agent or multi-agent modes, embeddings, pgvector, document tree, PageIndex-style, symbol/code, graph, or hybrid retrieval architecture.
---

# Agentic Context Design

Treat context engineering as a product architecture concern.

## Workflow

1. Read `AGENTS.md`, `docs/04-core-framework/retrieval-strategies.md`, and `docs/04-core-framework/agent-modes-and-token-efficiency.md`.
2. Separate local context infrastructure from remote-safe APIs.
3. Keep retrieval strategy choices explicit and profile-driven.
4. Block secrets, private local state, generated output, and unknown file types from indexing plans.
5. Prefer bounded context, citations, exact reads for critical files, and measurable quality signals.
6. Update docs and learning notes when context architecture changes.
7. Follow `AGENTS.md` documentation rules for code changes: explain non-obvious intent, platform behavior, safety boundaries, generated contracts, and maintenance expectations in comments or docs.
8. Do not apply documentation narrowly: for all retrieval/context code added, modified, or included in an active documentation pass, add language-appropriate API documentation before every class/function/method/type (JSDoc/TSDoc for JS/TS, Javadoc for Java, Dartdoc for Dart, docstrings for Python, XML docs for C#, Rustdoc for Rust, Go doc comments for Go; use JSDoc as the fallback), inline rationale comments inside non-trivial methods, and module READMEs that map provider behavior and execution flow.
9. Documentation and visual explanations: Do not use Mermaid, PlantUML, Graphviz, image diagrams, or extension-dependent diagram formats. Use plain Markdown-compatible diagrams that visually resemble Mermaid-style diagrams where practical, using ASCII/Unicode boxes, arrows, sequence-style text diagrams, class/interface relationship diagrams, tree diagrams, decision trees, workflow blocks, and Markdown tables. Diagrams must render correctly as plain text, GitHub Markdown, and VS Code raw Markdown. Use fenced `txt` code blocks for complex diagrams and add a short explanation before or after each diagram. Use diagrams wherever they improve understanding of architecture, runtime flow, CLI setup, retrieval/context flow, agent harness behavior, token-efficient multi-agent orchestration, dashboard data flow, CI/CD, release readiness, and package/module relationships. Use tables for timeline, Gantt-like, matrix, comparison, and breakdown diagrams. Do not add decorative or inaccurate diagrams. Public docs must remain professional and must not expose internal phase/build-history wording; internal planning diagrams belong under `docs/internal/`.

## Retrieval Flow

A query flows through the router, one or more providers run in parallel, and the results are assembled and optimized before reaching the agent.

```txt
  Incoming query / task
        │
        ▼
  ┌─────────────────┐
  │ RetrievalRouter │  (profile-driven — selects active providers)
  └────────┬────────┘
           │ dispatches to matching providers (may be multiple)
           │
     ┌─────┴──────────────────────────────────────┐
     │                                            │
     ▼                                            ▼
  FullTextProvider          PgVectorProvider      ...and/or...
  (pg full-text)            (semantic similarity)
  DocumentTreeProvider      PageIndexProvider
  (file structure)          (chunked docs)
  SymbolCodeProvider        GraphProvider
  (code symbols)            (entity relations)
     │                                            │
     └─────────────────┬──────────────────────────┘
                       │ raw results
                       ▼
              ┌────────────────┐
              │ ContextBuilder │  assembles, deduplicates, cites sources
              └───────┬────────┘
                      │
                      ▼
              ┌──────────────────┐
              │ ContextOptimizer │  applies token budget, ranks, trims
              └───────┬──────────┘
                      │ bounded context packet
                      ▼
              Agent / harness input
```

## Token-Efficient Multi-Agent Flow

Do NOT duplicate the full context for each agent role. Build the shared packet once, then slice per role.

```txt
  Task
    │
    ▼
  ┌─────────────────────────────┐
  │  SharedContextPacket        │  built ONCE from retrieval output
  │  (full context, one copy)   │
  └──────────────┬──────────────┘
                 │
    ┌────────────┼────────────────────────────────┐
    │            │            │                   │
    ▼            ▼            ▼                   ▼
  Role slice   Role slice   Role slice   ...  Role slice
  security     architecture implementation       docs
  reviewer     reviewer     planner           reviewer
    │            │            │                   │
    ▼            ▼            ▼                   ▼
  bounded      bounded      bounded           bounded
  output       output       output            output
    │            │            │                   │
    └────────────┴────────────┴───────────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ SynthesisEngine │
                    └────────┬────────┘
                             │
                             ▼
                    Single final output
                    + token savings report
```

## Verification

Future implementation must include retrieval, context-budget, and safety tests before runtime behavior is trusted.
