# Agentic Context Engineering And RAG Design

## Concept

Naive RAG is not enough for a real codebase. It can retrieve text, but it does not automatically know which files are safe, which docs are current, which exact identifiers matter, or when an architecture decision should go back to the user.

Context engineering is the broader discipline of choosing the right information for the model. It includes retrieval, exact file reads, tool outputs, security policy, architecture decisions, eval results, and context budgeting.

Agentic context engineering adds a planner. The planner classifies the task, chooses a strategy, retrieves or reads only the needed context, and avoids unnecessary context.

In Rudraloka, Option C uses Option B underneath it:

- Option B is the retrieval foundation: indexing policy, scanner, chunker, embeddings, pgvector, hybrid retrieval, metadata filters, context builder, retrieval evals, and observability.
- Option C adds the planning layer: task classification, strategy selection, tool/retrieval planning, security-aware context selection, and future agentic orchestration.

## Mental Model

Think of naive RAG like asking a librarian to grab five random pages that seem related.

Modern context engineering is asking a librarian, a security guard, and a project architect to work together:

- The security guard says which shelves are allowed.
- The librarian finds relevant passages.
- The architect knows which documents matter for this kind of decision.
- The editor trims everything into a short packet the reader can actually use.

Agentic context engineering is the coordinator that decides which of those helpers to call for each task.

## Why It Matters

AI assistants are strongest when they see the right context and weakest when they see too much, too little, stale, or unsafe context.

Rudraloka has security rules, MCP tool boundaries, architecture decisions, learning notes, and TypeScript source. A naive "embed everything and search topK" approach can miss exact identifiers, retrieve archived docs too strongly, or accidentally create a second copy of sensitive data.

A planned context system matters because it:

- Keeps secrets out of the index.
- Retrieves source-grounded docs and code.
- Preserves architecture and security intent.
- Avoids stuffing the prompt with noisy chunks.
- Makes retrieval quality testable.
- Gives Codex and Claude better context without exposing local MCP publicly.

## Rudraloka Example

Suppose the user asks:

```txt
Add local pgvector indexing safely.
```

A naive RAG system might search for "pgvector indexing" and return only vector search notes.

An agentic context planner should include:

- `AGENTS.md` because it contains project-wide safety and documentation rules.
- `docs/05-security/mcp-security-policy.md` because indexing must not include secrets.
- `docs/03-mcp/local-mcp-architecture.md` because this is local MCP infrastructure.
- `docs/04-ai-infra/rag-embeddings-vector-search.md` because it explains the retrieval foundation.
- `mcp/rudraloka-dev-mcp/src/security/path-policy.ts` because future indexing should reuse path safety ideas.
- `mcp/rudraloka-dev-mcp/src/evals/mcp-security-evals.ts` because evals should guard the new behavior.

The important difference is that the planner understands the task is security-sensitive AI infrastructure, not only a database feature.

## Flow / Architecture Diagram

```txt
User task
   |
   v
Context Planner
   |-- classify task
   |-- choose retrieval strategy
   |-- include safety/architecture docs
   |-- decide if exact file reads are needed
   `-- ask user for decisions when needed
   |
   v
Retrieval Foundation
   |-- indexing policy
   |-- chunking
   |-- embeddings
   |-- pgvector
   |-- hybrid retrieval
   `-- evals
   |
   v
Context Builder
   |
   v
Codex / Claude response
```

This diagram shows Option C on top of Option B: the planner orchestrates the retrieval foundation, then the context builder returns a compact evidence packet.

```txt
Allowed docs/source
   |
   v
Safe scanner
   |
   v
Meaningful chunks
   |
   v
Embeddings
   |
   v
pgvector
   |
   v
Hybrid retrieval
   |
   v
Rerank / filter
   |
   v
Compact context
```

This is the retrieval pipeline underneath the planner. Each step has a safety or quality job.

## Final Decisions We Chose

These decisions define the implementation path for the local MCP context system. They do not implement the system yet. They make the next coding phase safer because future prompts can follow an approved design instead of inventing architecture while editing code.

### 1. Docker Compose for local pgvector

What it means: the local Postgres database with the `pgvector` extension will run through Docker Compose.

Why we chose it: Docker Compose gives Rudraloka a repeatable local database setup. The project does not depend on whichever Postgres version happens to be installed on one developer machine. It also builds useful Docker and future Kubernetes learning without making this a production deployment.

Tradeoff: Docker must be installed and running. A plain local Postgres install can feel lighter, but it is easier for two machines to drift apart.

Simple analogy: Docker Compose is like a labeled, portable workshop bench. The same tools are arranged the same way each time, instead of relying on whatever happens to be in the room.

How it affects implementation: the next phase is the local pgvector runtime design. It should define the Compose file location, service name, database name, port convention, volume behavior, and reset runbook before any database code is written.

```txt
rudraloka-dev-mcp
   |
   v
Docker Compose network
   |
   v
Postgres + pgvector
   |
   v
local knowledge index tables
```

The MCP server will eventually talk to the local database, but this docs phase does not add Compose files or database connections.

