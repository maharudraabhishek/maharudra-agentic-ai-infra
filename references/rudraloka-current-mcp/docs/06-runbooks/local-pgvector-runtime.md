# Local pgvector Runtime Runbook

## Purpose

This runbook explains how to operate the Phase 2 local Postgres + pgvector runtime for Rudraloka's future MCP Agentic Context Engineering + RAG subsystem.

The runtime lives at:

```txt
infra/local-dev/postgres-pgvector/
```

This phase created only the local database container. Milestone 1 now adds MCP database connection code, the local AI schema migration, and safe migration tools. It still does not add embeddings, HNSW indexes, retrieval tools, or context planner behavior.

```txt
rudraloka-dev-mcp
   |
   | later
   v
localhost:5433
   |
   v
Docker container
   |
   v
Postgres + pgvector
```

This diagram shows the intended future boundary. MCP will connect later, but Phase 2 only prepares the local database runtime.

## Runtime Details

- Compose folder: `infra/local-dev/postgres-pgvector/`
- Service name: `rudraloka-local-pgvector`
- Container name: `rudraloka-local-pgvector`
- Volume name: `rudraloka-local-pgvector-data`
- Database: `rudraloka_local_ai`
- User: `rudraloka_local`
- Host port: `5433`
- Container port: `5432`
- Local-only password: `rudraloka_local_dev_password`

The password is a local dev value only. It is not production secret handling and must not be reused outside this local runtime.

## Start

Start from the Compose folder so Docker can find `docker-compose.yml`:

```powershell
cd infra/local-dev/postgres-pgvector
```

Start the database:

```powershell
docker compose up -d
```

## Status

Check whether the container is running and whether the healthcheck has passed:

```powershell
docker compose ps
```

The healthcheck uses `pg_isready` for the configured database and user. Healthy means Postgres is accepting connections. It does not mean RAG schemas exist, because Phase 2 does not create them.

## Logs

Use logs when startup fails, the healthcheck stays unhealthy, or the init SQL does not appear to run:

```powershell
docker compose logs -f
```

## Stop

Stop the container and keep the persistent volume:

```powershell
docker compose down
```

Use this for normal shutdown. The database files remain in `rudraloka-local-pgvector-data`.

## Reset

Resetting removes the persistent database volume. This erases local database state.

```powershell
docker compose down -v
docker compose up -d
```

The init SQL files under `init/` run only when Postgres creates a fresh data directory. If you change init SQL after a volume already exists, reset with `docker compose down -v` before starting again.

## Connect With psql

If `psql` is installed locally:

```powershell
psql -h localhost -p 5433 -U rudraloka_local -d rudraloka_local_ai
```

Enter this local-only password when prompted:

```txt
rudraloka_local_dev_password
```

If local `psql` is not installed, use the container's `psql`:

```powershell
docker compose exec rudraloka-local-pgvector psql -U rudraloka_local -d rudraloka_local_ai
```

## Troubleshooting

### Docker is not running

Symptom: `docker compose up -d` cannot connect to the Docker engine.

Fix: start Docker Desktop, wait until Docker is ready, then run the command again from `infra/local-dev/postgres-pgvector/`.

### Port 5433 is already in use

Symptom: startup fails because the host port cannot be bound.

Fix: stop the other local service using port `5433`, or ask for a reviewed architecture update before changing the port. The approved Phase 2 port is `5433`.

### Container is unhealthy

Symptom: `docker compose ps` shows the container as unhealthy.

Fix: inspect logs:

```powershell
docker compose logs -f
```

Common causes include Docker startup delay, bad local volume state, or a previous failed initialization.

### Init SQL did not rerun

Symptom: changing files in `init/` does not change the existing database.

Reason: Postgres entrypoint init SQL runs only when a fresh data directory is created.

Fix: reset the volume only if you intentionally want to erase local state:

```powershell
docker compose down -v
docker compose up -d
```

## Security Notes

- No `.env` file is used for this local runtime.
- The Compose password is local-only and must not be reused in production.
- No API keys are involved.
- No paid embedding provider is involved.
- MCP DB connection code now exists only for Milestone 1 health checks and migrations.
- Do not expose this local database publicly.

## Memory And Cost Notes

This phase is intentionally low-cost and memory-conscious:

- No embedding provider runs.
- No embeddings are generated.
- No HNSW index is created.
- No vector search workload runs.
- Only the local database runtime is created.

HNSW remains the selected future vector index, but it should be created only after schema, chunks, embeddings, and local memory defaults are reviewed.

## Future Phases

Milestone 1 now adds:

- Direct SQL schema/migrations.

Future phases will add:

- Scanner and chunker.
- Mock embeddings.
- pgvector insert/search and Postgres full-text search.
- Hybrid retrieval.
- Context planner and context builder.
- MCP context tools.
- Retrieval and planner evals.
