# Local-Context Example Walkthrough

The `local-context` example shows the MahaRudra Agentic AI Infra retrieval pipeline
running against a Postgres database — persistent chunk storage, tsvector full-text
retrieval, and session tracking across restarts.

## Source location

```txt
examples/src/local-context/index.ts
```

## How to run

```sh
# Prerequisites
docker compose up -d postgres   # from monorepo root
cp .env.example .env            # fill in DATABASE_URL (matches docker-compose defaults)

# First run — apply migrations
RUN_AGENTIC_AI_INFRA_MIGRATIONS=true pnpm --filter @maharudra/agentic-ai-infra-examples start:local-context

# Subsequent runs
pnpm --filter @maharudra/agentic-ai-infra-examples start:local-context
```

PowerShell users:

```powershell
$env:RUN_AGENTIC_AI_INFRA_MIGRATIONS="true"
pnpm --filter @maharudra/agentic-ai-infra-examples start:local-context
```

## What each step does

### Step 1 — Startup guard

```typescript
const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  process.stderr.write("[example] DATABASE_URL is not set...\n");
  process.exit(0); // exit 0: configuration gap, not a crash
}
```

Missing `DATABASE_URL` is a configuration gap, not an error. Exit 0 lets scripts
continue; the message explains the next setup steps. This differs from a runtime failure
(`process.exit(1)`) which would signal an unexpected crash.

### Step 2 — Resolve the local-context profile

```typescript
const resolver = new DefaultProfileResolver();
const configResult = resolver.resolve({
  project: { name: "local-context-example", slug: "local-context-example" },
  profiles: ["local-context"]
});
```

`DefaultProfileResolver` merges the built-in `local-context` profile on top of
`DEFAULT_PROJECT_CONFIG`. The result has:

- `storage.providers[0].type = "postgres"` → requires a Postgres provider
- `retrieval.enabled = true` with three providers (full-text, document-tree, symbol-code)
- `agents.mode = "single-agent"` (inherited from framework baseline)
- `tokenEfficiency.tokenBudget` from the baseline

### Step 3 — Construct PostgresStorageProvider

```typescript
const storageProvider = new PostgresStorageProvider("local-context-store", {
  connectionString: databaseUrl
});
```

The provider creates a `pg.Pool` lazily on first query — no connection is opened during
construction. Pool defaults: `min:2, max:10, idleTimeout:30s, connectionTimeout:5s`.

### Step 4 — Create the runtime service container

```typescript
const containerResult = createRuntimeServiceContainer(resolvedConfig, { storageProvider });
```

`createRuntimeServiceContainer` inspects the resolved config and the injected provider:

```txt
  createRuntimeServiceContainer(resolvedConfig, { storageProvider })
       │
       ├── options.storageProvider set → uses PostgresStorageProvider
       │     (skips auto-wiring: profile declares type:"postgres" but no pool yet)
       │
       ├── detects retrieval.enabled + getChunks present on storageProvider
       │     └── new RetrievalRouter([FullTextProvider, DocumentTreeProvider, SymbolCodeProvider])
       │         each provider wired to PostgresStorageProvider
       │
       ├── detects storageProvider.db absent (connectionString-only → .db = undefined)
       │     └── createSessionManager(null) → InMemorySessionManager
       │         (PostgresSessionManager requires an injected QueryableDatabase)
       │
       └── returns RuntimeServiceContainer { tools, handlers, retrievalRouter,
                                             storageProvider, sessionManager, ... }
```

**Key design note:** `PostgresStorageProvider` constructed with `connectionString` only
has `.db = undefined`. The session manager duck-type check finds no `QueryableDatabase`
and falls back to `InMemorySessionManager`. Sessions are tracked in-process for this run.
For cross-restart session continuity, inject a `QueryableDatabase` — see
`scripts/verify-postgres.ts` for the pattern.

### Step 5 — Run migrations (conditional)

```typescript
if (storageProvider.type === "postgres" && envMigrations) {
  const migResult = await storageProvider.runMigrations(RUN_AGENTIC_AI_INFRA_MIGRATIONS);
  // fatal on failure — never start against an unmigrated schema
}
```

This replicates the migration startup logic from `startLocalRuntime()` without calling
it directly. Examples do not connect transports, so they drive the migration step
explicitly with the same exact-approval-text guard.

