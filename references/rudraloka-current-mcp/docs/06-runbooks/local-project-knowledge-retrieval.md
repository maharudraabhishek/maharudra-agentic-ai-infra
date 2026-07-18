# Local Project Knowledge Retrieval

## Purpose

Milestone 4 adds safe local retrieval on top of the manual mock knowledge index.

```txt
manual migrations + manual indexing
   |
   v
local_ai mock knowledge index
   |
   v
search_project_knowledge / get_relevant_context
```

This diagram shows the operating boundary. Retrieval reads an existing approved index. It does not start Docker, run migrations, index files, or mutate project source.

## What Retrieval Tools Do

`search_project_knowledge` searches approved indexed project knowledge with:

- deterministic mock query embeddings
- pgvector cosine search
- Postgres full-text search
- source type and path prefix filters
- archive exclusion by default
- heuristic reranking
- bounded previews

`get_relevant_context` builds a compact context packet from search results. It returns source paths, headings, symbols, match reasons, and short excerpts. It does not return vectors or full chunk bodies by default.

`run_project_rag_evals` runs retrieval and context checks. DB-dependent checks are skipped with a clear reason when the DB, migration `003`, or completed mock index is not ready.

Final hardening makes `run_project_rag_evals` the retrieval quality report surface. The additive `qualityReport` summarizes hit counts, miss counts, forbidden hit counts, skip counts, context budget results, and planner totals without returning chunk bodies.

Milestone 5 adds `plan_project_context` as a separate advisory planner. Retrieval tools do not call the planner automatically.

## Required Manual Setup

Codex must not run these setup steps automatically during implementation.

1. Review migration `003_add_project_knowledge_retrieval_search.sql`.
2. Check migration status with `get_local_ai_migration_status`.
3. Apply migrations only after approval with `run_local_ai_migrations`.
4. Refresh the mock index only when wanted with `index_project_knowledge`.
5. Check index status with `get_project_knowledge_index_status`.

Retrieval uses the latest successful completed mock index run. If none exists, retrieval returns `index-not-ready`.

## Safe Search Example

Tool:

```txt
search_project_knowledge
```

Input:

```json
{
  "query": "run_mcp_security_evals",
  "topK": 8,
  "includeArchived": false
}
```

Expected behavior:

- returns bounded previews only
- includes source paths and match reasons
- may include safe diagnostics such as hashes, lengths, counts, and source counts
- does not return vectors
- does not mutate source files

## Safe Context Example

Tool:

```txt
get_relevant_context
```

Input:

```json
{
  "task": "Review MCP security eval coverage for retrieval tools.",
  "maxChunks": 6,
  "maxContextChars": 8000,
  "includeSecurityContext": true
}
```

Expected behavior:

- returns compact context within the requested budget
- cites each source path
- may include safe budget diagnostics
- prefers security docs when requested
- does not implement `plan_project_context`

## Troubleshooting

### DB unavailable

Meaning: the local Postgres + pgvector runtime is not reachable.

Fix: start the local runtime manually using the local pgvector runbook. Do not ask retrieval tools to recover by reading source files directly.

### Migration 003 pending

Meaning: full-text search support has not been added to the local AI DB.

Fix: review migration status and apply migrations manually only after approval.

### Index not ready

Meaning: there is no latest completed mock index run.

Fix: run manual indexing after reviewing the current migration and indexing state.

### Results look semantically weak

Meaning: the mock embedding provider is deterministic but not semantic.

Fix: rely on exact names, full-text search, metadata filters, and source-specific queries for now. Real semantic quality waits for a separately approved embedding provider.

### Quality report shows expected-source misses

Meaning: a deterministic eval case did not retrieve the expected safe source class.

Fix: inspect the capped returned source paths and recommended next check in the eval diagnostics. Do not expand indexing scope or return raw chunks just to debug the miss.

## Related Docs

- [Local Project Knowledge Indexing](local-project-knowledge-indexing.md)
- [Local MCP Agentic Context Engineering + RAG Design Spec](../04-ai-infra/local-mcp-agentic-context-rag-design-spec.md)
- [Hybrid Retrieval And Context Builder](../01-learning-journal/2026-05-10-hybrid-retrieval-and-context-builder.md)
- [Final Local MCP AI Hardening](../01-learning-journal/2026-05-10-final-local-mcp-ai-hardening.md)
- [Local MCP AI Infrastructure Operations](local-mcp-ai-infra-operations.md)
- [Local Project Context Planner](local-project-context-planner.md)
