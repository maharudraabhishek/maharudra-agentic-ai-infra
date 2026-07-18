# Local pgvector Runtime

## Concept

A local pgvector runtime is a developer-only Postgres database that has the `pgvector` extension available.

Postgres is a database. It stores structured data in tables and lets applications query that data reliably.

pgvector is a Postgres extension. It adds a vector data type and vector search operations so Postgres can store embedding vectors later.

This Phase 2 setup creates only the empty local database runtime. It is not yet RAG. It does not scan files, chunk documents, generate embeddings, create vector indexes, or connect MCP tools to the database.

## Mental Model

Think of this phase as building an empty library building.

- Postgres is the building.
- pgvector is a special shelf type that can hold meaning coordinates later.
- The future schema is the catalog system.
- Future chunks are the books and pages.
- Future embeddings are the coordinates that help find related pages.
- Future RAG tools are the librarian workflow.

In Phase 2, we only prepare the building and confirm the special shelf type exists.

## Why It Matters

Agentic Context Engineering needs a safe place to store approved project knowledge before an assistant can retrieve it.

The final local architecture is:

```txt
Agentic Context Engineering
   |
   v
Context-Engineered RAG
   |
   v
Chunking + embeddings + pgvector + hybrid retrieval
   |
   v
Context builder + evals
```

This diagram shows that pgvector is only one layer. It is the local vector storage foundation, not the planner, not the scanner, not the chunker, and not the eval harness.

Starting with the database runtime matters because later phases need a place to store:

- Index runs.
- Approved documents.
- Chunks.
- Embeddings.
- Retrieval eval results.

## Rudraloka Example

Rudraloka's future local MCP context system may need to answer:

```txt
Which docs and source files explain safe MCP patch approvals?
```

Eventually, the system should retrieve approved chunks from docs and source files, combine semantic search with exact term search, and return compact source-labeled context to Codex or Claude.

Phase 2 does not do that yet. It only creates the local Postgres + pgvector runtime that future phases can build on.

```txt
Codex / Claude
   |
   v
rudraloka-dev-mcp
   |
   | future MCP DB connection
   v
localhost:5433
   |
   v
Postgres + pgvector
```

This diagram shows the future connection path. The current phase stops at the database container.

## Flow / Architecture Diagram

```txt
Phase 2
   |
   v
Docker Compose
   |
   v
Postgres container
   |
   v
Enable pgvector extension
   |
   v
Wait for future schema/migrations
```

This diagram shows the Phase 2 workflow. It starts the database and enables pgvector, then stops before RAG-specific tables or indexes.

## Why Docker Compose Is Used

Docker Compose gives the project a repeatable local runtime. Instead of asking every machine to install Postgres and pgvector manually, Compose describes the service in one file.

For Rudraloka, the approved values are:

- Folder: `infra/local-dev/postgres-pgvector/`
- Service/container: `rudraloka-local-pgvector`
- Database: `rudraloka_local_ai`
- User: `rudraloka_local`
- Host port: `5433`
- Persistent volume: `rudraloka-local-pgvector-data`

This also supports learning future Docker and Kubernetes concepts without making this a production deployment.

## Why This Is Not Yet RAG

RAG means Retrieval-Augmented Generation. It needs several pieces:

- An indexing policy.
- A scanner.
- A chunker.
- An embedding provider.
- A storage schema.
- Vector and keyword retrieval.
- A context builder.
- Evals.

Phase 2 has only the database runtime. It does not create the knowledge index schema or retrieval behavior.

```txt
Current Phase 2
   |
   | has
   v
Postgres + pgvector runtime

Future RAG
   |
   | adds
   v
schema + chunks + embeddings + retrieval + evals
```

This separation keeps the foundation understandable and avoids hiding multiple architecture changes inside one step.

## Why No Embeddings Yet

Embeddings turn text into number vectors. They are useful only after the project has:

- Approved files to index.
- Meaningful chunks.
- Metadata.
- A provider interface.
- A mock provider for cost-free tests.

The user does not want paid provider usage now. That means future embedding work should start with an `EmbeddingProvider` interface and `MockEmbeddingProvider`, not a hosted paid API.

## Why No HNSW Yet

HNSW is the selected future vector index type because it is strong for query speed and recall.

But HNSW indexes require vectors to index. Phase 2 has no chunks and no embeddings, so creating HNSW now would be premature.

There is also a memory reason. HNSW generally uses more memory than IVFFlat. Local defaults must be conservative and configurable. Waiting until the schema and embedding dimensions are known keeps the project memory-conscious.

## Memory And Cost Reasoning

This phase is low-cost because:

- It does not call any embedding provider.
- It does not create API keys.
- It does not generate embeddings.
- It does not build HNSW indexes.
- It does not run background indexing.

It is memory-conscious because it starts with only a database container and the pgvector extension. More memory-sensitive pieces come later, after design and eval coverage.

## Tradeoffs

Benefits:

- Reproducible local database runtime.
- Clear folder and service naming.
- No `.env` file or API keys.
- Persistent local state by default.
- Clean foundation for Milestone 1 schema/migrations.

Costs:

- Requires Docker to be installed and running.
- Uses a local port, so `5433` can conflict with another service.
- Persistent volumes can hide old state until manually reset.
- Local-only Compose credentials are not production secret handling.

## Common Mistakes

- Treating local Compose credentials as production-ready secrets.
- Adding `.env` files before the project needs secret management.
- Creating RAG tables during the runtime phase.
- Creating HNSW indexes before embeddings exist.
- Assuming pgvector alone is the full RAG system.
- Forgetting that init SQL runs only on first volume creation.
- Exposing a local development database publicly.
- Starting Docker automatically from automation when the user should choose when to run it.

## Related Docs

- [Local pgvector Runtime Runbook](../06-runbooks/local-pgvector-runtime.md)
- [Local Postgres + pgvector Runtime README](../../infra/local-dev/postgres-pgvector/README.md)
- [Local MCP Agentic Context Engineering + RAG Design Spec](../04-ai-infra/local-mcp-agentic-context-rag-design-spec.md)
- [Local MCP AI Infra Plan](../04-ai-infra/local-mcp-ai-infra-plan.md)
- [RAG, Embeddings, And Vector Search](../04-ai-infra/rag-embeddings-vector-search.md)
- [Architecture Decisions](../02-architecture/architecture-decisions.md)
