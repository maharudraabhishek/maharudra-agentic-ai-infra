# Final Local MCP AI Hardening

## Concept

Final local MCP AI hardening means making the existing local RAG, context, planner, eval, and observability layers easier to trust without expanding the product surface.

The important move is not "add more AI." The important move is "make the local AI development platform observable, bounded, deterministic, and recoverable."

## Mental Model

Think of the local MCP AI stack like a workshop reference shelf.

The shelf is useful only if you know which books are on it, when they were refreshed, how a search found a page, and whether the notes are safe to share. Hardening adds labels, checklists, and inspection windows. It does not add a public storefront or an automatic machine that edits the workshop.

## Why It Matters

Local AI infrastructure can quietly become risky when it stores too much, logs too much, or hides failures behind vague summaries. The hardening layer keeps the platform useful while preserving the same safety boundary:

- only approved project knowledge is indexed
- mock embeddings remain local and deterministic
- retrieval returns bounded previews and context
- planner output is advisory only
- evals explain misses and skips
- summaries expose metadata, not raw content

## Rudraloka Example

Before hardening, a retrieval eval could say that a case failed. After hardening, it can safely say which expected source class was missed, which capped source paths came back, whether a DB-dependent check skipped, and what to inspect next.

It still must not print the full chunk body, vector, raw query, raw task, SQL contents, command output, approval text, or secrets.

## Eval Loop Diagram

```txt
eval case
   |
   v
retrieval / context / planner behavior
   |
   v
bounded assertion
   |
   v
quality report
   |
   v
next safe check
```

The eval loop turns failures into actionable metadata. It avoids dumping raw project content just to explain a miss.

## Observability Flow Diagram

```txt
tool call traceId
   |
   |-- scan/index span -> counts + status + duration
   |-- retrieval span  -> hashes + candidate counts
   |-- planner span    -> task type + recommendation counts
   `-- eval span       -> totals + failed case names
          |
          v
safe log/audit summaries
```

Trace IDs tie one tool call together. Child span IDs identify internal phases. The logs keep hashes, counts, durations, statuses, and error codes, not raw input or content.

## Index Maintenance Flow Diagram

```txt
scanned file metadata
   |
   v
pre-chunk unchanged check
   |        \
   | match   \ uncertain
   v          v
skip safely   chunk + existing idempotent checks
```

The pre-skip exists to avoid repeated work. It only skips when all correctness metadata matches. If anything is missing or unclear, the indexer falls back to the older safe path.

## Local Vs Production Boundary

```txt
local dev MCP AI
   |-- mock embeddings
   |-- local pgvector
   |-- approved project docs/source
   |-- advisory planner
   `-- bounded eval diagnostics

production customer AI
   |-- separate design
   |-- separate server boundary
   |-- approved providers
   |-- business data policies
   `-- user/product safety review
```

The final hardening milestone completes the local developer platform. It does not approve production customer AI or paid provider usage.

## Tradeoffs

Hardening adds code and documentation, but it reduces future debugging cost. The eval and observability outputs become more useful without widening the MCP public surface.

Incremental indexing by hash saves local time, but only when metadata is complete. That conservative rule avoids subtle stale-index bugs.

Keeping HNSW work to documentation/reporting avoids risky migration churn, but defers runtime tuning until there is a separate tuning decision.

## Common Mistakes

- Logging raw queries or tasks because they seem harmless.
- Treating DB-offline eval skips as failures.
- Skipping indexing when only some metadata matches.
- Adding a new diagnostic MCP tool when an existing bounded report can carry the information.
- Letting the planner execute the plan it recommends.
- Editing migrations to "update" HNSW settings after they have already been applied.

## Related Docs

- [Local MCP AI Infrastructure Operations](../06-runbooks/local-mcp-ai-infra-operations.md)
- [Local MCP AI Security Checklist](../05-security/local-mcp-ai-security-checklist.md)
- [Local MCP Agentic Context Engineering + RAG Design Spec](../04-ai-infra/local-mcp-agentic-context-rag-design-spec.md)
- [Local MCP AI Infra Plan](../04-ai-infra/local-mcp-ai-infra-plan.md)
- [Local Project Knowledge Retrieval](../06-runbooks/local-project-knowledge-retrieval.md)
