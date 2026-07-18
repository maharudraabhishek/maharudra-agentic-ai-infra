---
name: package-release-readiness
description: Use when preparing MahaRudra Agentic AI Infra packages for publishing, release workflows, package exports, versioning, changelogs, CI/CD release gates, or public package documentation.
---

# Package Release Readiness

Keep all packages private until release decisions are explicitly approved.

## Workflow

1. Read `AGENTS.md` and `docs/02-architecture/ci-cd-and-release-architecture.md`.
2. Verify package names, exports, files, docs, license, changelog, and version policy before publishing.
3. Do not change package publish posture without explicit approval.
4. Keep release workflows reproducible with pnpm and locked dependencies.
5. Add release dry-runs before enabling public publish automation.
6. Follow `AGENTS.md` documentation rules for code changes: explain non-obvious intent, platform behavior, safety boundaries, package contracts, and maintenance expectations in comments or docs.
7. Do not apply documentation narrowly: package READMEs must map public classes/functions/types, feature responsibilities, execution flow, package boundaries, scripts, verification expectations, and any source included in a documentation pass. For code included in that pass, require language-appropriate API documentation comments before declarations, using JSDoc/TSDoc for JS/TS, Javadoc for Java, Dartdoc for Dart, docstrings for Python, XML docs for C#, Rustdoc for Rust, Go doc comments for Go, and JSDoc as the fallback.
8. Documentation and visual explanations: Do not use Mermaid, PlantUML, Graphviz, image diagrams, or extension-dependent diagram formats. Use plain Markdown-compatible diagrams that visually resemble Mermaid-style diagrams where practical, using ASCII/Unicode boxes, arrows, sequence-style text diagrams, class/interface relationship diagrams, tree diagrams, decision trees, workflow blocks, and Markdown tables. Diagrams must render correctly as plain text, GitHub Markdown, and VS Code raw Markdown. Use fenced `txt` code blocks for complex diagrams and add a short explanation before or after each diagram. Use diagrams wherever they improve understanding of architecture, runtime flow, CLI setup, retrieval/context flow, agent harness behavior, token-efficient multi-agent orchestration, dashboard data flow, CI/CD, release readiness, and package/module relationships. Use tables for timeline, Gantt-like, matrix, comparison, and breakdown diagrams. Do not add decorative or inaccurate diagrams. Public docs must remain professional and must not expose internal phase/build-history wording; internal planning diagrams belong under `docs/internal/`.

## Release Gate Flow

Each gate is a hard stop. A failure at any step must be resolved before continuing. The flow never ends in a publish step — that requires separate explicit approval.

```txt
  pnpm run release:check
        │
        ▼
  ┌─────────────────────────────────────────────┐
  │ [1] pnpm typecheck                          │
  │     All packages must pass strict TS check  │
  └───────────────┬─────────────────────────────┘
                  │ FAIL → stop, fix type errors first
                  ▼ PASS
  ┌─────────────────────────────────────────────┐
  │ [2] pnpm build                              │
  │     All dist/ outputs must compile cleanly  │
  └───────────────┬─────────────────────────────┘
                  │ FAIL → stop, fix build errors
                  ▼ PASS
  ┌─────────────────────────────────────────────┐
  │ [3] pnpm test                               │
  │     All tests must pass                     │
  └───────────────┬─────────────────────────────┘
                  │ FAIL → stop, fix failing tests
                  ▼ PASS
  ┌─────────────────────────────────────────────┐
  │ [4] pnpm lint                               │
  │     No lint errors allowed                  │
  └───────────────┬─────────────────────────────┘
                  │ FAIL → stop, fix lint errors
                  ▼ PASS
  ┌─────────────────────────────────────────────┐
  │ [5] pnpm -r list --depth -1                 │
  │     Inspect workspace deps and exports      │
  └───────────────┬─────────────────────────────┘
                  │ unexpected dep? → stop, audit before continuing
                  ▼ PASS
  ┌─────────────────────────────────────────────┐
  │ [6] Manual package checklist                │
  │     private: true ✓                         │
  │     license: UNLICENSED ✓                   │
  │     no secrets in package files ✓           │
  │     exports field correct ✓                 │
  │     README exists ✓                         │
  │     CHANGELOG updated ✓                     │
  └───────────────┬─────────────────────────────┘
                  │
                  ▼
  ┌─────────────────────────────────────────────┐
  │  RELEASE-READY                              │
  │  Packages are prepared but NOT published.   │
  │  Publishing requires explicit user approval │
  │  and removal of private: true per package.  │
  └─────────────────────────────────────────────┘
```

## Verification

Run pnpm workspace checks and package-level build/typecheck/test commands before any release-readiness claim.
