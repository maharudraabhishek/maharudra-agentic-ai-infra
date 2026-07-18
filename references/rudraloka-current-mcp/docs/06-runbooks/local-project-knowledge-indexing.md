# Local Project Knowledge Indexing

## Purpose

Milestone 3 adds manual local indexing for approved Rudraloka project knowledge.

The goal is to prove the storage pipeline with mock embeddings:

```txt
approved files
   |
   v
scanner + chunker
   |
   v
deterministic mock embeddings
   |
   v
local Postgres + pgvector
```

This diagram shows the Milestone 3 boundary. The system can store approved chunks and mock vectors, but it still does not retrieve context, run full-text search, call a real embedding provider, or plan task context.

## What `index_project_knowledge` Does

`index_project_knowledge`:

- scans only the approved `docs-and-mcp` scope
- excludes `docs/99-archive/` by default
- uses the existing safe scanner and chunkers
- creates deterministic 64-dimensional mock embeddings
- writes documents, chunks, and embeddings to local AI DB RAG tables
- returns bounded summaries with capped skipped/error examples

It does not mutate project source files, docs, migration files, or schemas.

Retrieval is added separately in Milestone 4. Indexing is still manual: retrieval tools do not run migrations or call `index_project_knowledge` automatically.

## Why Mock Embeddings Come First

Mock embeddings are free and deterministic. They let Rudraloka test the pipeline without API keys, `.env` files, provider SDKs, network calls, or paid usage.

Mock embeddings are not semantic. They prove that indexing works; they do not prove retrieval quality. Semantic retrieval comes later after a real provider and Milestone 4 retrieval work are approved.

## HNSW Setup

Migration `002_add_mock_embedding_hnsw_index.sql` adds a partial HNSW index for mock embeddings only:

- `embedding_model = 'rudraloka-mock-embedding'`
- `embedding_version = 'mock-embedding-v1'`
- `embedding_dimension = 64`
- `m = 8`
- `ef_construction = 32`

These are conservative local-dev settings. HNSW can use more memory than IVFFlat, so the first index is deliberately small and mock-specific.

## Run Migrations First

Indexing requires migration `002`, but migrations are never run automatically by the indexing tool.

First check migration status:

```txt
get_local_ai_migration_status
```

Then run migrations only after reviewing pending migration files:

```json
{
  "approvalText": "RUN_LOCAL_AI_MIGRATIONS"
}
```

Tool:

```txt
run_local_ai_migrations
```

## Run Indexing

Use the manual indexing tool:

```txt
index_project_knowledge
```

Default input:

```json
{
  "scope": "docs-and-mcp",
  "includeArchived": false,
  "forceReindex": false,
  "approvalText": ""
}
```

Normal indexing is idempotent. Unchanged files, chunks, and embeddings are skipped, so repeated runs should not duplicate data.

Final hardening adds a conservative pre-chunk skip for unchanged files. A file can skip before chunking only when the stored file path, file hash, content hash, index version, provider metadata, `totalChunks` metadata, chunk count, and embedding count all match. If any metadata is missing or uncertain, the indexer falls back to the existing chunk-then-idempotent path.

## Force Reindex

Use force reindex only when the current mock index should be rebuilt.

```json
{
  "scope": "docs-and-mcp",
  "includeArchived": false,
  "forceReindex": true,
  "approvalText": "REINDEX_PROJECT_KNOWLEDGE"
}
```

Force reindex is tightly scoped. It affects only current mock index rows in the local AI DB. It must never delete `schema_migrations`, schema objects, source files, docs, or migration files.

## Check Status

Use:

```txt
get_project_knowledge_index_status
```

The output includes safe counts and run metadata:

- latest index run
- document count
- chunk count
- embedding count
- embedding model/version/dimension
- unchanged pre-skip and post-skip diagnostics
- HNSW reporting defaults
- capped pending/failed run examples

It never returns full chunks or vectors.

The HNSW defaults are reported for awareness only: `m = 8` and `ef_construction = 32` for the mock embedding index. Do not rewrite applied migrations or add runtime tuning without a separate approval.

## After Milestone 4 Retrieval Is Installed

After code review, migration `003` must be applied manually through the existing migration workflow. Then run or refresh manual indexing only when you explicitly want to update the local mock index.

Retrieval tools use the latest successful completed mock index run. If no completed run exists, `search_project_knowledge` and `get_relevant_context` return an index-not-ready error.

Related retrieval runbook: [Local Project Knowledge Retrieval](local-project-knowledge-retrieval.md).

## Troubleshooting

### DB not running

Symptom: indexing or status returns a safe DB unavailable message.

Fix: start the local pgvector runtime using the local pgvector runbook. Do not run Docker commands through MCP.

### Migrations not applied

Symptom: indexing says migration `002` is pending or local AI DB migrations are not applied.

Fix: run `get_local_ai_migration_status`, review pending migrations, then use `run_local_ai_migrations` with exact approval text.

### Dimension mismatch

Symptom: migration `002` fails because existing embeddings are incompatible with `vector(64)`.

Meaning: the migration found non-null embeddings that are not 64-dimensional. It failed closed instead of truncating or coercing data.

Fix: stop and review the local index state. Do not edit migration files casually.

### HNSW migration issue

Symptom: migration `002` fails while creating the HNSW index.

Fix: confirm pgvector is enabled and supports HNSW. The migration is intentionally conservative, but older pgvector versions may not support HNSW.

### Force reindex approval missing

Symptom: force reindex is denied.

Fix: use exact approval text:

```txt
REINDEX_PROJECT_KNOWLEDGE
```

### Unexpected low indexing work

Symptom: a normal indexing run reports many unchanged pre-skips.

Meaning: the local mock index already has matching metadata for those files.

Fix: no action is required unless you expected changed content. Check `get_project_knowledge_index_status` and run `run_project_rag_evals` to verify retrieval behavior.

## Related Docs

- [Local MCP Agentic Context Engineering + RAG Design Spec](../04-ai-infra/local-mcp-agentic-context-rag-design-spec.md)
- [Local MCP AI Infra Plan](../04-ai-infra/local-mcp-ai-infra-plan.md)
- [Local AI DB Migrations](local-ai-db-migrations.md)
- [Local MCP AI Infrastructure Operations](local-mcp-ai-infra-operations.md)
- [Local Knowledge Scanner And Chunking](local-knowledge-scanner-and-chunking.md)
- [Mock Embeddings And pgvector Storage](../01-learning-journal/2026-05-09-mock-embeddings-and-pgvector-storage.md)
