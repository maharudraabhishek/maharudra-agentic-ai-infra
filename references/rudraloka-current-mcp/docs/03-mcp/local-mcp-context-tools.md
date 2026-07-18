# Local MCP Context Tools

## Status

Status: Draft / design with Milestone 1 DB foundation tools, Milestone 2 scanner/chunking preview tools, Milestone 3 mock indexing/status tools, Milestone 4 retrieval/context tools, Milestone 5 advisory planner, and final local hardening implemented.

Milestone 1 implements safe local AI DB management tools. Milestone 2 implements read-only scanner and chunking previews so the indexing policy can be reviewed. Milestone 3 implements mock embeddings, pgvector storage, manual indexing, and safe index status. Milestone 4 implements hybrid retrieval, Postgres full-text search, metadata filters, heuristic reranking, a bounded context builder, and retrieval/context evals. Milestone 5 implements deterministic planner behavior without automatic execution. Final hardening adds bounded diagnostics, retrieval quality reports, sanitized trace/span summaries, conservative hash-based indexing pre-skips, and operation/security docs without adding new MCP tools.

## Purpose

Future local MCP context tools should give Codex and Claude safe project context without reading the whole repository and without bypassing existing MCP security boundaries.

The target architecture is agentic context engineering. The tools use context-engineered RAG underneath: approved indexing, structure-aware chunking, embeddings, pgvector, Postgres full-text search, hybrid retrieval, heuristic reranking, a context builder, and evals.

These tools belong to the local development MCP server only. They must not be exposed publicly.

## Implemented Milestone 1 DB Tools

Milestone 1 adds fixed-purpose database tools:

- `check_local_ai_db`
- `get_local_ai_migration_status`
- `run_local_ai_migrations`

These are not RAG retrieval tools. They only check local DB health, show migration metadata, and run reviewed migration files from `infra/db/local-ai/migrations/` after exact approval text.

```txt
Codex / Claude
   |
   v
rudraloka-dev-mcp
   |
   v
Safe DB tools
   |-- health check
   |-- migration status
   `-- approved migration run
   |
   v
local_ai schema
```

This diagram shows the Milestone 1 DB foundation. Later milestones add scanner/chunker previews, mock embeddings, search tools, context builder, and planner behavior above this foundation.

## Implemented Milestone 2 Knowledge Preview Tools

Milestone 2 adds read-only tools:

- `preview_project_knowledge_scan`
- `preview_project_chunks`
- `run_knowledge_pipeline_evals`

```txt
Codex / Claude
   |
   v
rudraloka-dev-mcp
   |
   v
Knowledge preview tools
   |-- safe indexing policy
   |-- safe scanner metadata
   |-- Markdown heading chunks
   |-- TypeScript AST chunks
   `-- fallback chunks
```

This diagram shows the new preview layer. It inspects approved sources and returns bounded metadata/previews, but it does not create an index.

The preview tools remain separate from `index_project_knowledge` because previews return bounded review data only, while indexing writes to the local AI DB.

## Implemented Milestone 3 Mock Indexing Tools

Milestone 3 adds:

- `index_project_knowledge`
- `get_project_knowledge_index_status`

```txt
Codex / Claude
   |
   v
rudraloka-dev-mcp
   |
   v
manual mock indexing
   |-- existing scanner policy
   |-- existing chunkers
   |-- deterministic MockEmbeddingProvider
   `-- local_ai RAG tables only
```

This diagram shows that indexing is a local DB write, not a source-code write. The tool stores approved chunks and mock vectors in the local AI database, returns bounded summaries only, and never returns full chunks or vectors.

`forceReindex` is tightly scoped. It requires exact approval text `REINDEX_PROJECT_KNOWLEDGE` and may delete only current mock index rows. It must never delete schema migrations, schema objects, source files, docs, or migration files.

## Implemented Milestone 4 Retrieval And Context Tools

Milestone 4 adds:

- `search_project_knowledge`
- `get_relevant_context`
- `run_project_rag_evals`

```txt
Codex / Claude
   |
   v
rudraloka-dev-mcp
   |
   v
local retrieval tools
   |-- latest completed mock index run only
   |-- pgvector mock search
   |-- Postgres full-text search
   |-- metadata filters
   |-- heuristic reranking
   `-- bounded context output
```

This diagram shows the Milestone 4 boundary. The tools can search and build compact context from the local index, but they do not run migrations, trigger indexing, mutate project files, expose vectors, or implement a planner.

## Implemented Milestone 5 Context Planner Tool

Milestone 5 adds:

- `plan_project_context`

```txt
Codex / Claude
   |
   v
plan_project_context
   |
   v
deterministic task classification
   |
   v
bounded advisory recommendations
```

This diagram shows the planner boundary. The tool recommends queries, sources, tools, warnings, and next steps, but it does not call the DB, read files, run retrieval, call models, run commands, run migrations, index knowledge, apply patches, or mutate source files.

If the DB, retrieval migration, or completed mock index is missing, the tools return a safe error instead of reading files directly or guessing an index version.

## Mental Model

Think of these tools as a read-only research assistant for the codebase.

The assistant can plan which sources matter, search the approved knowledge index, and return compact context. It cannot edit source files, run arbitrary commands, or expose blocked folders.

```txt
Codex / Claude
   |
   v
rudraloka-dev-mcp
   |
   v
Future Context Tools
   |-- plan context
   |-- index approved knowledge
   |-- search approved knowledge
   |-- build compact context
   `-- run retrieval evals
