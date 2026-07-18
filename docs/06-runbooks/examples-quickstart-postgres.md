# Running Postgres-backed examples

Step-by-step guide for running the `local-context` and `hybrid-rag` examples.
Both require a local Postgres instance with pgvector.

For the full Postgres setup reference (troubleshooting, migration details,
verify-postgres script), see `docs/06-runbooks/postgres-setup.md`.

---

## What you need

- Docker Desktop (Windows / Mac) or Docker Engine (Linux)
- Node.js >= 20
- pnpm

---

## Step 1 — Start the database

From the monorepo root:

```sh
docker compose up -d postgres
```

This starts `pgvector/pgvector:pg16` on host port 5433.
Data persists in the `agentic_postgres_data` Docker volume across restarts.

Wait for the container to be healthy:

```sh
docker compose ps
# STATUS column should show "healthy"
```

If STATUS shows "starting", wait 10–15 seconds and check again.

---

## Step 2 — Configure environment

Copy the example environment file:

```powershell
# Windows PowerShell
Copy-Item .env.example .env
```

```sh
# macOS / Linux
cp .env.example .env
```

The default values in `.env.example` match `docker-compose.yml` exactly.
If you changed port or credentials in the compose file, update `.env` to match.

The connection string used:

```
DATABASE_URL=postgresql://agentic_ai:agentic_ai_local_dev@localhost:5433/agentic_ai_local
```

---

## Step 3 — Set environment variables

### Windows PowerShell

```powershell
$env:DATABASE_URL = "postgresql://agentic_ai:agentic_ai_local_dev@localhost:5433/agentic_ai_local"
$env:RUN_AGENTIC_AI_INFRA_MIGRATIONS = "true"
```

### macOS / Linux

```sh
export DATABASE_URL="postgresql://agentic_ai:agentic_ai_local_dev@localhost:5433/agentic_ai_local"
export RUN_AGENTIC_AI_INFRA_MIGRATIONS="true"
```

`RUN_AGENTIC_AI_INFRA_MIGRATIONS=true` runs the four schema migrations on
startup. On first run: migrations 001–004 are applied. On subsequent runs:
all four are skipped (already applied).

---

## Step 4 — Run an example

### local-context example

```sh
pnpm --filter @maharudra/agentic-ai-infra-examples run start:local-context
```

Demonstrates: PostgreSQL full-text retrieval + sessions + trajectory.
Expected output includes: session_id, thread_id, retrieval results.

### hybrid-rag example

```sh
pnpm --filter @maharudra/agentic-ai-infra-examples run start:hybrid-rag
```

Demonstrates: hybrid retrieval (full-text + pgvector + PageIndex + symbol)
merged via ReciprocalRankFusion and reranked by HeuristicReranker.
Expected output includes: provider count, merger stats, top 3 results with
scores and source types.

---

## Step 5 — Verify (optional)

Run the full verification script to confirm all storage, retrieval, session,
and trajectory operations work end-to-end:

```powershell
# Windows PowerShell
$env:DATABASE_URL = "postgresql://agentic_ai:agentic_ai_local_dev@localhost:5433/agentic_ai_local"
pnpm verify:postgres
```

```sh
# macOS / Linux
DATABASE_URL="postgresql://agentic_ai:agentic_ai_local_dev@localhost:5433/agentic_ai_local" pnpm verify:postgres
```

Expected: all 11 steps pass with ✓. See `postgres-setup.md` for expected output.

---

## Stopping the database

```sh
docker compose down
```

This stops the container and keeps the volume (data survives).
To also remove the data volume:

```sh
docker compose down -v
```

---

## Common problems

### "DATABASE_URL is not set"

The startup guard in both examples checks for `DATABASE_URL` before connecting.
Set the env var as shown in Step 3 and retry.

### Container not healthy after 30 seconds

Inspect the container logs:

```sh
docker compose logs postgres
```

Common cause: port 5433 already in use by another process.
Fix: change host port in `docker-compose.yml` and update `DATABASE_URL`.

### Embedding dimension mismatch

Migration 003 has not been applied. Ensure
`RUN_AGENTIC_AI_INFRA_MIGRATIONS=true` is set and restart the example.

### More troubleshooting

See `docs/06-runbooks/postgres-setup.md` for the full troubleshooting section.
