# Product Architecture

MahaRudra Agentic AI Infra is structured as a reusable framework and generator product.

The product architecture starts with typed framework contracts, then lets the CLI render only the selected local or remote-ready surfaces into user projects.

```txt
┌──────────────────────────────────┐
│ @maharudra/agentic-ai-infra-core │
└──────────────┬───────────────────┘
               ▼
┌──────────────────────────────────┐
│ Profiles And Validation          │
└──────────────┬───────────────────┘
               ▼
┌──────────────────────────────────┐
│ @maharudra/create-agentic-ai-    │
│ infra                            │
└──────────────┬───────────────────┘
               ▼
┌──────────────────────────────────┐
│ Templates And Generated Docs     │
└──────────────┬───────────────────┘
               ▼
┌──────────────────────────────────┐
│ Generated Project Infrastructure │
└──────────────┬───────────────────┘
               ├── Local STDIO MCP
               ├── Local context storage
               ├── Docs and runbooks
               └── Remote-safe MCP/API surfaces
```

## Package Responsibilities

- `@maharudra/agentic-ai-infra-core`: typed contracts, profile model, validation, and clean architecture primitives.
- `@maharudra/create-agentic-ai-infra`: CLI and generator orchestration.
- `@maharudra/agentic-ai-infra-dashboard`: token, context, eval, and infrastructure observability surfaces.
- `@maharudra/agentic-ai-infra-test-utils`: test fixtures, scaffold assertions, and eval helpers.

## Architectural Defaults

- pnpm workspace
- strict TypeScript
- dependency inversion at framework seams
- simple profiles over exposed internals
- secure-by-default generated infrastructure
- docs and learning material maintained with meaningful product changes