```

This flow keeps context work inside the local MCP boundary and keeps source mutation separate from retrieval.

## Approved Design Constraints

The current design decisions are locked for the next implementation phase:

- Local vector storage targets Docker Compose Postgres with `pgvector`.
- Embeddings start with an `EmbeddingProvider` interface and `MockEmbeddingProvider`; no paid provider usage is approved now.
- Vector search targets HNSW with conservative, memory-aware local defaults.
- Retrieval combines pgvector semantic search with Postgres full-text search.
- Reranking starts with transparent heuristics, not a model reranker.
- Indexing is manual first. Final hardening adds conservative hash-based pre-skips for normal manual refresh. Watch mode remains deferred.
- Archive docs are excluded by default unless an explicit future option includes them.
- TypeScript chunking should be AST-based with safe fallback chunking.
- Database access starts with direct SQL through `pg`.
- Context/RAG tools must not modify project source files.

```txt
plan_project_context
   |
   v
Context Planner
   |
   v
Context-Engineered RAG
   |-- manual approved indexing
   |-- MockEmbeddingProvider first
   |-- Docker Compose Postgres + pgvector
   |-- Postgres full-text search
   |-- heuristic reranking
   `-- compact context builder
```

The planner decides what kind of context is needed. The RAG foundation retrieves stored project knowledge. The context builder returns a compact packet with source labels instead of dumping raw topK chunks.

## Implemented And Proposed Tools

### `plan_project_context`

Plans what context a task needs.

Status: implemented in Milestone 5 as deterministic advisory planning only.

It classifies task type, chooses a context strategy, recommends bounded queries/sources/tools, warns about security-sensitive work, and indicates whether the user must make a decision. Tool recommendations are allowlisted and never include mutation/action tools such as patch apply, new-file apply, migrations, command execution, indexing, or arbitrary SQL. `get_relevant_context` does not call this planner yet; the two tools remain separately testable.

### `index_project_knowledge`

Status: implemented in Milestone 3 for manual mock indexing.

Indexes approved project knowledge into the local knowledge index.

This tool is manual first. It may mutate only the local knowledge index in Docker Compose Postgres. It must not modify project source files.

The first implementation should work with mock embeddings so indexing and storage behavior can be tested without API keys, env files, or paid provider usage.

### `search_project_knowledge`

Status: implemented in Milestone 4 for local mock-index retrieval.

Searches the approved project knowledge index.

It should combine pgvector semantic retrieval with Postgres full-text search, then apply metadata filters, topK limits, archive inclusion flags, heuristic reranking, and source previews.

### `get_relevant_context`

Status: implemented in Milestone 4 as a context builder, not a planner.

Builds compact task-specific context for Codex or Claude.

It should deduplicate, group by source, apply context budget limits, include warnings, and cite source paths. It should not return raw file dumps when a short sourced preview is enough.

### `run_project_rag_evals`

Status: implemented in Milestone 4 for retrieval/context evals, expanded in Milestone 5 with planner evals, and hardened with an additive `qualityReport`.

It verifies expected source retrieval, forbidden source exclusion, context size, filter validation, safe DB-offline skipping, planner output bounds, deterministic planner output, planner recommendation safety, expected-source misses, forbidden-source hits, context budget behavior, and bounded diagnostics.

## Safety Rules

- Search/context tools are implemented for the local mock index only.
- `plan_project_context` is implemented as advisory deterministic planning only.
- Milestone 3 indexing is manual and mock-only.
- Current DB tools must not expose arbitrary SQL.
- Design/spec review comes before implementation.
- Context/RAG tools must not modify source code.
- `index_project_knowledge` may update only the local knowledge index.
- Tools must obey the existing MCP security policy.
- No secret indexing.
- No arbitrary paths.
- No `.mcp-local` exposure.
- No generated folders.
- No command execution from context/RAG tools.
- No DB, filesystem, retrieval, command, migration, indexing, model, patching, or mutation calls from `plan_project_context`.
- No paid embedding provider use until the user explicitly approves a real provider phase.
- No automatic watch indexing until manual indexing and evals are stable.
- Safe summaries only.
- Safe diagnostics only.
- Fail closed when a source, path, provider, or index state is uncertain.

## Relationship To Current MCP Tools

Current MCP tools provide safe reads, controlled writes, allowlisted pnpm checks, sanitized observability, and MCP security evals.

Future context tools should reuse the same security posture. They should not weaken path policy, blocked directory rules, blocked file rules, logging sanitization, or approval workflows.

```txt
Existing MCP safety
   |-- path policy
   |-- blocked secrets
   |-- blocked directories
   |-- sanitized logs
   `-- security evals
          |
          v
Future context tools
   |-- approved indexing
   |-- safe retrieval
   |-- compact context
   `-- RAG evals
```

The future tools should build on the current safety foundation instead of creating a parallel access path.

## Related Docs

- [Local MCP Agentic Context Engineering + RAG Design Spec](../04-ai-infra/local-mcp-agentic-context-rag-design-spec.md)
- [Local MCP Architecture](local-mcp-architecture.md)
- [MCP Security Policy](../05-security/mcp-security-policy.md)
- [MCP Security Eval Harness](mcp-security-eval-harness.md)
- [Local MCP AI Infrastructure Operations](../06-runbooks/local-mcp-ai-infra-operations.md)
- [Local MCP AI Security Checklist](../05-security/local-mcp-ai-security-checklist.md)
