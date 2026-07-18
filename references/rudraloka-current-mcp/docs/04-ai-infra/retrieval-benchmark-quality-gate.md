# Retrieval Benchmark Quality Gate

## Purpose

The local project RAG evals now include a small fixed benchmark set.

The benchmark does not claim true semantic quality. Rudraloka still uses deterministic mock embeddings, so expectations should be driven by exact terms, Postgres full-text search, metadata filters, source priorities, and transparent heuristics.

```txt
fixed query
   |
   v
mock vector search + full-text search
   |
   v
metadata filters + heuristic reranking
   |
   v
expected source class check
```

This keeps retrieval quality measurable without approving real embedding providers or paid model rerankers.

## Benchmark Categories

The first benchmark set checks these source classes:

- MCP security policy
- patch approval workflow
- DB migration workflow
- `index_project_knowledge`
- `run_mcp_security_evals`
- architecture decisions, options, and tradeoffs
- Claude/Codex compatibility
- RAG, chunking, embedding, retrieval, and context concepts

Each case has:

- a fixed query
- an expected source class
- capped returned source diagnostics
- a recommended next check when the expected source is missed

## Metrics

`run_project_rag_evals` reports additive quality totals:

- expected source hits
- expected source misses
- forbidden source count
- context budget pass/fail
- planner totals
- benchmark pass/fail/skip totals
- DB-unavailable, schema-not-ready, and index-not-ready safe skip totals

DB-dependent benchmark checks may skip safely when the DB, retrieval schema, or completed mock index is unavailable. A safe skip is not a semantic regression.

## How To Interpret Failures

A benchmark failure usually means one of these changed:

- exact full-text terms no longer match
- a source was not indexed
- source type metadata changed
- reranking boosts changed
- context budget or result caps became too tight
- archive/default filters changed unexpectedly

Do not fix a benchmark miss by widening indexing to unsafe paths or returning larger raw chunks. First inspect the capped source paths and the recommended next check.

## What This Does Not Prove

The benchmark does not prove:

- real semantic retrieval quality
- production customer AI readiness
- hosted provider safety
- model reranker quality
- live product data correctness

Those require separate future decisions and eval design.

## Related Docs

- [Local MCP Agentic Context RAG Design Spec](local-mcp-agentic-context-rag-design-spec.md)
- [Local MCP AI Infra Plan](local-mcp-ai-infra-plan.md)
- [Prompt Injection Defense](../05-security/prompt-injection-defense.md)
- [Final Local MCP Quality Gate](../06-runbooks/final-local-mcp-quality-gate.md)
