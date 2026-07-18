# Local MCP AI Infrastructure Operations

## Purpose

This runbook is the day-to-day operating guide for Rudraloka's local-only MCP AI infrastructure after final hardening.

It covers the scanner, manual mock indexer, hybrid retrieval, compact context builder, advisory planner, eval harnesses, and safe observability summaries. It does not cover production customer AI, real embedding providers, watch mode, model rerankers, CI/CD, or web app work.

```txt
approved docs/source
   |
   v
manual scanner + indexer
   |
   v
local mock RAG index
   |
   v
retrieval + context + planner evals
   |
   v
safe diagnostics and summaries
```

This flow stays inside the local developer MCP boundary. Retrieval and planner tools never mutate source files.

## Normal Refresh

Use normal refresh when approved docs or MCP source files changed and the local mock index should reflect them.

1. Check local DB health with `check_local_ai_db`.
2. Check migration status with `get_local_ai_migration_status`.
3. Check index state with `get_project_knowledge_index_status`.
4. Run `index_project_knowledge` with `forceReindex: false`.
5. Run `run_project_rag_evals`.

Normal indexing is idempotent. Final hardening adds a pre-chunk unchanged-file skip when stored file hash, content hash, index version, provider metadata, total chunk metadata, chunk count, and embedding count all match. If any metadata is missing or uncertain, indexing falls back to the existing chunk-then-idempotent path.

## Diagnostics

Use these tools for safe diagnostics:

- `get_project_knowledge_index_status` for index counts, latest run metadata, provider metadata, HNSW reporting defaults, and maintenance diagnostics.
- `run_project_rag_evals` for retrieval quality, context budget checks, planner checks, safe skips, and expected-source misses.
- `run_knowledge_pipeline_evals` for scanner, chunker, indexing policy, output-cap, and local config checks.
- `run_mcp_security_evals` for MCP safety behavior, sanitizer coverage, approval gates, and forbidden-output checks.
- `log_read_summary` and `audit_read_summary` for bounded metadata summaries only.

Diagnostics must not include raw queries, task text, context text, chunks, vectors, SQL contents, command output, approval text, secrets, or raw file content.

## Retrieval And Context Checks

Use `search_project_knowledge` when you need bounded source previews and match reasons.

Use `get_relevant_context` when you need a compact context packet within explicit chunk and character budgets.

Recommended validation examples:

```json
{
  "query": "run_mcp_security_evals",
  "topK": 8,
  "includeArchived": false
}
```

```json
{
  "task": "Review MCP security eval coverage for retrieval tools.",
  "maxChunks": 4,
  "maxContextChars": 2000,
  "includeSecurityContext": true
}
```

Both tools may include additive diagnostics such as hashes, lengths, counts, filter counts, source counts, and budget status. They must not return vectors or full chunks.

## Planner Checks

Use `plan_project_context` before security-sensitive, architecture-sensitive, or broad AI infra tasks.

The planner is advisory only. It may recommend safe read, context, eval, and observability tools. It must not call those tools, run migrations, index knowledge, run commands, apply patches, or mutate files.

## Explicit Rebuild

Use force rebuild only when the current local mock index should be reset and rebuilt.

```json
{
  "scope": "docs-and-mcp",
  "includeArchived": false,
  "forceReindex": true,
  "approvalText": "REINDEX_PROJECT_KNOWLEDGE"
}
```

The approval text must match exactly. The rebuild is scoped to current mock index rows in the local AI DB. It must not delete schemas, migrations, source files, docs, or generated project assets.

## HNSW Reporting Defaults

The current mock HNSW defaults are:

- `m = 8`
- `ef_construction = 32`
- embedding model `rudraloka-mock-embedding`
- embedding version `mock-embedding-v1`
- embedding dimension `64`

These values are documented and surfaced for diagnostics only. Do not rewrite applied migrations or add runtime tuning without a separate approval.

## DB Offline Behavior

If the local DB is unavailable, DB-dependent retrieval and index checks should fail closed or skip safely. Tools must not recover by reading source files directly, guessing index state, or running setup steps automatically.

Pure planner, policy, scanner, sanitizer, and security checks should continue to run when they do not require DB access.

## Restart Validation

After implementation or MCP restart:

1. Call `project_info` and confirm existing tool names are stable.
2. Call `run_knowledge_pipeline_evals` and confirm pass.
3. Call `get_project_knowledge_index_status` and confirm bounded diagnostics only.
4. Call `index_project_knowledge` with `forceReindex: false`.
5. Call `run_project_rag_evals` and inspect `qualityReport`.
6. Call `search_project_knowledge` with a known MCP/security query.
7. Call `get_relevant_context` with explicit `maxChunks` and `maxContextChars`.
8. Call `plan_project_context` for a security-sensitive AI infra task.
9. Call `log_read_summary` and `audit_read_summary` and confirm sanitized trace/span metadata.

## Related Docs

- [Local Project Knowledge Indexing](local-project-knowledge-indexing.md)
- [Local Project Knowledge Retrieval](local-project-knowledge-retrieval.md)
- [Local Project Context Planner](local-project-context-planner.md)
- [Local MCP AI Security Checklist](../05-security/local-mcp-ai-security-checklist.md)
- [Final Local MCP AI Hardening](../01-learning-journal/2026-05-10-final-local-mcp-ai-hardening.md)