### 2. EmbeddingProvider interface with mock first

What it means: code will depend on an `EmbeddingProvider` abstraction, not directly on one hosted embedding API. The first implementation should use a mock provider.

Why we chose it: the user does not want paid provider usage now. A mock provider lets us test indexing, chunking, storage, search plumbing, and eval harness behavior without API keys, env files, or usage cost.

Tradeoff: mock embeddings are not semantically intelligent. They are useful for pipeline tests, but they cannot prove that real semantic search quality is good.

Simple analogy: a mock embedding provider is like using practice equipment before the real match. It helps test the field and the rules, but it does not behave exactly like game play.

How it affects implementation: retrieval evals must separate pipeline correctness from semantic quality. The first evals can check that allowed files are scanned, chunks are stored, forbidden sources are excluded, and searches return structurally valid results. Later evals can measure real retrieval quality after a real provider is approved.

```txt
Chunk text
   |
   v
EmbeddingProvider interface
   |-- MockEmbeddingProvider first
   |-- LocalEmbeddingProvider later
   `-- HostedEmbeddingProvider later
   |
   v
embedding vector
```

The interface protects the architecture from provider lock-in and keeps paid usage out of the first implementation.

### 3. HNSW with memory-aware local defaults

What it means: the vector index target is HNSW, but the local settings must be conservative and configurable.

Why we chose it: HNSW is usually strong for vector search because it can provide good query speed and recall. It is a good default target for a modern vector retrieval system.

Tradeoff: HNSW generally uses more memory than IVFFlat. If the local index is small, exact vector search may be acceptable at first. If memory usage becomes painful, the project can revisit IVFFlat or exact search for local development.

Simple analogy: HNSW is like building a rich network of shortcuts between related notes. Searching becomes faster, but the shortcut map takes space.

How it affects implementation: do not hardcode aggressive HNSW parameters. The implementation should document defaults, keep them modest, and leave room for tuning. Memory usage should be observable enough that the team can make a real follow-up decision.

### 4. Structure-aware chunking with fallback

What it means: Markdown should be chunked by headings, TypeScript should be chunked around symbols such as exports, functions, classes, and types, and plain fallback chunking should be used only when structure cannot be detected.

Why we chose it: good chunks preserve meaning. A heading section or function body usually carries a clearer idea than a random slice of text.

Tradeoff: structure-aware chunking takes more engineering than fixed-size splitting. It needs careful fallback behavior so unusual files do not break indexing.

Simple analogy: structure-aware chunking is like cutting a book by chapters and sections instead of chopping every 500 words with scissors.

How it affects implementation: the chunker should return metadata such as heading path, symbol name, chunk index, and chunking strategy. The fallback chunker should use moderate-size windows with overlap.

### 5. Exclude archive docs by default

What it means: `docs/99-archive/` should not be indexed in normal searches.

Why we chose it: archived docs can contain older decisions that are useful historically but misleading for current implementation. Current context should be clean by default.

Tradeoff: excluding archives can hide useful history unless the user explicitly asks for it.

Simple analogy: the archive is the basement file cabinet. It is valuable, but it should not be mixed into the active desk pile every morning.

How it affects implementation: scanner reports should count archive skips, and future search inputs can add an `includeArchived` option. Archived content can be searched explicitly later without polluting normal answers.

### 6. AST-based TypeScript parsing

What it means: TypeScript chunking should use the language structure, not regex alone.

Why we chose it: code retrieval works better when the system understands functions, classes, exports, and types. An AST gives the chunker a real map of the code.

Tradeoff: AST parsing adds implementation complexity and may require an additional parser decision. Some files may still fail to parse, so fallback text chunking remains necessary.

Simple analogy: using an AST is like reading the table of contents and section labels of code, not guessing from line breaks.

How it affects implementation: the design must choose an AST parser package later if needed, keep parsing failures safe, and record `symbolName` metadata for code chunks.

### 7. Direct SQL with `pg` first

What it means: the first database access layer should use direct SQL through the `pg` package rather than an ORM.

Why we chose it: pgvector and Postgres full-text search are easier to understand and tune when the SQL is visible. This also supports learning Postgres internals.

Tradeoff: direct SQL requires discipline around query organization and migrations. An ORM can make common CRUD easier, but vector and full-text workflows can become less transparent.

Simple analogy: direct SQL is learning to drive with a clear view of the road and engine gauges. An ORM can be comfortable, but it may hide details that matter for this subsystem.

How it affects implementation: schema, migrations, vector queries, full-text search queries, and hybrid scoring should be written explicitly. Prisma can be revisited if the schema grows and the vector workflow remains manageable.

### 8. Manual indexing first, optional watch mode later

What it means: the user should trigger indexing explicitly at first. Automatic file watching is a later optimization.

Why we chose it: manual indexing is predictable and easier to secure. It avoids surprise background scans and makes evals simpler.

Tradeoff: manual indexing can become stale if the user forgets to refresh after documentation or source changes.

Simple analogy: manual indexing is like pressing "refresh catalog" after reorganizing a library shelf. Watch mode is a librarian who updates the catalog continuously, which is convenient but more complex.

How it affects implementation: the first `index_project_knowledge` tool should be explicit and report what changed. Future optimized indexing can use file hashes, incremental updates, and either polling or a file watcher.

### 9. Heuristic reranking first

What it means: after retrieval, candidates should be reordered using transparent rules before considering a model reranker.

Why we chose it: heuristic reranking is free, explainable, and easy to debug. It can boost exact identifiers, current docs, security docs for risky tasks, and architecture docs for design tasks.

Tradeoff: heuristics are less flexible than model reranking. They can miss subtle relevance signals.

Simple analogy: heuristic reranking is a checklist a careful librarian follows before handing you sources: exact title match, current edition, relevant shelf, and safety notes first.

How it affects implementation: the first reranker should score source priority, exact keyword matches, archive penalty, security relevance, and identifier matches. A model reranker comes later only if it is very low cost and clearly useful.

### 10. Postgres full-text search alongside pgvector

What it means: retrieval should combine semantic vector search with Postgres full-text search.

Why we chose it: codebases contain many exact names that embeddings can blur. Terms like `run_mcp_security_evals`, `APPLY_PATCH`, `AGENTS.md`, and `RUDRALOKA_PROJECT_ROOT` need exact matching.

Tradeoff: hybrid retrieval needs merge logic and scoring rules. It is more work than vector-only search, but much better suited to documentation and code.

Simple analogy: vector search finds "things that mean something similar." Full-text search finds "the exact label on the box." A good local MCP context system needs both.

How it affects implementation: Postgres schema and indexes should support both pgvector and full-text search. The retriever should merge candidates, apply metadata filters, then run heuristic reranking before building context.

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
heuristic reranker
   |
   v
context builder
```

