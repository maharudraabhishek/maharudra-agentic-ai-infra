# Vectorless-Local Example Walkthrough

The `vectorless-local` example shows the complete MahaRudra Agentic AI Infra retrieval
pipeline running entirely in process memory — no database, no Docker, no network calls.

## Source location

```txt
examples/src/vectorless-local/index.ts
```

## How to run

```sh
pnpm --filter @maharudra/agentic-ai-infra-examples build
pnpm --filter @maharudra/agentic-ai-infra-examples start:vectorless
```

## What each step does

### Step 1 — Resolve the vectorless-local profile

```typescript
const resolver = new DefaultProfileResolver();
const configResult = resolver.resolve({
  project: { name: "vectorless-local-example", slug: "vectorless-local-example" },
  profiles: ["vectorless-local"]
});
```

`DefaultProfileResolver` merges the built-in `vectorless-local` profile on top of
`DEFAULT_PROJECT_CONFIG` and then applies the caller's project overrides. The result is
a fully-populated `ResolvedProjectConfig` with:

- `storage.providers[0].type = "memory"` → triggers InMemoryStorageProvider auto-wiring
- `retrieval.enabled = true` with three providers (full-text, document-tree, symbol-code)
- `agents.mode = "single-agent"` → compatible with SingleAgentExecutor
- `tokenEfficiency.tokenBudget` inherited from the framework baseline

### Step 2 — Create the runtime service container

```typescript
const containerResult = createRuntimeServiceContainer(resolvedConfig);
```

`createRuntimeServiceContainer` inspects the resolved profile config and auto-wires:

1. `InMemoryStorageProvider` — because `storage.providers[0].type === "memory"`.
2. `RetrievalRouter` — backed by `FullTextProvider`, `DocumentTreeProvider`, and
   `SymbolCodeProvider`, each wired to the same `InMemoryStorageProvider`.
3. `InMemorySessionManager` — because `storageProvider.db` is not present (no Postgres).
4. `PolicyEnforcingToolRegistry` — registers all 6 built-in tool contracts with
   registration-time policy enforcement.

No database connection, no network, no Docker.

```txt
  createRuntimeServiceContainer(resolvedConfig)
       │
       ├── detects storage type = "memory"
       │     └── new InMemoryStorageProvider("in-memory-store")
       │
       ├── detects retrieval.enabled + getChunks on storage
       │     └── new RetrievalRouter([FullTextProvider, DocumentTreeProvider, SymbolCodeProvider])
       │
       ├── detects storageProvider.db absent
       │     └── createSessionManager(null) → InMemorySessionManager
       │
       └── returns RuntimeServiceContainer { tools, handlers, retrievalRouter, storageProvider, sessionManager, ... }
```

### Step 3 — Index the examples/ directory

```typescript
const indexSummary = await indexProjectKnowledge({
  embeddingProvider: new MockEmbeddingProvider(),
  storageProvider: container.storageProvider,
  projectRoot: examplesRoot   // examples/ resolved from import.meta.url
});
```

The indexer:

1. Walks `examples/` recursively using `fs.readdir({ recursive: true })` (Node 20+).
2. Applies path policy via `isIndexablePath` — blocked directories (`node_modules`,
   `dist`, `.git`, `coverage`, etc.) are never read.
3. Chunks `.md` files by heading hierarchy and `.ts` files by exported symbol.
4. Calls `MockEmbeddingProvider.embedBatch` — SHA-256 deterministic 64-dim vectors,
   no API key, stable across runs.
5. Stores chunks + vectors in `InMemoryStorageProvider` via `storeKnowledgeChunks`.

The `KnowledgeIndexSummary` returned contains only aggregate counts:

```json
{
  "filesIndexed": 5,
  "chunksCreated": 12,
  "fileErrorCount": 0,
  "indexVersion": "agentic-ai-infra-mock-embedding:mock-embedding-v1:dim64"
}
```

