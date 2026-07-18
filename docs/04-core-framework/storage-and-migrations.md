# Storage And Migrations

The runtime package provides storage and migration helpers for the AI context database.

```txt
Runtime storage provider
├── Health check
├── Migration status
├── Retrieval storage
└── Cache/freshness metadata
```

## Migration Safety

Migration status discovery is read-only. Migration execution requires an explicit runner call with the exact approval text:

```txt
RUN_AGENTIC_AI_INFRA_MIGRATIONS
```

The framework does not run migrations from imports, runtime startup, CLI init, validation, or doctor checks.

## Startup dimension validation

`startLocalRuntime()` runs an embedding-dimension check after `storageProvider.healthCheck()` and before tool registration or MCP server creation.

When a `storageProvider` is passed in `RuntimeStartOptions`, the runtime duck-types for `assertEmbeddingDimension`. If the method is present, it is called with `MOCK_EMBEDDING_DIMENSION` (64). If the stored schema dimension does not match, startup exits immediately with a fatal `storage.pgvector-unavailable` error.

```txt
startLocalRuntime() sequence
─────────────────────────────────────────────────────────────
1. Resolve and validate config (DefaultConfigValidator)
2. Build RuntimeServiceContainer (tool registry, handlers, observability)
3. If storageProvider is present and has assertEmbeddingDimension:
     → call assertEmbeddingDimension(MOCK_EMBEDDING_DIMENSION)
     → if dimension mismatch: fatal error, runtime exits
     → if table absent (pre-migration): passes silently
4. Create LocalStdioMcpRuntimeAdapter and start MCP server
─────────────────────────────────────────────────────────────
```

**Why at startup:** A pgvector column with the wrong dimension silently accepts inserts but produces semantically meaningless retrieval results. Catching the mismatch before any tool is registered prevents silent data corruption.

**Why duck-typed:** Not all storage providers support embeddings. The check only fires for providers that carry `assertEmbeddingDimension` (e.g. `PostgresStorageProvider`). In-memory and custom providers that lack the method skip the check entirely.

**Fix if it fails:** Apply migration 003 before starting the runtime. Migration 003 alters the `agentic_embeddings` column to `vector(64)`, adds the HNSW index, and creates the `agentic_index_runs` table. Call `runMigrations()` with the exact approval text `RUN_AGENTIC_AI_INFRA_MIGRATIONS` before the first startup after a schema change.

## InMemoryStorageProvider

`InMemoryStorageProvider` is the runtime storage implementation for the `vectorless-local` profile. It requires no database, no Docker, and no migration run.

**What it stores:**
- Latest file hash per project-relative path (for freshness / freshness skip decisions).
- Indexed knowledge chunks per file path (for retrieval during the current process lifetime).

**What is lost on restart:**
- All file hashes and all indexed chunks are cleared when the process exits or when `close()` is called. The next startup re-indexes everything from scratch.

**When to use it:**
- CI environments without a Postgres service container.
- Developer machines where Docker is not available.
- Exploratory sessions where persistence across restarts is not needed.

**Upgrade path:**
Switch to `local-context` (or `full-agentic-context`) and run migrations 001–003 when you need persistence, larger corpora, or semantic (pgvector) retrieval.

```txt
  vectorless-local                    local-context
  ──────────────────────────          ──────────────────────────────
  InMemoryStorageProvider             PostgresStorageProvider
  No migration needed                 Migrations 001–003 required
  Data lost on restart                Persistent across restarts
  Full-text + doc-tree + symbol       Full-text + doc-tree + symbol
  No pgvector                         pgvector + HNSW index available
  No Docker                           Postgres + (optionally) Docker
```

**Auto-wiring:** `createRuntimeServiceContainer()` detects `storage.providers[0].type = "memory"` in the resolved profile config and creates an `InMemoryStorageProvider` automatically. No manual wiring is needed.

## Connection Pooling

`PostgresStorageProvider` uses `pg.Pool` for all Postgres connections. A single pool instance is created lazily on first use and shared across all operations (health checks, migrations, knowledge persistence).

### Default pool settings

| Option | Default | Why |
| --- | --- | --- |
| `min` | `2` | Keep two connections warm so the first query after idle does not pay connection setup latency. |
| `max` | `10` | Caps concurrent Postgres connections; prevents exhausting the server under burst load. |
| `idleTimeoutMillis` | `30 000` | Connections idle longer than 30 s are closed and removed from the pool. |
| `connectionTimeoutMillis` | `5 000` | A new connection attempt that takes longer than 5 s throws rather than blocking indefinitely. |

### Overriding pool settings

Pass `pool` in the constructor params to override any of the defaults. `connectionString` is always taken from the top-level param and is never overridden by `pool.connectionString`.

```typescript
const provider = new PostgresStorageProvider("my-store", {
  connectionString: process.env.DATABASE_URL,
  pool: { max: 20, idleTimeoutMillis: 60_000 }
});
```