This hybrid path is the practical foundation beneath the agentic context planner.

## Key Building Blocks

Chunking means splitting files into meaningful pieces. For Markdown, headings are natural boundaries. For TypeScript, functions, classes, exports, and types are useful boundaries.

Embeddings are meaning fingerprints. They turn text into vectors so similar ideas can be found even when the words are different.

A vector DB stores embeddings and finds nearby vectors quickly. It is a search engine for meaning.

pgvector is a Postgres extension for storing and searching vectors. It lets a local Postgres database act as the vector store for local development.

Hybrid retrieval combines vector search with Postgres full-text search. Vector search finds meaning. Full-text search finds exact identifiers like `run_mcp_security_evals`, `APPLY_PATCH`, `AGENTS.md`, and `RUDRALOKA_PROJECT_ROOT`.

Reranking means taking an initial candidate set and ordering it again with a stronger relevance check. Rudraloka chose heuristic reranking first because it is transparent and free: source priority, exact identifier matches, security-doc boosts, and archive penalties can all be inspected without paying for a model reranker.

The context builder turns retrieved candidates into a compact final context. It deduplicates, groups by source, applies budget limits, adds source labels, and preserves warnings.

Retrieval evals test whether the system finds the expected sources and avoids forbidden ones.

## Local Dev MCP Vs Production Rudraloka AI

Local dev MCP context tools would help Codex and Claude work inside this repository. They can use local project docs, skills, safe source files, and MCP security policies.

Production Rudraloka customer AI is different. It would need business-safe APIs, authentication, user permissions, approved content pipelines, product claim grounding, price/inventory APIs, production observability, and explicit confirmation for checkout or payment.

The local MCP server must stay local. It should not become a public ChatGPT connector or production AI control plane.

## Tradeoffs

Agentic context engineering is more work than naive RAG.

Benefits:

- Safer indexing policy.
- Better exact identifier retrieval.
- Less prompt noise.
- More explainable source selection.
- Better eval coverage.
- Clear separation between local developer tooling and production AI.

Costs:

- More components to design and test.
- More metadata to maintain.
- More open decisions before implementation.
- More operational setup once pgvector is introduced.
- Planner mistakes need their own eval coverage.

## Common Mistakes

- Indexing everything because it is convenient.
- Treating `.mcp-local` as ordinary project data.
- Assuming embeddings replace keyword search.
- Forgetting that code identifiers often need exact matching.
- Chunking Markdown without preserving headings.
- Chunking TypeScript without preserving symbols.
- Letting archived docs outrank current docs.
- Logging full chunks, embeddings, prompts, or file contents.
- Treating local MCP RAG as production customer AI.
- Building tools before the security and eval plan is reviewed.

## Related Docs

- [Local MCP Agentic Context Engineering + RAG Design Spec](../04-ai-infra/local-mcp-agentic-context-rag-design-spec.md)
- [RAG, Embeddings, And Vector Search](../04-ai-infra/rag-embeddings-vector-search.md)
- [Local MCP AI Infra Plan](../04-ai-infra/local-mcp-ai-infra-plan.md)
- [Eval Harness Concepts](../04-ai-infra/eval-harness-concepts.md)
- [Local MCP Architecture](../03-mcp/local-mcp-architecture.md)
- [MCP Security Policy](../05-security/mcp-security-policy.md)
