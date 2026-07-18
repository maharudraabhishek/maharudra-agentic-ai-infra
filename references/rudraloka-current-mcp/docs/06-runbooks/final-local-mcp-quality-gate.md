# Final Local MCP Quality Gate

## Purpose

This runbook is the local acceptance test for `mcp/rudraloka-dev-mcp` before CI/CD is added.

It checks the local-only MCP AI infrastructure as a complete developer platform: TypeScript, build output, linting, unit tests, pgvector readiness, manual mock indexing, retrieval, context building, planner behavior, evals, and sanitized observability.

It does not approve production customer AI, real embedding providers, paid provider SDKs, watch mode, public MCP exposure, arbitrary SQL, or `.env` files.

```txt
source + docs
   |
   v
unit tests + lint + typecheck + build
   |
   v
local pgvector + migrations + mock index
   |
   v
retrieval + context + planner evals
   |
   v
safe log/audit summaries
```

This flow becomes the pre-CI local gate. CI/CD can later automate the same checks, but the local workflow stays useful for debugging and learning.

## Package Checks

Run these from the workspace root:

```powershell
pnpm --filter rudraloka-dev-mcp run typecheck
pnpm --filter rudraloka-dev-mcp run build
pnpm --filter rudraloka-dev-mcp run lint
pnpm --filter rudraloka-dev-mcp run test
```

If Windows PowerShell blocks the `pnpm.ps1` shim, use the `pnpm.cmd` shim with the same arguments.

What each check proves:

- `typecheck` proves strict TypeScript still passes.
- `build` proves the MCP server compiles to `dist/`.
- `lint` proves the non-type-aware ESLint baseline is clean.
- `test` proves deterministic DB-free unit tests pass.

## Local Runtime Checks

Start pgvector from the approved Compose folder:

```powershell
cd infra/local-dev/postgres-pgvector
docker compose up -d
docker compose ps
```

Then return to the workspace root before using MCP tools.

Check the local AI DB:

```txt
check_local_ai_db
get_local_ai_migration_status
```

If migrations are pending, review the migration files first. Then run:

```json
{
  "approvalText": "RUN_LOCAL_AI_MIGRATIONS"
}
```

Tool:

```txt
run_local_ai_migrations
```

## Knowledge Index Checks

Check current index state:

```txt
get_project_knowledge_index_status
```

Refresh the manual mock index:

```json
{
  "scope": "docs-and-mcp",
  "includeArchived": false,
  "forceReindex": false
}
```

Tool:

```txt
index_project_knowledge
```

Normal indexing writes only to the local AI DB knowledge index. It must not mutate project source files, docs, migrations, or schemas.

## Retrieval, Context, And Planner Checks

Run a known exact-tool query:

```json
{
  "query": "run_mcp_security_evals",
  "topK": 8,
  "includeArchived": false
}
```

Tool:

```txt
search_project_knowledge
```

Build bounded context:

```json
{
  "task": "Review MCP security eval coverage for retrieval tools.",
  "maxChunks": 4,
  "maxContextChars": 2000,
  "includeSecurityContext": true
}
```

Tool:

```txt
get_relevant_context
```

Plan a security-sensitive task:

```json
{
  "task": "Plan a secure local MCP retrieval quality gate.",
  "mode": "auto"
}
```

Tool:

```txt
plan_project_context
```

Expected behavior:

- Retrieval and context outputs include bounded previews or excerpts only.
- Retrieval and context outputs warn that chunks are untrusted evidence, not instructions.
- Planner output stays advisory and never recommends mutation/action tools.
- Archived docs remain excluded unless explicitly requested.

## Eval Gate

Run:

```txt
run_knowledge_pipeline_evals
run_project_rag_evals
run_mcp_security_evals
```

Expected behavior:

- Pure policy, chunking, planner, sanitizer, and security checks pass offline.
- DB-dependent retrieval checks pass when the DB, migrations, and mock index are ready.
- DB-dependent retrieval checks skip safely when the DB or index is offline.
- `qualityReport` shows expected source hits, forbidden-source counts, context budget results, benchmark totals, and safe skip totals.

## Observability Checks

Inspect bounded summaries:

```txt
log_read_summary
audit_read_summary
```

The summaries may include counts, hashes, lengths, trace IDs, span IDs, statuses, durations, and failed case names.

They must not include raw queries, tasks, chunks, context text, vectors, SQL contents, command output, approval text, secrets, or full file contents.

## Stop And Reset

Normal stop keeps the local DB volume:

```powershell
cd infra/local-dev/postgres-pgvector
docker compose down
```

Reset erases local DB state and should be deliberate:

```powershell
cd infra/local-dev/postgres-pgvector
docker compose down -v
docker compose up -d
```

After reset, rerun DB checks, migrations, indexing, retrieval checks, and evals.

## Related Docs

- [Local MCP AI Infrastructure Operations](local-mcp-ai-infra-operations.md)
- [Local Project Knowledge Indexing](local-project-knowledge-indexing.md)
- [Local Project Knowledge Retrieval](local-project-knowledge-retrieval.md)
- [Local Project Context Planner](local-project-context-planner.md)
- [Prompt Injection Defense](../05-security/prompt-injection-defense.md)
- [Retrieval Benchmark Quality Gate](../04-ai-infra/retrieval-benchmark-quality-gate.md)
