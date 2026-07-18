# Local AI DB Migrations

## Purpose

This runbook explains how to operate Milestone 1 of the local MCP Agentic Context Engineering + RAG database foundation.

Milestone 1 creates the local AI database schema and adds safe MCP database tools. It does not implement scanning, chunking, embeddings, vector search, RAG retrieval, a context builder, or an agentic planner.

## Mental Model

A database migration is like a Git commit for database structure.

Git commits record how source files changed. Migrations record how tables, constraints, and schemas changed. The `schema_migrations` table is the database's memory of which migration files have already been applied.

```txt
Migration file
   |
   v
schema_migrations row
   |
   v
Database knows this structure change already ran
```

This diagram shows why migrations need both files and tracking rows. The file explains what to change; the tracking row prevents the same change from being applied twice.

## Local Scope

The local AI DB is for local developer assistance only.

- Database: `rudraloka_local_ai`
- Schema: `local_ai`
- Migration folder: `infra/db/local-ai/migrations/`
- Current migrations:
  - `001_create_local_ai_schema.sql`
  - `002_add_mock_embedding_hnsw_index.sql`
- MCP tools:
  - `check_local_ai_db`
  - `get_local_ai_migration_status`
  - `run_local_ai_migrations`

No production data, customer data, secrets, credentials, tokens, private keys, or payment data belongs in this database.

## Tool Flow

```txt
MCP
   |
   v
safe DB tools
   |
   v
Migration runner
   |
   v
approved SQL files only
   |
   v
Postgres + pgvector
   |
   v
local_ai schema
```

This flow keeps database changes behind fixed MCP tools. The assistant cannot send arbitrary SQL. The runner only reads reviewed files from the migration folder.

## Why Arbitrary SQL Is Not Exposed

An arbitrary SQL tool would be too powerful for a local AI assistant. It could drop tables, inspect unexpected data, bypass approval workflows, or copy sensitive values into logs or model context.

The safer pattern is fixed-purpose tools:

- health check: fixed connectivity and pgvector queries only
- status: fixed migration metadata queries only
- migration run: reviewed migration files only, with exact approval text

This is the same safety idea as controlled file writes: narrow tools are easier to audit than a general-purpose command surface.

## Check DB Health

Use the MCP tool:

```json
{}
```

Tool:

```txt
check_local_ai_db
```

Expected healthy result:

```json
{
  "status": "ok",
  "pgvectorEnabled": true,
  "message": "Local AI DB is reachable and pgvector is enabled."
}
```

The output never includes the database password.

## See Migration Status

Use the MCP tool:

```json
{}
```

Tool:

```txt
get_local_ai_migration_status
```

Before running Milestone 1 migrations, the expected shape is:

```json
{
  "status": "ok",
  "total": 1,
  "applied": 0,
  "pending": 1
}
```

If the DB is offline, the tool returns a safe error message instead of raw connection details.

## Run Migrations

Run migrations only after reviewing the migration files.

Tool:

```txt
run_local_ai_migrations
```

Input:

```json
{
  "approvalText": "RUN_LOCAL_AI_MIGRATIONS"
}
```

The approval text must match exactly. This is intentional. Schema changes should be an explicit action, not an accidental health check.

## What Milestone 1 Creates

The first migration creates:

- `local_ai.schema_migrations`
- `local_ai.rag_index_runs`
- `local_ai.rag_documents`
- `local_ai.rag_chunks`
- `local_ai.rag_embeddings`
- `local_ai.rag_retrieval_evals`

The `rag_embeddings.embedding` column starts as pgvector's flexible `vector` type in migration `001`. Migration `002` converts it to `vector(64)` for the Milestone 3 mock provider after checking existing non-null embeddings are already compatible.

Migration `002` creates a partial HNSW index for local mock embedding pipeline validation only:

- model: `rudraloka-mock-embedding`
- version: `mock-embedding-v1`
- dimension: `64`
- `m = 8`
- `ef_construction = 32`

It is defensive and memory-conscious:

- it does not run automatically
- it does not drop tables or schema
- it does not truncate, pad, coerce, or silently rewrite incompatible vectors
- it fails closed if existing non-null embeddings are not 64-dimensional
- it does not add full-text search indexes or retrieval tuning

## Troubleshooting

### DB container not running

Symptom: health check returns an unavailable DB message.

Fix: start the local pgvector runtime using the [Local pgvector Runtime Runbook](local-pgvector-runtime.md). Do not run Docker commands through MCP unless explicitly requested.

### pgvector extension missing

Symptom: health check reaches the database but `pgvectorEnabled` is false, or migrations fail because `vector` is unavailable.

Fix: confirm the local pgvector image and init SQL are correct. The current local runtime enables pgvector during first database initialization.

### Checksum mismatch

Symptom: migration status reports a checksum mismatch.

Cause: an already-applied migration file changed after it was recorded.

Fix: stop and review before changing anything. Do not edit applied migrations casually. For local-only reset cases, follow the pgvector runtime reset guidance after deciding that deleting local DB state is acceptable.

### Migration already applied

Symptom: running migrations reports no pending migrations.

This is normal. The migration runner records applied versions in `local_ai.schema_migrations` and skips current migrations.

### Init SQL runs only on first volume creation

Postgres Docker init scripts run only when the data directory is created for the first time. If init SQL changes after the named volume already exists, the old volume keeps its existing state.

For details, read [Local pgvector Runtime](local-pgvector-runtime.md).

## Related Docs

- [Local MCP Agentic Context Engineering + RAG Design Spec](../04-ai-infra/local-mcp-agentic-context-rag-design-spec.md)
- [Local MCP AI Infra Plan](../04-ai-infra/local-mcp-ai-infra-plan.md)
- [Local MCP Context Tools](../03-mcp/local-mcp-context-tools.md)
- [MCP Security Policy](../05-security/mcp-security-policy.md)
- [Local AI DB Schema And Migrations](../01-learning-journal/2026-05-09-local-ai-db-schema-and-migrations.md)
