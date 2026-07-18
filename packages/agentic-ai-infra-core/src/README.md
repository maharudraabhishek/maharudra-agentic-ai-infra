# Core Source Map

This folder contains the framework contracts and small policy helpers shared by the runtime package, generator package, dashboard package, and tests.

## Modules

- `agents/` defines agent runtime mode contracts and shared-context settings.
- `cache/` defines freshness and cache policy contracts.
- `config/` defines project configuration types and validation behavior.
- `context/` defines context package contracts used by retrieval and runtime services.
- `errors/` defines typed framework result and error helpers.
- `evals/` defines quality and diagnostic report contracts.
- `harness/` defines package-level test harness contracts.
- `observability/` defines dashboard and audit signal contracts.
- `profiles/` defines built-in profiles and profile resolution behavior.
- `retrieval/` defines provider, router, input, and bounded-result contracts.
- `runtime/` defines local STDIO MCP, remote HTTPS MCP, and API service contracts.
- `security/` defines remote-safe policy contracts and filtering helpers.
- `storage/` defines storage provider and migration contracts.
- `token/` defines token budget contracts.
- `tools/` defines tool contracts and registry behavior.

## Execution Flow

```txt
┌─────────────┐
│ User Config │
└──────┬──────┘
       ▼
┌────────────────────┐
│ profiles/ Resolver │
└──────┬─────────────┘
       ▼
┌───────────────────┐
│ config/ Validator │
└──────┬────────────┘
       ▼
┌──────────────────────────────┐
│ runtime/ + tools/ Contracts  │
└──────┬───────────────────────┘
       ▼
┌──────────────────────────────┐
│ security/ Remote-Safe Policy │
└──────┬───────────────────────┘
       ▼
┌──────────────────────────────┐
│ retrieval/context/storage    │
│ Contracts                    │
└──────┬───────────────────────┘
       ▼
┌──────────────────────────────┐
│ Runtime Package              │
│ Implementations              │
└──────────────────────────────┘
```

Core stays side-effect free. Importing this folder does not start servers, read project files, connect to databases, or run migrations.