Migrations applied on first run: 001 (foundation), 002 (retrieval surfaces), 003
(embedding dimension fix + index_runs), 004 (session/thread/tool-call state).

On subsequent runs with migrations already applied, all 4 are in the `skipped` list and
the step completes immediately (idempotent via `agentic_schema_migrations` table).

### Step 6 — Index the examples/ directory

```typescript
const indexSummary = await indexProjectKnowledge({
  embeddingProvider: new MockEmbeddingProvider(),
  storageProvider,
  projectRoot: examplesRoot
});
```

The indexer:

1. Walks `examples/` recursively using `fs.readdir({ recursive: true })` (Node 20+).
2. Applies path policy via `isIndexablePath` — blocked dirs never read.
3. Checks file hash against `agentic_cache_metadata` — skips unchanged files.
4. Chunks `.md` files by heading hierarchy, `.ts` files by exported symbol.
5. Calls `MockEmbeddingProvider.embedBatch` — deterministic SHA-256 64-dim vectors.
6. Persists via `PostgresStorageProvider.storeKnowledgeChunks()`:
   - Upserts `agentic_sources` and `agentic_documents` for each file.
   - Upserts chunks into `agentic_chunks` (content-addressed by chunk_id).
   - Upserts embedding vectors into `agentic_embeddings`.
   - Updates `agentic_cache_metadata` freshness entries.
7. Calls `recordIndexRun()` to log the run summary in `agentic_index_runs`.

**Production note:** Substitute `LocalEmbeddingProvider` (Ollama/LocalAI) at the
`embeddingProvider` callsite for real semantic vectors. All other code stays identical.

### Step 7a — SingleAgentExecutor planning pass

```typescript
const exampleSessionId = randomUUID();
const executor = new SingleAgentExecutor({
  config: resolvedConfig,
  trajectoryRecorder: container.trajectoryRecorder,
  tokenRecorder: container.tokenRecorder,
  sessionManager: container.sessionManager,
  sessionId: exampleSessionId
});
const agentResult = await executor.execute({ task: "..." });
```

The executor:
- Classifies the task into labels (security, architecture, etc.).
- Selects relevant tool ids from the registered tool list.
- Calls `resumeOrCreateSession(exampleSessionId, ...)` on the session manager.
- Opens a thread under the session for this task.
- Records the planning pass as a tool call in the thread.
- Returns `SingleAgentRunReport` with `runId`, `selectedToolIds`, and `tokenUsage`.

*Executor constructors now accept an options object instead of positional parameters.*

No LLM API calls. No network. Fully deterministic.

### Step 7b — Execute agentic.retrieval.search

```typescript
const searchResult = await Promise.resolve(
  searchHandler({ query: "local-context postgres" }, { ... })
);
```

The `agentic.retrieval.search` handler:

1. Validates the query (non-empty).
2. Calls `retrievalRouter.retrieve({ query: "local-context postgres", maxResults: 10 })`.
3. The router dispatches to `FullTextProvider`, `DocumentTreeProvider`, and
   `SymbolCodeProvider` in parallel.
4. `FullTextProvider` detects that the storage provider is Postgres-backed and runs
   the SQL tsvector path: `search_vector @@ plainto_tsquery('english', $1)` + `ts_rank`.
5. `DocumentTreeProvider` and `SymbolCodeProvider` call `getChunks()` — a SQL JOIN
   of `agentic_chunks` and `agentic_sources` — then score in memory.
6. Results are merged, deduplicated, and bounded (previews ≤ 300 chars, max 10 results).
7. Returns `{ status, query, results[], resultCount, runtimeMode }`.

### Step 8 — Print JSON to stdout

```typescript
const output = {
  session_id: exampleSessionId,
  run_id: agentResult.ok ? agentResult.value.runId : "skipped",
  search: searchResult.ok ? searchResult.value.output : { error: ... }
};
process.stdout.write(JSON.stringify(output, null, 2) + "\n");
```

`session_id` is the UUID the executor used to call `resumeOrCreateSession`. `run_id` is
the deterministic identifier derived from the task hash. Together they prove the session
and thread lifecycle ran successfully for this invocation.

### Step 9 — Drain the Postgres pool

```typescript
} finally {
  await storageProvider.close();
}
```

`close()` is idempotent (`#closed` flag) and MUST be called before the process exits.
Without it, the Node.js process may hang waiting for idle pg connections to release.

