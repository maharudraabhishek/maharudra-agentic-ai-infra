# Local AI DB Schema And Migrations

## Concept

A database schema is the organized structure inside a database. It defines tables, columns, relationships, constraints, and types.

A migration is a versioned file that changes that structure in a repeatable way. Instead of manually clicking around in a database tool, the project keeps database structure changes in code.

The `schema_migrations` table is the database's memory. It records which migration versions have already run and the checksum of each migration file.

Safe MCP DB tools are narrow tools that do one reviewed database task at a time. They are different from a general SQL console.

## Mental Model

Think of the database schema as a set of labeled shelves.

The migration is the instruction sheet for building or changing shelves. The `schema_migrations` table is the checklist that says which instruction sheets have already been used.

```txt
001_create_local_ai_schema.sql
   |
   v
Create shelves for documents, chunks, embeddings, evals
   |
   v
schema_migrations records version 001
```

This diagram shows the basic loop: a reviewed file changes structure, then the database records that the change is complete.

## Why It Matters

RAG systems need more than a pile of text. They need traceable storage:

- documents show where content came from
- chunks preserve smaller retrieval units
- embeddings store vector representations later
- index runs explain what happened during indexing
- retrieval evals measure quality and regressions

Without a schema, the future RAG pipeline would become hard to debug. Without migrations, different local databases could silently drift into different shapes.

## Rudraloka Example

Milestone 1 creates the local-only `local_ai` schema in `rudraloka_local_ai`.

```txt
rudraloka_local_ai database
   |
   v
local_ai schema
   |-- schema_migrations
   |-- rag_index_runs
   |-- rag_documents
   |-- rag_chunks
   |-- rag_embeddings
   `-- rag_retrieval_evals
```

This diagram separates the local AI schema from the rest of the database. The name `local_ai` is a boundary marker: this area is for local developer AI infrastructure, not production Rudraloka data.

The first migration lives here:

```txt
infra/db/local-ai/migrations/001_create_local_ai_schema.sql
```

The MCP server exposes three fixed-purpose DB tools:

- `check_local_ai_db`
- `get_local_ai_migration_status`
- `run_local_ai_migrations`

## Safe MCP DB Tools

The safe tool flow is:

```txt
Codex
   |
   v
MCP fixed DB tool
   |
   v
Migration runner
   |
   v
Reviewed migration files
   |
   v
Postgres + pgvector
```

The important security idea is that Codex does not send arbitrary SQL. It asks for a named operation, and the server decides which fixed SQL or approved migration files are allowed.

## Why Arbitrary SQL Is Dangerous

An arbitrary SQL tool sounds convenient, but it creates a large blast radius.

Common risks:

- dropping or changing tables by mistake
- reading unexpected data
- bypassing approval gates
- logging raw query text or sensitive results
- making future production habits less safe

Rudraloka uses fixed tools instead. Health checks run fixed health queries. Status checks return migration metadata. Migration runs require exact approval text and only read files from the approved migration folder.

## Why Use A Dedicated `local_ai` Schema

A schema is like a namespace inside Postgres. Putting Milestone 1 tables under `local_ai` makes the boundary obvious.

Benefits:

- local AI tables are grouped together
- future cleanup is easier
- names like `rag_chunks` do not collide with app tables
- docs and tools can talk about one clear area

The tradeoff is a little more verbosity in SQL, such as `local_ai.rag_chunks`, but the clarity is worth it.

## Why No HNSW Yet

HNSW is the selected future vector index type, but Milestone 1 does not create it.

Reason:

- embedding dimensions are not finalized
- the mock embedding provider is not implemented yet
- local memory tuning has not been tested
- tiny local indexes may not need approximate vector indexes at first

The base schema uses pgvector's flexible `vector` type so later phases can choose dimensions deliberately.

## Why No Embeddings Or Indexing Yet

This milestone is foundation only.

It creates tables and safe management tools. It does not scan files, chunk content, generate embeddings, insert project knowledge, run vector search, build RAG context, or plan agentic context.

That separation matters because storage structure should be reviewable before the system starts reading and indexing project content.

## Tradeoffs

Direct SQL with `pg` is explicit and easy to audit for this phase. The tradeoff is that TypeScript cannot automatically type every query result the way an ORM might.

Flexible `vector` storage avoids choosing a provider dimension too early. The tradeoff is that future vector indexes will need a stable dimension and may require a reviewed migration.

Exact approval text makes migration runs slightly more manual. The benefit is that schema changes cannot be triggered accidentally by a status check.

## Common Mistakes

- Treating the local AI DB as production storage.
- Putting secrets, credentials, or customer data into RAG tables.
- Adding an arbitrary SQL MCP tool because it feels faster.
- Editing an already-applied migration and causing a checksum mismatch.
- Creating HNSW indexes before embedding dimensions and memory defaults are stable.
- Mixing schema foundation work with scanner, chunker, embedding, or retrieval implementation.
- Forgetting that Docker init SQL runs only on first volume creation.

## How It Connects To Existing Architecture

Milestone 1 sits under the selected Agentic Context Engineering architecture:

```txt
Agentic Context Engineering
   |
   v
Context-Engineered RAG
   |
   v
DB foundation and safe MCP DB tools
   |
   v
Future scanner, chunker, embeddings, hybrid retrieval, context builder, evals
```

This diagram shows the ordering. The database foundation is necessary, but it is not the whole RAG system.

## Related Docs

- [Local AI DB Migrations Runbook](../06-runbooks/local-ai-db-migrations.md)
- [Local pgvector Runtime Runbook](../06-runbooks/local-pgvector-runtime.md)
- [Local MCP AI Infra Plan](../04-ai-infra/local-mcp-ai-infra-plan.md)
- [Local MCP Agentic Context Engineering + RAG Design Spec](../04-ai-infra/local-mcp-agentic-context-rag-design-spec.md)
- [Local MCP Context Tools](../03-mcp/local-mcp-context-tools.md)
- [MCP Security Policy](../05-security/mcp-security-policy.md)
