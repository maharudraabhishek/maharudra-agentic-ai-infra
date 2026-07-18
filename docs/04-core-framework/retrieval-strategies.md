# Retrieval Strategies

Retrieval strategy is a first-class framework concern.

## Capability Surface

- `full-text`: keyword and lexical search.
- `pgvector`: vector similarity search through Postgres and pgvector-compatible storage.
- `document-tree`: structure-aware navigation through headings and document hierarchy.
- `page-index`: page or section index optimized for document lookup.
- `symbol-code`: code-aware indexing for symbols, files, and module relationships.
- `graph`: relationship-based retrieval across documents, code, and concepts.
- `hybrid`: combined retrieval with ranking, reranking, and context budgeting.

## Design Principle

Retrieval should improve grounding while respecting the security model. It must not index secrets, private local state, generated output, or blocked files.

```txt
┌────────────┐
│ Task Query │
└─────┬──────┘
      ▼
┌───────────────────┐
│ Selected Strategy │
└─────┬─────────────┘
      ├── full-text ────────┐
      ├── pgvector ─────────┤
      ├── document-tree ────┤
      ├── page-index ───────┤
      ├── symbol-code ──────┤
      ├── graph ────────────┤
      └── hybrid ───────────┘
                             ▼
                   ┌──────────────────────┐
                   │ Bounded Safe Results │
                   └──────────────────────┘
```

---

## Hybrid RAG (`hybrid-rag` profile)

The `hybrid-rag` profile combines four providers, a multi-provider merger, a
heuristic reranker, and needle-in-haystack context placement to maximise
retrieval recall and LLM recall of the returned evidence.

### Full pipeline flow

Each component below is a separate stage with a typed interface contract.

```txt
  Query
    │
    ▼
  ┌──────────────────────────────────────────────────────────┐
  │ RetrievalRouter  (classifies query, selects providers)   │
  └──────────────────────────────┬───────────────────────────┘
                                 │ runs providers sequentially
        ┌────────────────────────┼────────────────────────┐
        ▼                        ▼                        ▼
  ┌───────────┐          ┌──────────────┐         ┌─────────────┐
  │FullText   │          │ PgVector     │         │ PageIndex + │
  │Provider   │          │ Provider     │         │ Symbol      │
  │(tsvector) │          │(cosine dist) │         │ Providers   │
  └─────┬─────┘          └──────┬───────┘         └──────┬──────┘
        │  ranked list          │  ranked list           │  ranked list
        └────────────┬──────────┘                        │
                     └──────────────────┬────────────────┘
                                        ▼
                          ┌─────────────────────────────┐
                          │ ReciprocalRankFusion         │
                          │ score = Σ 1/(k + rank)       │
                          │ k=60 (Cormack et al., 2009)  │
                          │ dedup by sourceId + preview  │
                          └──────────────┬──────────────┘
                                         │ merged list
                                         ▼
                          ┌─────────────────────────────┐
                          │ HeuristicReranker            │
                          │ + exactMatchBoost (0.3)      │
                          │ + recencyBoost (0.2)         │
                          │ + sourceTypePriority (0.3)   │
                          │ + headingDepthWeight (0.2)   │
                          └──────────────┬──────────────┘
                                         │ reranked list (max 12)
                                         ▼
                          ┌─────────────────────────────┐
                          │ ContextBuilder               │
                          │ Needle-in-haystack ordering  │
                          │ [highest, middle..., second] │
                          └──────────────┬──────────────┘
                                         │ context packet
                                         ▼
                                    Agent / Harness
```

### ReciprocalRankFusion explained

RRF answers the question: "which document was ranked highly by the most
providers, regardless of how each provider scales its scores?"

Instead of averaging raw scores — which fails when full-text scores are
integers (e.g. 3) and pgvector scores are cosine values (e.g. 0.91) —
RRF converts each provider's ranking to a contribution:
`contribution = 1 / (k + rank)`.

A document at rank 1 in any list contributes `1/61 ≈ 0.016`. A document
appearing at rank 1 in two different provider lists contributes `2/61 ≈ 0.033`,
which exceeds any single-list rank-1 contribution. This rewards cross-provider
agreement without requiring score normalization.

k=60 is the standard constant. Higher k dampens the advantage of rank-1 and
flattens the score distribution; lower k amplifies it. k=60 is empirically
validated to produce good merges across diverse provider types.

### HeuristicReranker scoring components

The reranker adds an adjustment to each result's RRF score. The adjustment has
four additive components, each multiplied by a configurable weight:

