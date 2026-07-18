# Postgres Setup Runbook

Local Postgres setup for MahaRudra Agentic AI Infra using Docker Desktop and the
`pgvector/pgvector:pg16` image. Covers migration, verification, and troubleshooting.

---

## Prerequisites

- Docker Desktop for Windows (or Mac/Linux Docker Engine)
- pnpm (workspace manager)
- Node.js >= 20

---

## Step 1 — Start Postgres

```powershell
docker compose up -d postgres
```

Starts the `postgres` service defined in `docker-compose.yml`. The image
(`pgvector/pgvector:pg16`) ships with pgvector pre-installed. Data persists in
the named volume `agentic_postgres_data` across restarts.

Wait for the container to be healthy before continuing:

```powershell
docker compose ps
# STATUS should show "healthy"
```

---

## Step 2 — Configure Environment

Copy the example env file and set your environment:

```powershell
# Windows PowerShell
Copy-Item .env.example .env
```

Default values in `.env.example` match `docker-compose.yml` exactly. If you
changed port or credentials in the compose file, update `.env` to match.

**PowerShell — export for the current session:**

```powershell
$env:DATABASE_URL = "postgresql://agentic_ai:agentic_ai_local_dev@localhost:5433/agentic_ai_local"
$env:RUN_AGENTIC_AI_INFRA_MIGRATIONS = "true"
```

---

## Step 3 — Apply Migrations on Startup

Set `RUN_AGENTIC_AI_INFRA_MIGRATIONS=true` before starting the runtime:

```powershell
# PowerShell (set env var then start)
$env:RUN_AGENTIC_AI_INFRA_MIGRATIONS = "true"
pnpm.cmd --filter @maharudra/agentic-ai-infra-examples run start:vectorless
```

Or for generated projects:

```powershell
$env:RUN_AGENTIC_AI_INFRA_MIGRATIONS = "true"
node tools/agentic/mcp-server/dist/start.js
```

The `startLocalRuntime()` function will detect the env var, call
`storageProvider.runMigrations("RUN_AGENTIC_AI_INFRA_MIGRATIONS")`, and log
each applied / skipped migration before the server accepts connections.

If `RUN_AGENTIC_AI_INFRA_MIGRATIONS` is not set and a Postgres provider is
detected, the runtime emits a `console.warn` and continues without migrating.

---

## Step 4 — Verify with verify-postgres

Run the standalone verification script to confirm all 12 steps work end-to-end:

```powershell
$env:DATABASE_URL = "postgresql://agentic_ai:agentic_ai_local_dev@localhost:5433/agentic_ai_local"
pnpm.cmd verify:postgres
```

### Expected output from `verify-postgres`

```txt
[verify-postgres] ✓ Step 2:  PostgresStorageProvider constructed with injected pool.
[verify-postgres]   applied: 001_agentic_context_foundation
[verify-postgres]   applied: 002_agentic_retrieval_surfaces
[verify-postgres]   applied: 003_agentic_embedding_dimension_fix
[verify-postgres]   applied: 004_agentic_session_thread_state
[verify-postgres] ✓ Step 3:  Migrations complete (applied: 4, skipped: 0).
[verify-postgres] ✓ Step 4:  Indexed 1 file(s), N chunk(s), N embedding(s).
[verify-postgres] ✓ Step 5:  getChunks() returned N chunk(s).
[verify-postgres] ✓ Step 6:  RetrievalRouter returned N result(s) for query "test".
[verify-postgres] ✓ Step 7:  Session created. session_id: <uuid>
[verify-postgres] ✓ Step 8:  Thread opened. thread_id: <uuid>
[verify-postgres] ✓ Step 9:  Tool call recorded. call_id: <uuid>
[verify-postgres] ✓ Step 10: Session closed. status: closed
[verify-postgres] ✓ Step 11: StorageProvider closed. Pool drained.

verify-postgres: all checks passed
```

On subsequent runs, Step 3 will show `skipped: 4` (all migrations already applied).

---

## Troubleshooting

### pgvector not found / `extension "vector" does not exist`

The `pgvector/pgvector:pg16` image ships with pgvector. If you are using a plain
`postgres:16` image, replace it in `docker-compose.yml` with
`pgvector/pgvector:pg16` and recreate the container:

```powershell
docker compose down
docker compose up -d postgres
```

### Embedding dimension mismatch

The runtime calls `assertEmbeddingDimension(64)` on startup. If you see:

```
Embedding dimension mismatch: schema has vector(32) but configured dimension is 64.
```

Migration 003 has not been applied. Set `RUN_AGENTIC_AI_INFRA_MIGRATIONS=true`
and restart, or run `pnpm verify:postgres` with DATABASE_URL set.

### Port conflict (5433 already in use)

Change the host port in `docker-compose.yml`:

```yaml
ports:
  - "5434:5432"   # use 5434 instead
```

Then update `DATABASE_URL` to use `localhost:5434`.

### `connection refused` / container not ready

Wait for the healthcheck to pass:

```powershell
docker compose ps   # check STATUS = healthy
```

If the container is unhealthy, inspect logs:

```powershell
docker compose logs postgres
```

### `RUN_AGENTIC_AI_INFRA_MIGRATIONS` warning but no migration

The env var must be a non-empty string. In PowerShell:

```powershell
$env:RUN_AGENTIC_AI_INFRA_MIGRATIONS = "true"
# NOT: $env:RUN_AGENTIC_AI_INFRA_MIGRATIONS = $true  (boolean — won't match)
```
