# local-context example

A complete working example of the MahaRudra Agentic AI Infra framework using the `local-context` profile — Postgres-backed RAG with persistent chunk storage and session tracking.

## What this does

1. Resolves the `local-context` built-in profile — requires Postgres (Docker recommended).
2. Constructs `PostgresStorageProvider` from `DATABASE_URL` and auto-wires a `RetrievalRouter`.
3. Optionally runs framework migrations when `RUN_AGENTIC_AI_INFRA_MIGRATIONS` is set.
4. Indexes the `examples/` directory using `MockEmbeddingProvider` (SHA-256 vectors, no network).
5. Runs a `SingleAgentExecutor` planning pass to show session tracking.
6. Calls `agentic.retrieval.search` with query `"local-context postgres"` and shows live results.
7. Prints session_id, run_id, and retrieval results to stdout as JSON.
8. Calls `storageProvider.close()` to drain the Postgres pool cleanly.

## 1. Prerequisites

- Docker Desktop running.
- Start the local Postgres instance from the monorepo root:

  ```sh
  docker compose up -d postgres
  ```

- Copy the environment template and verify `DATABASE_URL`:

  ```sh
  cp .env.example .env
  ```

  The default `DATABASE_URL` in `.env.example` matches the `docker compose` port (5433).

## 2. How to run

```sh
# From the monorepo root (no build step needed — tsx runs the source directly)
pnpm --filter @maharudra/agentic-ai-infra-examples start:local-context
```

With migrations (required on first run against a fresh Postgres instance):

```sh
# Bash / Git Bash
RUN_AGENTIC_AI_INFRA_MIGRATIONS=true pnpm --filter @maharudra/agentic-ai-infra-examples start:local-context

# PowerShell
$env:RUN_AGENTIC_AI_INFRA_MIGRATIONS="true"; pnpm --filter @maharudra/agentic-ai-infra-examples start:local-context
```

## 3. Expected output

stderr (diagnostic):

```
[example] profile resolved: local-context
[example] tip: set RUN_AGENTIC_AI_INFRA_MIGRATIONS=true on first run to apply migrations.
[example] runtime ready: mode=local-stdio-mcp, tools=6
[example] indexing /path/to/examples ...
[example] index complete: N files indexed, M chunks, 0 file errors
[example] agent plan: selected=[agentic.retrieval.search], tokens=...
[example] stopped.
```

With `RUN_AGENTIC_AI_INFRA_MIGRATIONS=true` on first run:

```
[example] running migrations...
[example] migrations: 4 applied, 0 skipped
```

stdout (JSON — session_id and run_id prove session tracking is active):

```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "run_id": "run-a1b2c3d4e5f6",
  "search": {
    "status": "ok",
    "query": "local-context postgres",
    "results": [
      {
        "chunkId": "...",
        "relPath": "src/local-context/README.md",
        "headingPath": [],
        "preview": "A complete working example of the MahaRudra Agentic AI Infra framework...",
        "score": 0.9
      }
    ],
    "resultCount": 3,
    "runtimeMode": "local-stdio-mcp"
  }
}
```

`session_id` is the UUID passed to `SingleAgentExecutor` for this run. `run_id` is the
deterministic identifier derived from the task hash. On subsequent runs against the same
Postgres instance, indexed chunks persist — unchanged files are skipped by the freshness check.

## 4. Upgrade path

| Now | Upgrade to | Change |
|---|---|---|
| `MockEmbeddingProvider` | `LocalEmbeddingProvider` | Point to Ollama (`http://localhost:11434`) for real semantic vectors |
| `local-context` profile | `full-agentic-context` | All 6 retrieval providers including pgvector, page-index, and graph |
| Single agent | Multi-agent | Use `TokenEfficientMultiAgentExecutor` |

See `docs/04-core-framework/profiles-and-config.md` for the full profile decision guide.