Callers that pass only `{ connectionString }` continue to work unchanged — all pool defaults apply automatically.

### close() contract

`StorageProvider.close()` is a formal interface method. All implementations must satisfy it before process exit:

```txt
  close() contract
  ─────────────────────────────────────────────────────────────────
  InMemoryStorageProvider.close()
    → clears fileHashes and fileChunks Maps
    → idempotent: second call returns immediately, no double-clear

  PostgresStorageProvider.close()
    → calls pool.end() — drains all active connections and waits
    → idempotent: second call returns immediately, pool.end() not
      called twice (guarded by #closed flag)

  Both providers
    → called automatically by LocalStdioMcpRuntimeAdapter.stop()
    → must also be called if RuntimeHandle is not used (e.g. tests
      that construct providers directly)
  ─────────────────────────────────────────────────────────────────
```

**Why idempotent:** Generated entrypoints may call `handle.stop()` from multiple cleanup paths (SIGTERM, SIGINT, unhandled rejection). A second close() must not throw or corrupt state.

**Why formal interface:** Promoting close() from an informal method to a contract means TypeScript will fail at compile time if a custom provider does not implement it, catching missing cleanup before runtime.

## Migration History

| ID | Description | Status |
| --- | --- | --- |
| `001_agentic_context_foundation` | Sources, documents, chunks, freshness, cache, trace, audit | Applied on first Postgres run |
| `002_agentic_retrieval_surfaces` | Embeddings (vector(32)), doc-tree, page-index, symbols, graph, eval, token metrics | Applied on first Postgres run |
| `003_agentic_embedding_dimension_fix` | Drops old embeddings, alters `agentic_embeddings` to `vector(64)`, HNSW index, `agentic_index_runs` table | ⏳ Pending Postgres run |
| `004_agentic_session_thread_state` | `agentic_sessions`, `agentic_threads`, `agentic_tool_calls` for Layer 4 | ⏳ Pending Postgres run |

## Migration 004 — Session, Thread, and Tool-Call Tables

Migration 004 creates the Layer 4 (Session & Thread State) schema surface. Three tables are added in dependency order: sessions first, then threads (which reference sessions), then tool calls (which reference threads). All foreign keys use `ON DELETE CASCADE` so purging a session removes all associated rows atomically.

```txt
  agentic_sessions
  ──────────────────────────────────────────────────────────────
  session_id    TEXT PK
  project_id    TEXT NOT NULL        ← index: project_idx
  client        TEXT NOT NULL
  runtime_mode  TEXT NOT NULL
  status        TEXT NOT NULL DEFAULT 'active'  ← index: status_idx
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()  ← status_idx (DESC)
  metadata      JSONB NOT NULL DEFAULT '{}'
       │
       │ 1 : N   (ON DELETE CASCADE)
       ▼
  agentic_threads
  ──────────────────────────────────────────────────────────────
  thread_id      TEXT PK
  session_id     TEXT NOT NULL → agentic_sessions  ← index: session_idx
  user_goal      TEXT NOT NULL
  active_task    TEXT
  state_summary  TEXT
  status         TEXT NOT NULL DEFAULT 'open'
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
       │
       │ 1 : N   (ON DELETE CASCADE)
       ▼
  agentic_tool_calls
  ──────────────────────────────────────────────────────────────
  call_id        TEXT PK
  thread_id      TEXT NOT NULL → agentic_threads   ← index: thread_idx
  tool_name      TEXT NOT NULL
  input_hash     TEXT NOT NULL
  output_hash    TEXT
  status         TEXT NOT NULL DEFAULT 'pending'
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()  ← thread_idx (DESC)
  completed_at   TIMESTAMPTZ
  error_code     TEXT
  token_estimate INTEGER
```

**Why sessions and threads are separate:** A session spans a full client connection lifetime. A thread represents one user goal within that session. The 1-to-N relationship lets thread status be updated independently of the session, and lets the dashboard aggregate tool calls per thread or per session without JOIN confusion.

**Why CASCADE:** Purging a session (e.g. by a data-retention script) should atomically remove all threads and their call records. Without CASCADE, application-layer multi-step deletes would risk partial state on failure.

**Index choices:** `project_idx` covers the most common session query (all sessions for a project). `status_idx` is composite `(status, last_seen_at DESC)` so "active sessions sorted by recency" runs without a sort step. `session_idx` on threads and `thread_idx` on tool calls cover the natural traversal direction — from parent to children — used by context-build and dashboard timeline queries.

## Schema Surface

The schema (for Postgres-backed profiles) supports sources, documents, chunks, embedding metadata, vector storage where pgvector is enabled, full-text indexes, document tree nodes, page-index sections, symbol/code entries, graph nodes and edges, eval history, token metrics, cache metadata, freshness metadata, trace/audit metadata, and (migration 004) session/thread/tool-call tracking for Layer 4. In-memory storage holds only sources, chunks, and file-hash freshness metadata.
