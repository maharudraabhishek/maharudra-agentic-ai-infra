# Architecture Decisions

This file records decisions that have already been made. Future architecture decisions should be added here after options and tradeoffs are presented and the user chooses.

## Decisions So Far

## Package Manager

Decision: use pnpm only.

Rationale: one package manager avoids lockfile drift and inconsistent command behavior.

## Workspace Name

Decision: the workspace is named `rudraloka-workplace`.

## Repository Shape

Decision: use a monorepo.

Rationale: the project spans web, MCP, docs, future services, and infrastructure. A monorepo keeps learning context and cross-system changes easier to navigate.

## Runtime Architecture

Decision: use independently deployed microservices over time.

Rationale: source code can live in one repo while services deploy separately when CI/CD is configured correctly.

## Infrastructure Location

Decision: keep infrastructure under `infra/` inside the monorepo.

Rationale: app, service, and deployment changes can be reviewed together while still supporting Git-based deployment workflows.

## Service Folder Direction

Decision: future services will be separated into `services/ai/`, `services/non-ai/`, and `services/platform/`.

Rationale: AI services have different safety, eval, and observability needs from transactional business services and shared platform services.

## Codex MCP Config

Decision: prefer the global Codex config path for local MCP setup.

Current path:

```txt
C:\Users\abhi1\.codex\config.toml
```

Rationale: global config makes the local MCP server available consistently to Codex.

## Architecture Decision Behavior

Decision: Codex must present options and tradeoffs, give a recommendation separately, and let the user choose.

Rationale: architecture choices have long-term consequences. The user owns the decision.

## Explanation Style

Decision: future docs should explain concepts, mental models, examples, and tradeoffs before commands or prompts.

Rationale: the project is also a learning system, not just an implementation workspace.

## Local MCP Agentic Context Engineering Decisions

Status: design/spec decisions finalized. Phase 2 local pgvector runtime and Milestone 1 DB foundation are implemented.

Decision: local MCP AI infrastructure will use Agentic Context Engineering as the target architecture for project-aware assistant context.

Context-engineered RAG is the retrieval foundation underneath that planner layer. The retrieval foundation uses chunking, embeddings, pgvector, Postgres full-text search, hybrid retrieval, context building, retrieval evals, and observability.

Future implementation must follow these decisions unless the user changes them. Docs/specs are updated first before implementation.

```txt
Codex / Claude
   |
   v
rudraloka-dev-mcp
   |
   v
Context planner
   |
   |-- RAG retrieval foundation
   |-- exact safe reads
   |-- security / architecture context
   `-- eval-aware strategy
   |
   v
Compact task context
```

This diagram records the intended shape: the planner chooses context strategy, while RAG provides the searchable project knowledge layer underneath.

| # | Area | Decision | Status |
|---|------|----------|--------|
| 1 | Local pgvector runtime | Docker Compose | Locked |
| 2 | Embedding provider/model | Provider interface + mock first; real provider later; no paid usage now | Locked |
| 3 | Vector index | HNSW with memory-optimized local defaults | Locked |
| 4 | Chunking | Structure-aware chunking with fallback | Locked |
| 5 | Archive indexing | Exclude archive docs by default | Locked |
| 6 | TypeScript parsing | AST-based parsing | Locked |
| 7 | DB access | Direct SQL with `pg` first; maybe Prisma later | Locked |
| 8 | Indexing mode | Manual first; optional optimized/watch mode later | Locked |
| 9 | Reranking | Heuristic reranking first; model reranker later only if very low cost | Locked |
| 10 | Keyword search | Postgres full-text search alongside pgvector | Locked |
| 11 | Local context planner | Deterministic advisory planner first; no automatic tool execution | Locked |

Phase 2 local pgvector runtime details are now locked in the section below.

Related design spec: [Local MCP Agentic Context Engineering + RAG Design Spec](../04-ai-infra/local-mcp-agentic-context-rag-design-spec.md).

## Local MCP Context Planner Decision

Decision: Milestone 5 implements `plan_project_context` as a deterministic advisory planner only.

The planner classifies task intent, selects a context strategy, recommends bounded queries/sources/tools, and flags when the user must make an architecture or process decision. It does not call retrieval, read files, query the database, run commands, run migrations, index knowledge, apply patches, call model APIs, or mutate source files.

Rationale:

- Deterministic heuristics keep planner behavior explainable and testable.
- Advisory output preserves the Rudraloka rule to explain options and tradeoffs first, then wait for the user's choice.
- Keeping the planner separate from `get_relevant_context` avoids surprising behavior changes in the existing context builder.
- A strict recommendation allowlist prevents the planner from nudging agents toward mutation/action tools.

Tradeoffs:

- Heuristics can misclassify nuanced tasks.
- The user or AI agent must still decide when to call recommended tools.
- Future integration with context building will need another review and eval pass.

```txt
task string
   |
   v
