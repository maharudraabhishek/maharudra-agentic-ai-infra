# Hybrid Retrieval And Context Builder

## Concept

Hybrid retrieval means using two search styles together.

Vector search finds chunks that are numerically close to a query embedding. Full-text search finds exact words, identifiers, filenames, and tool names. A context builder then turns the best retrieval results into a compact packet of evidence.

For Rudraloka Milestone 4, the system uses:

- mock pgvector search
- Postgres full-text search
- metadata filters
- heuristic reranking
- bounded context output

It does not use real embeddings, a paid provider, a model reranker, a watch mode, or an agentic planner.

## Mental Model

Think of retrieval like finding books in a library.

Vector search is like asking a librarian for books about an idea. Full-text search is like searching the catalog for an exact title or phrase. Reranking is the librarian putting the most likely books on top. The context builder is the librarian copying only the few useful paragraphs, with labels showing where each paragraph came from.

## Why It Matters

Codebases need exact search. A model may understand the idea of "security evals," but the code often needs the exact name `run_mcp_security_evals`.

Hybrid retrieval helps because:

- exact tool names and filenames can be found with full-text search
- broad conceptual matches can still come from vector search
- source metadata can prioritize current docs, security policy, and architecture decisions
- context budgets prevent prompt flooding
- citations make the returned context traceable

## Rudraloka Example

Milestone 4 adds `search_project_knowledge`.

```txt
query: run_mcp_security_evals
   |
   v
mock query embedding       Postgres full-text query
   |                       |
   v                       v
pgvector candidates     exact identifier candidates
   \                       /
    v                     v
      merge + heuristic rerank
              |
              v
       bounded search results
```

This diagram shows why hybrid search is useful. Mock embeddings are not semantic, so full-text search and exact identifier boosts carry most of the quality for now.

Milestone 4 also adds `get_relevant_context`.

```txt
task string
   |
   v
search project knowledge
   |
   v
top ranked chunks
   |
   v
context builder
   |
   v
source-labeled excerpts
```

The context builder does not plan the task. It only builds a compact packet from retrieval results.

## Tradeoffs

Hybrid retrieval is stronger than vector-only search for a codebase, but it has more moving parts. There is a vector query, a full-text query, metadata filters, merge logic, and ranking rules.

The current mock embedding provider is free and deterministic, but not semantically meaningful. That means Milestone 4 evals should not expect true semantic retrieval. They should check exact names, source expectations, forbidden-source exclusion, and context-size limits.

Heuristic reranking is transparent and free. The downside is that it can miss nuanced relevance. A model reranker might be better later, but it would add provider cost, latency, and safety review.

## Common Mistakes

- Treating mock embeddings as proof of semantic quality.
- Returning whole chunks or vectors to the AI client.
- Letting retrieval tools read files directly when the DB is not ready.
- Forgetting to exclude archives by default.
- Accepting arbitrary path prefixes as filters.
- Adding `plan_project_context` before the retrieval foundation is stable.
- Running migrations or indexing automatically during implementation.

## How It Connects To The Current Architecture

Milestone 4 stays inside the local development MCP boundary.

```txt
Codex / Claude
   |
   v
rudraloka-dev-mcp over STDIO
   |
   v
safe retrieval tools
   |
   v
local_ai schema in local Postgres
```

This is not production customer RAG. It is local developer context for the Rudraloka workspace.

## Related Docs

- [Local MCP Agentic Context Engineering + RAG Design Spec](../04-ai-infra/local-mcp-agentic-context-rag-design-spec.md)
- [Local MCP Context Tools](../03-mcp/local-mcp-context-tools.md)
- [Local Project Knowledge Retrieval](../06-runbooks/local-project-knowledge-retrieval.md)
- [MCP Security Policy](../05-security/mcp-security-policy.md)