### Step 4a — SingleAgentExecutor planning pass

```typescript
const executor = new SingleAgentExecutor({
  config: resolvedConfig,
  trajectoryRecorder: container.trajectoryRecorder,
  tokenRecorder: container.tokenRecorder,
  sessionManager: container.sessionManager
});
const agentResult = await executor.execute({ task: "Search ... vectorless-local usage" });
```

The executor performs a deterministic planning pass:

- Classifies the task into labels (architecture, implementation, etc.).
- Selects relevant tool ids from the registered tool list.
- Estimates token usage using the heuristic counter (4 chars/token).
- Opens a session + thread via `InMemorySessionManager` (no DB write).
- Returns `SingleAgentRunReport` with `selectedToolIds` and `tokenUsage`.

*Executor constructors now accept an options object instead of positional parameters.*

No LLM API calls. No network. No handlers invoked.

### Step 4b — Execute agentic.retrieval.search

```typescript
const searchResult = await Promise.resolve(
  searchHandler({ query: "example" }, {
    runtimeMode: "local-stdio-mcp",
    traceId: "...", runId: "...",
    tool: searchTool,
    startedAt: new Date().toISOString()
  })
);
```

The `agentic.retrieval.search` handler:

1. Validates the query string (non-empty).
2. Calls `retrievalRouter.retrieve({ query: "example", maxResults: 10 })`.
3. The router dispatches to `FullTextProvider`, `DocumentTreeProvider`, and
   `SymbolCodeProvider` in parallel.
4. Each provider calls `effectiveCorpus()` → `storage.getChunks()` → converts stored
   chunks to an `IndexedCorpus` via `chunksToCorpus()` → scores against the query.
5. Results are merged, deduplicated, and bounded (previews ≤ 300 chars, max 10 results).
6. Returns `{ status: "ok", query, results[], resultCount }`.

In MCP mode this same handler is called by `AgentHarness` for every STDIO tool call
received on the `StdioServerTransport`.

### Step 5 — Print JSON to stdout

```typescript
process.stdout.write(JSON.stringify(searchResult.value.output, null, 2) + "\n");
```

The JSON output is the raw tool output, safe for MCP client consumption. All diagnostic
lines went to stderr, keeping stdout clean for protocol framing.

### Step 6 — Stop cleanly

```typescript
await handle.stop();
// duck-type close for InMemoryStorageProvider
await maybeCloseable.close?.();
```

`handle.stop()` is the typed shutdown point. `InMemoryStorageProvider.close()` clears
both the `fileHashes` and `fileChunks` Maps so the process releases memory cleanly.

## Expected output

```txt
[example] profile resolved: vectorless-local
[example] runtime ready: mode=local-stdio-mcp, tools=6
[example] indexing /path/to/examples ...
[example] index complete: 5 files indexed, 12 chunks, 0 file errors
[example] agent plan: selected=[agentic.retrieval.search], tokens=150
[example] stopped.
```

stdout (JSON):

```json
{
  "status": "ok",
  "query": "example",
  "results": [
    {
      "chunkId": "abc123...",
      "relPath": "src/vectorless-local/README.md",
      "headingPath": [],
      "preview": "A complete working example of the MahaRudra Agentic AI Infra ...",
      "score": 0.85
    }
  ],
  "resultCount": 3,
  "runtimeMode": "local-stdio-mcp"
}
```

## Upgrade path

| Profile | Change | Requirement |
| --- | --- | --- |
| `vectorless-local` | (this example) | Node 20, nothing else |
| `local-context` | Change `profiles: ["local-context"]`; supply `PostgresStorageProvider` | Postgres + migrations 001–003 |
| `full-agentic-context` | Same as above + add `LocalEmbeddingProvider` | Postgres + pgvector + Ollama/LocalAI |

All three profiles share the same retrieval and tool handler code — only the storage
provider and embedding provider change.
