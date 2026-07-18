# Local MCP AI Infra Plan

## Purpose

Local MCP AI infrastructure should help Codex understand the Rudraloka codebase safely.

It is not production AI infrastructure. It is a local developer assistance layer.

## Current Tool

`run_mcp_security_evals` runs local MCP security checks.

Milestone 1 also adds safe local AI DB management tools:

- `check_local_ai_db`
- `get_local_ai_migration_status`
- `run_local_ai_migrations`

These tools manage the local AI database foundation only. They do not scan files, chunk content, generate embeddings, run retrieval, or expose arbitrary SQL.

Milestone 2 adds read-only scanner and chunking preview tools:

- `preview_project_knowledge_scan`
- `preview_project_chunks`
- `run_knowledge_pipeline_evals`

These tools preview the approved knowledge pipeline only. They do not write chunks to Postgres, create embeddings, run vector search, run full-text search, retrieve context, or mutate source files.

Milestone 3 adds manual mock indexing and safe index status tools:

- `index_project_knowledge`
- `get_project_knowledge_index_status`

These tools validate the storage pipeline with deterministic mock embeddings only. `index_project_knowledge` may write to local AI DB RAG index tables, but it must not mutate source files, docs, migrations, or project code. It does not run retrieval, full-text search, context planning, model reranking, paid provider calls, or automatic migrations.

Milestone 4 adds local retrieval and context tools:

- `search_project_knowledge`
- `get_relevant_context`
- `run_project_rag_evals`

These tools read only from the approved local knowledge index. They combine mock pgvector search, Postgres full-text search, metadata filters, heuristic reranking, and bounded context building. They do not run migrations, trigger indexing, mutate source files, call paid providers, use real embeddings, expose arbitrary SQL, or implement `plan_project_context`.

Milestone 5 adds the advisory context planner:

- `plan_project_context`

This tool classifies a task, selects a strategy, and recommends bounded queries, sources, tools, warnings, and next steps. It is deterministic and heuristic-first. It does not call the DB, read files, invoke retrieval tools, call model APIs, run commands, run migrations, index project knowledge, apply patches, or mutate source files.

Final local hardening completes the local-only platform layer. Existing tools keep their names and stable top-level fields, while additive diagnostics improve eval reports, index status, retrieval/context summaries, and sanitized observability. This hardening does not add production AI, real embeddings, paid providers, model rerankers, watch mode, CI/CD, web app work, arbitrary SQL, or new migrations.

```txt
approved sources
   |
   v
indexing policy
   |
   v
safe scan report
   |
   v
bounded chunk previews
```

This diagram shows the Milestone 2 boundary. The new tools help inspect what would be indexed later without creating the index yet.

## Target Direction: Agentic Context Engineering

The target local MCP AI direction is agentic context engineering.

Context engineering is the umbrella: it decides what information belongs in the model context for a task. RAG is the retrieval foundation underneath that umbrella. Agentic planning is the layer that decides when to use retrieval, when to read exact files, when to include security or architecture docs, and when to ask the user for a decision.

```txt
User task
   |
   v
Context planner
   |
   |-- retrieval from approved project knowledge
   |-- exact MCP safe reads when needed
   |-- security / architecture docs when relevant
   `-- eval or log summaries when useful
   |
   v
Compact context for Codex / Claude
```

This diagram shows the desired planning behavior. Retrieval is only one input; the planner chooses the right context mix for the task.

## Locked Implementation Direction

```txt
Agentic Context Engineering
   |
   v
Context-Engineered RAG
   |
   v
Chunking + embeddings + pgvector + full-text search
   |
   v