plan_project_context
   |
   v
advisory strategy + recommended context
   |
   v
user/agent chooses the next safe step
```

This diagram records the Milestone 5 boundary: the planner recommends a path, but it does not execute that path.

## Local pgvector Runtime Decision

Decision: use Docker Compose under `infra/local-dev/postgres-pgvector/` for the local Postgres + pgvector runtime.

This is a concrete Phase 2 implementation decision for local development only. It does not create MCP database connection code, RAG schemas, embeddings, HNSW indexes, or retrieval tools.

| Area | Decision |
|------|----------|
| Compose folder | `infra/local-dev/postgres-pgvector/` |
| Service name | `rudraloka-local-pgvector` |
| Container name | `rudraloka-local-pgvector` |
| Database | `rudraloka_local_ai` |
| User | `rudraloka_local` |
| Host port | `5433` |
| Persistent volume | `rudraloka-local-pgvector-data` |
| Password approach | Local-only non-secret Compose value for dev; no `.env` file in Phase 2 |

Rationale:

- Docker Compose gives a reproducible local pgvector runtime.
- The named volume preserves local state by default.
- Port `5433` avoids the common default Postgres port `5432`.
- A local-only Compose password avoids introducing secret-management machinery before the project needs it.
- Keeping Phase 2 to the runtime foundation prevents accidental RAG scope creep.

Tradeoffs:

- Requires Docker to be installed and running.
- The local port can conflict with another service.
- Persistent volumes can retain old state until manually reset.
- The Compose password is not production secret handling and must not be reused.

```txt
rudraloka-dev-mcp
   |
   | no DB connection in Phase 2
   v
localhost:5433
   |
   v
rudraloka-local-pgvector
   |
   v
Postgres + pgvector
```

This diagram shows the Phase 2 boundary: the database runtime exists, but MCP does not connect to it in Phase 2.

## Local AI DB Schema And Safe MCP DB Tools Decision

Decision: Milestone 1 uses a dedicated Postgres schema named `local_ai`, direct SQL migrations under `infra/db/local-ai/migrations/`, and fixed-purpose MCP DB tools for health checks, migration status, and approved migration execution.

This is local development AI infrastructure only. It is not production/customer storage and not a public MCP database API.

| Area | Decision |
|------|----------|
| Migration folder | `infra/db/local-ai/migrations/` |
| First migration | `001_create_local_ai_schema.sql` |
| Postgres schema | `local_ai` |
| Migration tracking | `local_ai.schema_migrations` |
| DB access | direct SQL with `pg` |
| MCP DB tools | `check_local_ai_db`, `get_local_ai_migration_status`, `run_local_ai_migrations` |
| Approval gate | `RUN_LOCAL_AI_MIGRATIONS` for migration execution |
| Arbitrary SQL | not exposed |
| Vector indexes | not created in Milestone 1 |

Rationale:

- A dedicated schema keeps local AI tables easy to identify and clean up.
- Direct SQL keeps pgvector behavior explicit for learning and review.
- Migration files make schema changes repeatable and auditable.
- Fixed-purpose MCP tools keep the database surface narrow and safer than a general SQL console.
- Deferring HNSW avoids choosing memory settings before embedding dimensions and retrieval behavior are stable.

Tradeoffs:

- Direct SQL needs careful manual query discipline.
- Exact approval text makes schema changes slightly more manual.
- The flexible `vector` column delays dimension enforcement until later provider decisions.

```txt
rudraloka-dev-mcp
   |
   v
safe DB tools
   |
   v
approved migration files
   |
   v
local_ai schema in rudraloka_local_ai
```

This diagram records the Milestone 1 boundary. MCP can manage reviewed DB foundation tasks, but it cannot run arbitrary SQL and it does not implement RAG indexing or retrieval yet.

Related runbook: [Local AI DB Migrations](../06-runbooks/local-ai-db-migrations.md).