| Component | Weight | When it fires |
|---|---|---|
| `exactMatchBoost` | 0.3 | All query terms appear verbatim in the content |
| `recencyBoost` | 0.2 | `updatedAt` is within 7 days of now |
| `sourceTypePriority` | 0.3 | `sourceType` matches a priority table entry |
| `headingDepthWeight` | 0.2 | `headingPath` is present (shallower = higher) |

Source type priority (default): `agents-md` (1.0) > `docs` (0.8) > `code` (0.6) > `generated` (0.2).

Absent fields contribute 0. A result without `updatedAt`, `sourceType`, or
`headingPath` is not penalized — it simply does not receive those boosts.

### Source priority

Every `RetrievalResult` carries a `sourcePriority` field — a resolved value in
[0, 1] that captures how authoritative a source is relative to the profile.

**How it is resolved.** The `RetrievalRouter` stamps `sourcePriority` in Step 4
(after reranking, before returning results). The value is taken from the profile's
`sourcePriorityMap` keyed by `sourceType`. If the result already carries a
`sourcePriority` set by an earlier pipeline stage, that value is preserved.

**Default values** (`DEFAULT_SOURCE_PRIORITY_MAP`):

| Source type   | Priority |
|---------------|----------|
| `agents-md`   | 1.0      |
| `docs`        | 0.8      |
| `pdf`         | 0.75     |
| `code`        | 0.6      |
| `generated`   | 0.2      |

`"pdf"` at 0.75 is a reserved slot for Stage 17B PDF indexing — it is included
in the default map so PDF results are ranked correctly once PDF indexing ships,
without requiring any config change.

**Per-profile override.** Set `sourcePriorityMap` in `RetrievalRouterConfig` to
replace the default weights for a specific profile:

```typescript
router: {
  strategy: "hybrid",
  reranker: "heuristic",
  sourcePriorityMap: {
    "agents-md": 1.0,
    "docs":      0.9,   // higher weight for docs-heavy projects
    "code":      0.7,
    "generated": 0.1
  }
}
```

Source types absent from the map receive priority 0.

**Effect on reranking.** `HeuristicReranker` uses `result.sourcePriority` directly
when present. For results from older providers that do not carry the field, the
reranker falls back to its own `sourceTypePriority` table.

**Effect on context selection.** `ContextOptimizer.optimize()` pre-sorts results
by `sourcePriority DESC, score DESC` before the token-budget loop. This guarantees
that when the budget forces a choice between two chunks, the higher-priority source
is always admitted first — even when its raw retrieval score is lower.

### Needle-in-haystack context placement

LLMs recall information most reliably from the start and end of a context
window. Information in the middle is frequently lost even when it is present.

`ContextBuilder.build()` reorders the selected evidence chunks before placing
them in the context text. Given chunks sorted by score as A (highest), B
(second), C, D, E:

```txt
  Naive order:   A  B  C  D  E    (middle recall dead zone for B–D)
  Haystack fix:  A  C  D  E  B    (A at start, B at end — max recall)
```

This ensures the two most relevant chunks are at the positions where LLM
recall is strongest, without discarding any evidence.


## Context Dedup and Compression (Stage 23)

After retrieval and source-priority sorting, `ContextOptimizer` applies two
passes before the token-budget loop.

### Cosine dedup pass

Near-duplicate chunks are detected using cosine similarity between their
embedding vectors. The default threshold is **0.95** � only near-identical
chunks are dropped. When two results exceed this threshold, the lower-priority
result (lower `sourcePriority`, lower `score`) is dropped.

The optimizer resolves embeddings in priority order:

1. `result.embedding` � pre-computed by the retrieval provider (free)
2. `embeddingProvider.embedText(result.preview)` � lazy embed on demand
3. Text Jaccard overlap � fallback when no embeddings available

Configure via `config.context.dedup.threshold` in `agentic-ai-infra.config.ts`.

### Compression pass

When `config.context.compression.enabled = true`, low-signal sentences are
trimmed from each result's content before context assembly. A sentence is
low-signal when it has fewer than 6 words and contains no citation marker.
The compressor never removes more than 60% of a chunk's content.

Compression is **opt-in and disabled by default** to preserve exact
retrieved content.

### Pipeline order

```
sourcePriority DESC, score DESC sort   (Stage 22)
  -> cosine dedup pass                 (Stage 23)
  -> compression pass                  (Stage 23)
  -> token budget loop                 (Stage 22)
  -> needleInHaystackOrder()           (Stage 18)
```