`LocalStdioMcpRuntimeAdapter.stop()` also calls `container.storageProvider?.close()`
internally. Calling `close()` here explicitly makes the Postgres pool-drain contract
visible in examples that own the provider reference directly.

## Auto-wiring diagram

```txt
  DatabaseURL (process.env)
        │
        ▼
  new PostgresStorageProvider("local-context-store", { connectionString })
        │
        ▼
  createRuntimeServiceContainer(resolvedConfig, { storageProvider })
        │
        ├── retrieval.enabled + getChunks() present on storageProvider
        │     └── new RetrievalRouter([
        │           FullTextProvider    → SQL tsvector path
        │           DocumentTreeProvider → getChunks() bulk-fetch then in-memory score
        │           SymbolCodeProvider  → getChunks() bulk-fetch then in-memory score
        │         ])
        │
        ├── storageProvider.db === undefined (connectionString-only)
        │     └── InMemorySessionManager (in-process, data lost on restart)
        │
        └── PolicyEnforcingToolRegistry (6 built-in tools, local-stdio-mcp policy)

  RUN_AGENTIC_AI_INFRA_MIGRATIONS env var set?
        │
        ├── yes → storageProvider.runMigrations(exact-approval-text)
        │           001 → 002 → 003 → 004 (idempotent, skips already-applied)
        │
        └── no  → advisory tip printed to stderr

  indexProjectKnowledge({ MockEmbeddingProvider, storageProvider, projectRoot })
        │
        └── storeKnowledgeChunks() → agentic_chunks, agentic_embeddings (persisted)

  SingleAgentExecutor.execute({ task, sessionId })
        │
        └── InMemorySessionManager.resumeOrCreateSession(sessionId)
              └── openThread(sessionId, task)
                    └── recordToolCall(threadId, "agent.single-agent-plan")

  agentic.retrieval.search handler
        │
        └── RetrievalRouter.retrieve({ query: "local-context postgres" })
              ├── FullTextProvider → SQL: search_vector @@ plainto_tsquery
              ├── DocumentTreeProvider → getChunks() SQL + in-memory score
              └── SymbolCodeProvider  → getChunks() SQL + in-memory score

  stdout → { session_id, run_id, search: { status, query, results[], resultCount } }
```

## Expected output

stderr (first run with migrations):

```txt
[example] profile resolved: local-context
[example] running migrations...
[example] migrations: 4 applied, 0 skipped
[example] runtime ready: mode=local-stdio-mcp, tools=6
[example] indexing /path/to/examples ...
[example] index complete: 7 files indexed, 42 chunks, 0 file errors
[example] agent plan: selected=[agentic.retrieval.search], tokens=150
[example] stopped.
```

stderr (subsequent runs — chunks already indexed, no re-index):

```txt
[example] profile resolved: local-context
[example] tip: set RUN_AGENTIC_AI_INFRA_MIGRATIONS=true on first run to apply migrations.
[example] runtime ready: mode=local-stdio-mcp, tools=6
[example] indexing /path/to/examples ...
[example] index complete: 0 files indexed, 0 chunks, 0 file errors
[example] agent plan: selected=[agentic.retrieval.search], tokens=150
[example] stopped.
```

stdout (JSON):

```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "run_id": "run-a1b2c3d4e5f6",
  "search": {
    "status": "ok",
    "query": "local-context postgres",
    "results": [
      {
        "chunkId": "abc123...",
        "relPath": "src/local-context/README.md",
        "headingPath": [],
        "preview": "A complete working example of the MahaRudra Agentic AI Infra framework...",
        "score": 0.9
      }
    ],
    "resultCount": 5,
    "runtimeMode": "local-stdio-mcp"
  }
}
```

## Upgrade path

| Profile | Change | Requirement |
|---|---|---|
| `local-context` | (this example) | Docker + `.env` with `DATABASE_URL` |
| `full-agentic-context` | Change `profiles: ["full-agentic-context"]` + add `LocalEmbeddingProvider` | Postgres + pgvector + Ollama/LocalAI |

All three profiles (vectorless-local, local-context, full-agentic-context) share the
same retrieval handler code — only the storage provider, embedding provider, and number
of retrieval providers change.

For `PostgresSessionManager` activation (cross-restart session continuity), inject a
`QueryableDatabase` adapter and pass it via `params.database` instead of
`connectionString`. See `scripts/verify-postgres.ts` for a complete working example.