Hybrid retrieval + heuristic reranking + context builder + evals
```

This diagram shows the approved layering. The agentic planner sits above the retrieval foundation; pgvector is one storage/search component inside the foundation, not the whole architecture.

Locked decisions:

- Local pgvector runtime: Docker Compose under `infra/local-dev/postgres-pgvector/`.
- Embeddings: provider interface + `MockEmbeddingProvider` first; real provider later; no paid provider usage now.
- Vector index: HNSW with conservative, configurable local defaults.
- Chunking: structure-aware with fallback.
- Archive docs: exclude `docs/99-archive/` by default.
- TypeScript parsing: AST-based parsing.
- DB access: direct SQL with `pg` first; Prisma later only if useful.
- Indexing mode: manual first; optional optimized/watch mode later.
- Reranking: heuristic reranking first; model reranker later only if very low cost.
- Keyword search: Postgres full-text search alongside pgvector.

## Context Tools

Current local context tools:

```txt
plan_project_context
index_project_knowledge
search_project_knowledge
get_relevant_context
run_project_rag_evals
run_mcp_security_evals
```

Milestone 2 preview tools remain intentionally narrower:

```txt
preview_project_knowledge_scan
preview_project_chunks
run_knowledge_pipeline_evals
```

## Phased Roadmap

1. Docs/spec decisions finalized.
2. Docker Compose pgvector local runtime. Status: local runtime foundation added.
3. Direct SQL schema/migrations for local knowledge index. Status: Milestone 1 DB foundation added.
4. Scanner + indexing policy. Status: Milestone 2 preview implemented.
5. Structure-aware chunker: Markdown headings, AST-based TypeScript, fallback chunking. Status: Milestone 2 preview implemented.
6. `EmbeddingProvider` interface + `MockEmbeddingProvider`. Status: Milestone 3 implemented.
7. pgvector insert/search + Postgres full-text search. Status: Milestone 3 implements mock pgvector inserts/storage; Milestone 4 implements mock pgvector search and Postgres full-text search.
8. Hybrid retrieval + heuristic reranking. Status: Milestone 4 implemented.
9. Context planner + context builder. Status: context builder is implemented in Milestone 4; deterministic advisory planner is implemented in Milestone 5.
10. MCP context tools. Status: `plan_project_context`, `search_project_knowledge`, `get_relevant_context`, and related safe tools are implemented for local development.
11. Retrieval + planner eval harness. Status: retrieval/context evals are implemented in Milestone 4; planner evals are implemented in Milestone 5.
12. Observability + documentation finalization. Status: final local hardening implemented with bounded diagnostics, safe summaries, and final runbooks.
13. Optional real embedding provider.
14. Optional watch mode.
15. Optional low-cost model reranker.

Current implementation note: Phase 2 creates the local Docker Compose Postgres + pgvector runtime. Milestone 1 adds the direct SQL schema migration and safe MCP DB management tools. Milestone 2 adds read-only scanner/chunker preview tools and pipeline evals. Milestone 3 adds mock embeddings, pgvector storage writes, manual indexing, safe index status, and a defensive HNSW migration file. Milestone 4 adds retrieval/context building. Milestone 5 adds the deterministic advisory planner. Final local hardening adds eval quality reports, sanitized diagnostic summaries, trace/span metadata, conservative hash-based indexing pre-skips, and final operation/security docs.

```txt
Phase 2 runtime
   |
   v
infra/local-dev/postgres-pgvector/
   |
   v
Docker Compose service
   |
   v
Postgres + pgvector on localhost:5433
```

This diagram shows the Phase 2 boundary. It is the database runtime foundation, not the RAG system.

Phase 2 includes:

- Compose folder: `infra/local-dev/postgres-pgvector/`
- Service/container: `rudraloka-local-pgvector`
- Volume: `rudraloka-local-pgvector-data`
- Database: `rudraloka_local_ai`
- User: `rudraloka_local`
- Host port: `5433`
- pgvector extension enabled by init SQL

Phase 2 did not include:

- RAG schema tables.
- Embeddings.
- HNSW index creation.
- MCP database connection code.
- RAG/context MCP tools.

Milestone 1 adds the `local_ai` schema and migration runner. Milestone 2 adds scanner and chunker previews. Milestone 3 adds mock embeddings and storage writes. Milestone 4 adds retrieval/context tools. Milestone 5 adds planner behavior without automatic execution.

It remains intentionally low-memory and low-cost. HNSW is still the future selected vector index, but it is not created until chunks, embeddings, and local tuning defaults exist.

Current next boundary: runtime validation of final local hardening should be manual. Migrations and indexing must still be explicitly triggered after code review.

Not next: real embeddings, model reranker, planner-driven tool execution, watch mode, or production customer RAG. Those stay deferred until the local mock pipeline and safety boundary are separately reviewed for the next phase.

## Local RAG Index

A future local RAG index could include approved source and docs content. It should help Codex retrieve relevant context without reading the whole repository.

## Indexing Restrictions

The indexer must not index:

- `.env*`
- `.npmrc`
- SSH keys
- tokens
- private keys
- credentials
- `node_modules`
- `.git`
- `dist`
- `build`
- `coverage`
- `.mcp-local`

If a path is blocked for MCP reads, it should also be blocked for indexing.

## Why This Matters

Indexing can accidentally become a shadow copy of sensitive data. The local RAG index must follow the same security model as the MCP read tools.

The safe pattern is: approved text only, deterministic metadata, clear deletion/re-indexing behavior, and no secrets.

For the detailed design, read [local-mcp-agentic-context-rag-design-spec.md](local-mcp-agentic-context-rag-design-spec.md).

Related learning notes:

- [Agentic Context Engineering And RAG Design](../01-learning-journal/2026-05-09-agentic-context-rag-design.md).
- [Local AI DB Schema And Migrations](../01-learning-journal/2026-05-09-local-ai-db-schema-and-migrations.md).
- [Hybrid Retrieval And Context Builder](../01-learning-journal/2026-05-10-hybrid-retrieval-and-context-builder.md).
- [Agentic Context Planner](../01-learning-journal/2026-05-10-agentic-context-planner.md).

Phase 2 runtime runbook: [Local pgvector Runtime](../06-runbooks/local-pgvector-runtime.md).

Milestone 1 migration runbook: [Local AI DB Migrations](../06-runbooks/local-ai-db-migrations.md).

Milestone 4 retrieval runbook: [Local Project Knowledge Retrieval](../06-runbooks/local-project-knowledge-retrieval.md).

Milestone 5 planner runbook: [Local Project Context Planner](../06-runbooks/local-project-context-planner.md).

Final hardening operations runbook: [Local MCP AI Infrastructure Operations](../06-runbooks/local-mcp-ai-infra-operations.md).

Final hardening security checklist: [Local MCP AI Security Checklist](../05-security/local-mcp-ai-security-checklist.md).
