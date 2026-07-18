# Retrieval Module

The retrieval module contains deterministic provider implementations and routing logic.

## Classes And Functions

- `FullTextProvider`: keyword search over indexed chunks.
- `DocumentTreeProvider`: heading-aware Markdown retrieval.
- `PageIndexProvider`: long-document section retrieval.
- `SymbolCodeProvider`: TypeScript-style symbol retrieval.
- `PgVectorProvider`: deterministic mock vector path for pgvector-compatible behavior.
- `GraphProvider`: relationship retrieval from imports and links.
- `RetrievalRouter`: query classification, provider ordering, dedupe, archive exclusion, and score metadata.
- `createDeterministicVector`: test/indexer helper for mock vectors.

## Provider Result Contract

Providers return bounded success or a typed recoverable failure. They do not return fake empty success when they are not configured, not indexed, storage is unavailable, or the input is unsupported.

## Call Flow

```txt
┌───────┐
│ Query │
└───┬───┘
    ▼
┌──────────────────────────┐
│ RetrievalRouter.classify │
└───┬──────────────────────┘
    ▼
┌────────────────────┐
│ Provider Execution │
└───┬────────────────┘
    ▼
┌────────────────────────────────────┐
│ Dedupe + Source Priority + Bounding│
└───┬────────────────────────────────┘
    ▼
┌────────────────────┐
│ Safe Results       │
└────────────────────┘
```
