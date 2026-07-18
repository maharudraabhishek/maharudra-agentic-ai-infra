# Mock Embeddings And pgvector Storage

## Concept

An embedding provider turns text into a list of numbers called a vector. A vector database can store those vectors and later compare them.

Milestone 3 adds an `EmbeddingProvider` interface and a deterministic `MockEmbeddingProvider`. The mock provider creates 64-dimensional vectors without API keys, network calls, or paid services.

## Mental Model

Think of the mock provider like a training weight at the gym.

It has the same shape as the real thing the system will lift later, but it is not the real competition. It helps test the form: scanner, chunker, storage, migrations, idempotency, and evals.

## Why It Matters

Mock embeddings let Rudraloka validate the pipeline safely:

- no `.env` files
- no API keys
- no paid provider usage
- deterministic evals
- repeatable local indexing
- no semantic-quality claims yet

The important lesson is separation of concerns. The pipeline can be correct before retrieval quality is good.

## Rudraloka Example

Milestone 3 indexes approved project knowledge:

- `AGENTS.md`
- `CLAUDE.md`
- `.agents/skills/**/SKILL.md`
- `docs/**/*.md`
- `mcp/rudraloka-dev-mcp/src/**/*.ts`

It excludes archived docs by default and blocks secrets, generated folders, `.mcp-local`, dependencies, and unknown file types.

```txt
approved source
   |
   v
scan safely
   |
   v
chunk safely
   |
   v
mock embed
   |
   v
store in local_ai tables
```

This diagram shows the safe flow. Only approved content reaches the local AI DB index.

## EmbeddingProvider Interface

The interface keeps provider choice separate from indexing logic.

```txt
indexer
   |
   v
EmbeddingProvider
   |-- MockEmbeddingProvider now
   |-- real local provider later
   `-- hosted provider later, only after approval
```

This design prevents provider lock-in. A future real provider can have a different model, version, and dimension without rewriting the scanner or chunker.

## MockEmbeddingProvider

The mock provider is deterministic: the same text always produces the same vector.

It is useful for:

- checking vector dimensions
- testing DB inserts
- testing idempotent indexing
- making evals repeatable
- proving no paid provider path exists

It is not useful for:

- semantic search quality
- ranking relevance
- production retrieval decisions

## pgvector Storage

The local AI DB stores:

- documents in `rag_documents`
- chunks in `rag_chunks`
- embeddings in `rag_embeddings`
- index runs in `rag_index_runs`

The mock embedding column becomes `vector(64)` in migration `002`. This fixed shape lets pgvector build an HNSW index safely for the mock provider.

## HNSW Memory-Conscious Setup

HNSW is a vector index that can make nearest-neighbor search fast. It can also use more memory than simpler approaches.

Milestone 3 uses conservative local defaults:

- `m = 8`
- `ef_construction = 32`
- partial index for mock model/version only

```txt
rag_embeddings
   |
   v
partial HNSW index
   |
   v
mock vectors only
```

This diagram shows why the index is partial. It avoids mixing future real-provider embeddings with mock vectors.

## Idempotent Indexing

Idempotent means repeated runs should not create duplicate data.

Milestone 3 uses file hashes, content hashes, chunk hashes, index version, embedding model, and embedding version to decide what is already indexed.

```txt
same file + same chunks + same model/version
   |
   v
skip unchanged work
```

This keeps local indexing predictable and cheap.

## indexVersion

`indexVersion` names the exact indexing shape. For Milestone 3 it is tied to:

- mock model
- mock version
- mock dimension

A future real provider must use a separate version. That prevents accidental mixing of vectors with different meanings or dimensions.

## Tradeoffs

Mock-first is safer and cheaper, but it delays semantic search quality testing.

HNSW is fast for vector search, but it uses memory. Conservative local settings are safer while the index is small and experimental.

Direct SQL keeps pgvector behavior clear, but it requires careful parameterized queries and migrations.

## Common Mistakes

- Treating mock embeddings as semantic evidence.
- Mixing vectors from different providers or dimensions.
- Running migrations automatically from indexing tools.
- Returning full chunks or vectors in MCP tool output.
- Letting force reindex delete schema or source files.
- Adding paid provider SDKs before the user approves that phase.

## Related Docs

- [Local MCP Agentic Context Engineering + RAG Design Spec](../04-ai-infra/local-mcp-agentic-context-rag-design-spec.md)
- [RAG, Embeddings, And Vector Search](../04-ai-infra/rag-embeddings-vector-search.md)
- [Local Project Knowledge Indexing](../06-runbooks/local-project-knowledge-indexing.md)
- [MCP Security Policy](../05-security/mcp-security-policy.md)
