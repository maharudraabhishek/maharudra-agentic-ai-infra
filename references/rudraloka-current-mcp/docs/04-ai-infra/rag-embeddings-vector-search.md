# RAG, Embeddings, And Vector Search

## Embeddings

An embedding is a list of numbers that represents meaning.

Analogy: if words were places on a map, embeddings are coordinates. Similar meanings land near each other.

Example: "red silk saree" and "crimson silk sari" should be close even though the words are not identical.

For local MCP, Rudraloka uses an `EmbeddingProvider` interface with a mock provider first. The mock provider lets us test scanning, chunking, schema, pgvector inserts, indexing status, and eval shape without API keys or paid usage.

Mock embeddings are useful for pipeline tests, but they are not proof of semantic retrieval quality. The Milestone 3 mock model is `rudraloka-mock-embedding`, version `mock-embedding-v1`, with 64 dimensions. Later semantic-quality evals need a real local or hosted provider after the user approves that step, and that future provider must use its own version and migration path if dimensions differ.

## Chunking

Chunking means breaking a large document into smaller pieces.

Analogy: instead of giving someone an entire book, you mark the most relevant pages.

Good chunks preserve meaning. For markdown, headings are useful boundaries. For code, functions, classes, and exports are useful boundaries.

For TypeScript, Rudraloka will use AST-based parsing. AST parsing treats code as syntax structure instead of plain text, so it can find exports, functions, classes, and types more reliably than regex.

```txt
TypeScript source
   |
   v
AST parser
   |
   |-- exports
   |-- functions
   |-- classes
   `-- types
   |
   v
code-aware chunks
```

This diagram shows why AST-based chunking helps code retrieval: chunks can line up with actual code symbols.

## Vector Database

A vector database stores embeddings and finds nearby vectors quickly.

Analogy: it is a search engine for meaning, not exact words.

Rudraloka's local target is Postgres + pgvector running through Docker Compose. pgvector is important, but it is only one component. The full architecture also needs safe indexing, chunking, metadata, full-text search, hybrid retrieval, context planning, context building, evals, and observability.

HNSW is the chosen vector index because it has strong query speed and recall behavior. HNSW can use more memory than IVFFlat, so local defaults must be conservative and configurable. Milestone 3 adds a partial mock-specific HNSW index with `m = 8` and `ef_construction = 32`; these are local-dev defaults, not production tuning.

```txt
mock chunk text
   |
   v
64-d deterministic mock vector
   |
   v
partial HNSW index for mock model/version only
```

This diagram shows the Milestone 3 storage step. It proves the pipeline can store vectors, but it does not prove semantic search quality.

## RAG Flow

RAG means Retrieval-Augmented Generation.

Basic flow:

1. User asks a question.
2. System retrieves relevant chunks.
3. Retrieved chunks are placed in model context.
4. Model answers using that context.
5. System cites sources or explains uncertainty.

In the local MCP design, RAG is the retrieval foundation. It is not the whole context system.

```txt
Approved files
   |
   v
Chunking
   |
   v
Embeddings + metadata
   |
   v
Vector / keyword retrieval
   |
   v
Context builder
```

This diagram shows the retrieval layer. A separate planner decides whether this retrieval layer is needed for a given task.

## Context Engineering

Context engineering is the broader practice of deciding what the model should see. It can include retrieved chunks, exact file reads, tool results, security rules, architecture decisions, eval reports, and user-provided context.

Agentic context engineering adds a planner:

```txt
Task
   |
   v
Planner
   |-- use RAG for stable project knowledge
   |-- use tools for live state
   |-- include policy docs for risky work
   `-- ask for decisions when required
   |
   v
Final context
```

The planner keeps RAG from becoming blind prompt stuffing.

## Why Context Engineering Over Naive RAG

Naive RAG often means "embed chunks, search topK, stuff the prompt." That is not enough for Rudraloka because the assistant needs to know which sources are safe, current, and relevant to the task.

Context engineering treats retrieval as one part of a broader context plan:

```txt
User task
   |
   v
Context planner
   |-- safe retrieval
   |-- exact file reads
   |-- security docs
   |-- architecture docs
   `-- eval/log summaries
   |
   v
Useful compact context
```

This diagram shows the key idea: the planner chooses evidence instead of blindly stuffing search results.

## Hybrid Retrieval

Hybrid retrieval combines pgvector semantic search with Postgres full-text search.

Vector search handles meaning. Full-text search handles exact identifiers and code terms such as `run_mcp_security_evals`, `APPLY_PATCH`, `AGENTS.md`, and `RUDRALOKA_PROJECT_ROOT`.

```txt
Query
   |
   v
pgvector semantic search
   +
Postgres full-text search
   |
   v
merge candidates
   |
   v
heuristic reranking
   |
   v
context builder
```

This is the approved retrieval path. Heuristic reranking comes first because it is transparent and free.

## Retrieval vs Generation

Retrieval finds relevant source material.

Generation writes the answer.

The two should not be blurred. If retrieval is weak, the generated answer should say it lacks enough grounded context.

## Context Window Management

The context window is limited. You cannot send every document every time.

Context management decides what to include:

- User request.
- Relevant retrieved chunks.
- Important policy.
- Recent decisions.
- Tool results.

Bad context management creates noisy answers. Good context management gives the model only what helps.

## Local MCP vs Production Rudraloka

Local MCP RAG would help Codex search the repository and approved project docs.

Production RAG would help users or business workflows. It needs stronger access control, freshness, approved content, user-level permissions, and observability.

Do not use the local MCP server as the production AI control plane.

## Related Docs

- [Local MCP Agentic Context Engineering + RAG Design Spec](local-mcp-agentic-context-rag-design-spec.md)
- [Agentic Context Engineering And RAG Design](../01-learning-journal/2026-05-09-agentic-context-rag-design.md)
