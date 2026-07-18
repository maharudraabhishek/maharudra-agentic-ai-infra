# Architecture Decisions

This file records polished public decisions for MahaRudra Agentic AI Infra. Working notes and implementation chronology stay under `docs/internal/`.

## Package Manager

Decision: use pnpm only.

Rationale: one package manager prevents lockfile drift and keeps generated project guidance consistent.

## Repository Shape

Decision: use a strict TypeScript pnpm monorepo.

```txt
monorepo
|-- core contracts
|-- create CLI
|-- runtime adapters
|-- dashboard
|-- test utilities
`-- docs, templates, examples
```

## Core Contract Ownership

Decision: `@maharudra/agentic-ai-infra-core` owns public framework contracts and validation.

Rationale: runtime adapters, generator output, dashboard summaries, and test utilities need one typed source of truth.

## Generated Project Paths

Decision: generated projects use neutral folder names:

```txt
tools/agentic/mcp-server/
services/agentic-context-service/
infra/local-dev/ai-context-db/
infra/db/ai-context/
docs/03-agentic-infra/
.agents/skills/
.agentic-local/
agentic-ai-infra.config.ts
```

Rationale: neutral paths make the framework reusable across projects and avoid leaking reference implementation identity.

## Local And Remote Runtime Separation

Decision: local STDIO MCP and remote-safe MCP/API are separate runtime surfaces.

Rationale: local developer tooling may use local-first capabilities, while remote surfaces require auth, authorization, rate limits, audit controls, bounded outputs, and no shell or local filesystem exposure.

## Release Posture

Decision: packages remain private while release readiness is verified.

Rationale: package publishing requires a separate license, repository, credential, and explicit publish approval path.

## SessionManager Factory Pattern (Duck-Typed Selection)

Decision: `createSessionManager(db: QueryableDatabase | null): SessionManager` selects the implementation purely by the presence or absence of a non-null `QueryableDatabase`. No `instanceof` checks anywhere in callers.

Rationale: `instanceof` creates a hard coupling between the caller and the concrete class. If a future implementation is added (e.g. `RedisSessionManager`), callers that duck-type never need to change. The factory also preserves dependency inversion: callers work against the `SessionManager` interface from `core`, not against any `runtime` class.

Additionally, the duck-type selection integrates cleanly with profile-based auto-wiring: `createRuntimeServiceContainer` reads the `db` getter on the storage provider (which is `undefined` for `InMemoryStorageProvider`), passes `db ?? null` to the factory, and gets the right implementation automatically. The `vectorless-local` profile therefore gets `InMemorySessionManager` with zero special-casing.
