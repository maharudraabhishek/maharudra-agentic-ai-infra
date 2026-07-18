# Local Postgres + pgvector Runtime

## What This Is

This folder contains the Phase 2 local database runtime for Rudraloka's future MCP Agentic Context Engineering + RAG subsystem.

It starts a local Postgres database with the `pgvector` extension enabled. Milestone 1 now adds the local AI schema migration and safe MCP DB tools. It still does not create embeddings, vector indexes, retrieval tools, or context planner behavior.

Mental model: Phase 2 built the empty library building. Milestone 1 adds the first shelves and a checked procedure for installing them. The books, catalog search, and librarian workflow come later.

```txt
Agentic Context Engineering
   |
   v
Context-Engineered RAG
   |
   v
Local Postgres + pgvector runtime
```

This diagram shows where the runtime fits. It is the storage foundation under the future retrieval system, not the whole RAG implementation.

## Why Docker Compose

Docker Compose gives the local AI infrastructure a repeatable runtime. Instead of requiring every developer machine to install and configure Postgres manually, the database runs in a known container with a named volume.

The chosen local runtime values are:

- Folder: `infra/local-dev/postgres-pgvector/`
- Service name: `rudraloka-local-pgvector`
- Container name: `rudraloka-local-pgvector`
- Volume name: `rudraloka-local-pgvector-data`
- Database: `rudraloka_local_ai`
- User: `rudraloka_local`
- Host port: `5433`
- Container port: `5432`

## What pgvector Is

Postgres is a relational database. pgvector is a Postgres extension that lets Postgres store and search embedding vectors.

In later phases, chunks of approved project knowledge will be embedded into vectors and stored in Postgres. pgvector will help find nearby vectors for semantic search.

## Why This Phase Has No Embeddings Or HNSW Index

This phase is deliberately small.

No embeddings are created yet because the project has not implemented the scanner, chunker, embedding provider interface, or mock provider.

No HNSW index is created yet because there are no embedding rows to index. HNSW is still the selected future vector index, but creating it belongs after chunks and embeddings exist.

This keeps Phase 2 low-cost and memory-conscious. A plain database container is much lighter than a full retrieval system with embedding generation and vector index build work.

## Local Credentials

The Compose file uses a local-only password:

```txt
rudraloka_local_dev_password
```

This is acceptable for this local dev runtime because it is not production, not shared infrastructure, and not an API key. It is written directly in Compose to avoid introducing `.env` files or secret handling before the project needs them.

Do not reuse this password in production or any shared environment.

## Start The Database

Run commands from this folder:

```powershell
cd infra/local-dev/postgres-pgvector
```

Start the container:

```powershell
docker compose up -d
```

The host connects on `localhost:5433`. Inside the container, Postgres listens on `5432`.

## View Status

Use status when you want to know whether the container is running and healthy:

```powershell
docker compose ps
```

Use logs when startup fails or the healthcheck stays unhealthy:

```powershell
docker compose logs -f
```

## Stop The Database

Stop the container while keeping the persistent database volume:

```powershell
docker compose down
```

This keeps `rudraloka-local-pgvector-data`, so local database state is preserved.

## Reset The Database

Resetting deletes the persistent volume and recreates the database from the init SQL on the next startup.

Use this only when you intentionally want to erase local database state:

```powershell
docker compose down -v
docker compose up -d
```

The init SQL files in `init/` run only when a fresh database volume is created.

## Connect With psql

If `psql` is installed on your machine, connect with:

```powershell
psql -h localhost -p 5433 -U rudraloka_local -d rudraloka_local_ai
```

Enter the local-only password when prompted:

```txt
rudraloka_local_dev_password
```

If `psql` is not installed locally, Docker can run it inside the container:

```powershell
docker compose exec rudraloka-local-pgvector psql -U rudraloka_local -d rudraloka_local_ai
```

## Future Phases

Milestone 1 now adds:

- Direct SQL schema and migrations for the local knowledge index.

Later phases will add:

- Scanner and indexing policy.
- Markdown and TypeScript chunking.
- `EmbeddingProvider` interface and `MockEmbeddingProvider`.
- pgvector insert/search and Postgres full-text search.
- Hybrid retrieval and heuristic reranking.
- Context planner and context builder.
- MCP context tools and RAG evals.

Those pieces are intentionally outside Phase 2.
