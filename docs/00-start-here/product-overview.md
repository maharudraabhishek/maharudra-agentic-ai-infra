# Product Overview

MahaRudra Agentic AI Infra is a reusable local-first and remote-safe framework for generating agentic AI infrastructure inside many projects.

The product is a strict TypeScript and pnpm monorepo. It is package-ready and release-ready, but package publishing has not been executed.

## Quick Start

Three working examples are available. Start with `vectorless-local` (no infrastructure needed),
graduate to `local-context` when you want Postgres-backed persistence, or run `pdf-rag`
to see the complete PDF ingestion pipeline in memory.

| Example | Profile | Requires | Command |
|---|---|---|---|
| vectorless-local | `vectorless-local` | Node >= 20, nothing else | `pnpm start:vectorless` |
| local-context | `local-context` | Docker + `.env` with `DATABASE_URL` | `pnpm start:local-context` |
| pdf-rag | `vectorless-local` | Node >= 20, nothing else | `pnpm start:pdf-rag` |

### vectorless-local (zero infrastructure)

```sh
# Build and run — no Postgres, no Docker, no API keys
pnpm --filter @maharudra/agentic-ai-infra-examples build
pnpm --filter @maharudra/agentic-ai-infra-examples start:vectorless
```

Uses `InMemoryStorageProvider`, SHA-256 mock embeddings, and hybrid retrieval. Indexes
`examples/`, runs a planning pass, calls `agentic.retrieval.search`, and prints JSON.

See `examples/src/vectorless-local/` for source and `docs/08-examples/vectorless-local.md`
for the step-by-step walkthrough.

### pdf-rag (PDF ingestion, zero infrastructure)

```sh
pnpm --filter @maharudra/agentic-ai-infra-examples start:pdf-rag
```

Generates a 3-page PDF entirely in memory with `pdf-lib`, extracts pages with `pdf-parse`,
chunks with `pdfPageChunker`, embeds with `MockEmbeddingProvider`, and retrieves via
`RetrievalRouter`. No database, no Docker, no network calls.

See `examples/src/pdf-rag/` for source and `docs/08-examples/pdf-rag.md` for the
step-by-step walkthrough.

### local-context (Postgres-backed RAG)

```sh
# First: start Postgres and copy env
docker compose up -d postgres
cp .env.example .env

# Run with migrations on first startup
RUN_AGENTIC_AI_INFRA_MIGRATIONS=true pnpm --filter @maharudra/agentic-ai-infra-examples start:local-context
# Subsequent runs (chunks already indexed):
pnpm --filter @maharudra/agentic-ai-infra-examples start:local-context
```

Uses `PostgresStorageProvider` with tsvector full-text retrieval. Chunks persist across
restarts. Prints `session_id` and `run_id` in stdout JSON to prove session tracking.

See `examples/src/local-context/` for source and `docs/08-examples/local-context.md`
for the step-by-step walkthrough.

## Package Surfaces

| Package | Responsibility | Boundary |
| --- | --- | --- |
| `@maharudra/agentic-ai-infra-core` | Contracts, profiles, validation, policy models, typed framework primitives. | No runtime startup, database connection, or UI server side effects. |
| `@maharudra/create-agentic-ai-infra` | CLI orchestration, template rendering, safe write planning, validation, doctor checks. | Generates neutral project files instead of exposing package internals. |
| `@maharudra/agentic-ai-infra-runtime` | Local STDIO MCP, remote-safe MCP/API adapters, retrieval, context, storage, migrations, cache, agent harness, token accounting. | Keeps local-only capabilities out of remote surfaces. |
| `@maharudra/agentic-ai-infra-dashboard` | Sanitized JSON/HTML dashboard views and explicit loopback server startup. | Displays summaries, not raw task text or secrets. |
| `@maharudra/agentic-ai-infra-test-utils` | Shared smoke-test and scaffold assertion helpers. | Supports verification without becoming runtime code. |

## Product Shape

```txt
User project
  |
  v
agentic-ai-infra.config.ts
  |
  v
Core profiles + validation
  |
  +--> Local STDIO MCP generated setup
  +--> Remote-safe MCP/API generated setup
  +--> Retrieval + context contracts
  +--> Provider-free deterministic agent runtime
  +--> Token dashboard summaries
```

## Generated Project Contract

Generated user projects use neutral paths:

```txt
tools/agentic/mcp-server/
services/agentic-context-service/
infra/local-dev/ai-context-db/
infra/db/ai-context/
docs/03-agentic-infra/
.agents/skills/
.agentic-local/
agentic-ai-infra.config.ts
AGENTS.md
CLAUDE.md
CUSTOMIZE_WITH_CODEX.md
```

`.agentic-local/` is local private state and is ignored through an append-only managed `.gitignore` block.

## Important Boundaries

- Docker files are generated for user-started Docker only.
- Migrations are approval-gated and never run automatically.
- Remote-safe surfaces require project-owned auth, authorization, rate-limit, and audit policy implementation before production use.
- The deterministic agent runtime has no paid provider SDKs and does not include model/provider integrations.
