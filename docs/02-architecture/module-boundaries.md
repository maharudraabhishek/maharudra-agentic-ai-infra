# Module Responsibilities

The framework uses clean architecture and dependency inversion. Public contracts live in core; concrete adapters depend on those contracts.

```txt
┌─────────────────────────────┐
│ Outer Adapters And Packages │
└──────────────┬──────────────┘
               │ depend on
               ▼
┌─────────────────────────────┐
│ Application Orchestration   │
└──────────────┬──────────────┘
               │ depends on
               ▼
┌─────────────────────────────┐
│ Core Contracts              │
└─────────────────────────────┘
```

The dependency direction points inward. Runtime adapters, CLI generation, dashboard UI, and provider implementations can change without changing the core contract model.

## Core Package

`@maharudra/agentic-ai-infra-core` owns:

- config and profile contracts
- validation and typed errors
- runtime surface contracts
- tool, permission, and approval contracts
- agent, retrieval, context, token, storage, cache, eval, and observability contracts

## Other Packages

- `@maharudra/create-agentic-ai-infra`: generation orchestration and templates.
- `@maharudra/agentic-ai-infra-runtime`: concrete runtime adapters, storage, migrations, retrieval, context, cache, and observability services.
- `@maharudra/agentic-ai-infra-dashboard`: UI and dashboard presentation.
- `@maharudra/agentic-ai-infra-test-utils`: reusable fixtures and verification helpers.

## SOLID Design Notes

- Interfaces describe behavior without choosing concrete providers.
- Config profiles keep user choices simple.
- Validators protect trust boundaries before runtime code executes.
- Runtime surfaces stay separate so local developer power does not leak into remote tools.
