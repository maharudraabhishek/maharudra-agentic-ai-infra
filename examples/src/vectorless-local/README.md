# vectorless-local example

A complete working example of the MahaRudra Agentic AI Infra framework using the `vectorless-local` profile.

## What this does

1. Resolves the `vectorless-local` built-in profile — no Postgres or Docker required.
2. Auto-wires `InMemoryStorageProvider` and a `RetrievalRouter` from the profile config.
3. Indexes the `examples/` directory using `MockEmbeddingProvider` (SHA-256 vectors, no network).
4. Runs a `SingleAgentExecutor` planning pass to show agent tool selection.
5. Calls `agentic.retrieval.search` with query `"example"` and shows live retrieval results.
6. Prints the search result to stdout as JSON.

## Prerequisites

- Node 20 or later.
- No external services — `pnpm install` is the only setup required.

## How to run

```sh
# From the monorepo root
pnpm --filter @maharudra/agentic-ai-infra-examples build
pnpm --filter @maharudra/agentic-ai-infra-examples start:vectorless
```

## Expected output

stderr (diagnostic):

```
[example] profile resolved: vectorless-local
[example] runtime ready: mode=local-stdio-mcp, tools=6
[example] indexing /path/to/examples ...
[example] index complete: N files indexed, M chunks, 0 file errors
[example] agent plan: selected=[...], tokens=...
[example] stopped.
```

stdout (JSON result):

```json
{
  "status": "ok",
  "query": "example",
  "results": [
    {
      "chunkId": "...",
      "relPath": "src/vectorless-local/README.md",
      "headingPath": [],
      "preview": "A complete working example ...",
      "score": 0.8
    }
  ],
  "resultCount": 3,
  "runtimeMode": "local-stdio-mcp"
}
```

## What gets indexed

The indexer scans `.md` and `.ts` files in `examples/` excluding blocked directories (`node_modules`, `dist`, `.git`, `coverage`, etc.). This example indexes itself.

## Next step: swap to persistence

Change `"vectorless-local"` to `"local-context"` in the `profiles` array and supply a `PostgresStorageProvider`. Run migrations 001–003 before the first startup. All other code stays the same.

See `docs/04-core-framework/profiles-and-config.md` for the full profile decision guide.
