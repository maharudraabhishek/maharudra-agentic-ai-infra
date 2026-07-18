# Retrieval Providers

Retrieval providers implement focused ways to find project knowledge.

```txt
┌───────┐
│ Query │
└───┬───┘
    ▼
┌──────────┐
│ Provider │
└────┬─────┘
     ├── Bounded success
     ├── Not configured
     ├── Not indexed
     ├── Storage unavailable
     └── Unsupported input
```

## Provider Types

- `full-text`: lexical search over indexed chunks.
- `pgvector`: pgvector-ready retrieval when embeddings exist.
- `document-tree`: heading and structure navigation for Markdown and structured docs.
- `page-index`: section/page-like navigation for long documents.
- `symbol-code`: TypeScript-oriented symbol extraction.
- `graph`: relationships from imports, links, sources, and tool references.

Providers do not return fake empty success when they did not run. Pgvector-compatible mock embeddings are deterministic and useful for exercising the vector path, but they do not prove semantic retrieval quality.

---

## Embedding Providers

Embedding providers convert text into fixed-dimension float vectors. The
`PgVectorProvider` uses an `EmbeddingProvider` to compute the query vector
for cosine-similarity search. Without a configured provider it falls back to
deterministic mock vectors and emits a `retrieval.mock-embedding` warning.

### Interface: `EmbeddingProvider`

```txt
EmbeddingProvider
  ├── model: string        — model name included in every result
  ├── version: string      — version string; change = stale index signal
  ├── dimension: number    — output vector length
  ├── embedText(text)      → Promise<EmbeddingResult>
  └── embedBatch(inputs)   → Promise<EmbeddingResult[]>
```

Every result carries full provenance (model, version, dimension) so callers
can detect model changes between index runs without querying the provider.

### EmbeddingResult provenance

```txt
EmbeddingResult
  ├── id?         — echoed from EmbeddingInput.id for batch correlation
  ├── embedding   — unit-normalised float vector (length == dimension)
  ├── model       — "nomic-embed-text" | "agentic-ai-infra-mock-embedding" | ...
  ├── version     — provider-assigned version string
  └── dimension   — 64 | 384 | 768 | 1024 | ...
```

If a stored chunk's provenance does not match the current provider identity,
the chunk is stale and must be re-embedded before semantic search is reliable.

### MockEmbeddingProvider

Deterministic, dependency-free, no network. Safe for tests and vectorless RAG.

```typescript
import { MockEmbeddingProvider } from "@maharudra/agentic-ai-infra-runtime";

const provider = new MockEmbeddingProvider();
// model: "agentic-ai-infra-mock-embedding"
// version: "mock-embedding-v1"
// dimension: 64
const result = await provider.embedText("retrieval context engineering");
```

Vectors are produced by two consecutive SHA-256 passes over the input text —
one byte per dimension, unit-normalized. Stable across runs for identical
input, but not semantically meaningful: similar texts do not produce similar
vectors.

Use `MockEmbeddingProvider` to:
- exercise the full pgvector code path without a local model server,
- run index schema and migration tests cheaply,
- drive deterministic integration tests where semantic ranking is irrelevant.

### LocalEmbeddingProvider

HTTP client for local embedding servers. Compatible with Ollama (primary),
LocalAI, and LM Studio in Ollama-compatible mode.

```typescript
import { LocalEmbeddingProvider } from "@maharudra/agentic-ai-infra-runtime";

const provider = new LocalEmbeddingProvider({
  baseUrl:   "http://localhost:11434",  // Ollama root URL
  model:     "nomic-embed-text",
  dimension: 768
});
const result = await provider.embedText("retrieval context engineering");
```

Ollama quick-start:

```txt
1. Install Ollama: https://ollama.ai/download
2. Pull a model:   ollama pull nomic-embed-text
3. Ollama starts automatically on http://localhost:11434.
```

**Configuration fields:**

| Field | Default | Notes |
| --- | --- | --- |
| `baseUrl` | required | Root URL of the local server, no trailing slash |
| `model` | required | Model name sent in the request body |
| `dimension` | required | Expected output vector length; mismatch throws |
| `version` | `local-<model>` | Version string in every `EmbeddingResult` |
| `promptField` | `"prompt"` | Request body field carrying the input text |
| `embeddingField` | `"embedding"` | Response body field carrying the vector |

For OpenAI-compatible endpoints (LocalAI in OpenAI mode), set
`promptField: "input"`. For deeply nested responses implement
`EmbeddingProvider` directly or use a thin adapter.

### Switching `PgVectorProvider` to a real embedding provider

Without a provider (mock path, default):
```typescript
const vector = new PgVectorProvider("vec", corpus);
// warns: retrieval.mock-embedding on every result
```

With a real provider (semantic path):
```typescript
const embedding = new LocalEmbeddingProvider({
  baseUrl: "http://localhost:11434",
  model:   "nomic-embed-text",
  dimension: 768
});
const vector = new PgVectorProvider("vec", corpus, embedding);
// no warning; query vector comes from nomic-embed-text
```

If the embedding provider throws (network error, HTTP error, JSON error,
dimension mismatch), `PgVectorProvider.retrieve()` returns a recoverable
`retrieval.embedding-failed` result. The router skips recoverable failures
and continues with other configured providers.

### Index version constants

```typescript
import {
  MOCK_EMBEDDING_MODEL,           // "agentic-ai-infra-mock-embedding"
  MOCK_EMBEDDING_VERSION,         // "mock-embedding-v1"
  MOCK_EMBEDDING_DIMENSION,       // 64
  MOCK_EMBEDDING_INDEX_VERSION,   // "agentic-ai-infra-mock-embedding:mock-embedding-v1:dim64"
  MOCK_EMBEDDING_HNSW_M,          // 8
  MOCK_EMBEDDING_HNSW_EF_CONSTRUCTION // 32
} from "@maharudra/agentic-ai-infra-runtime";
```

Use `MOCK_EMBEDDING_INDEX_VERSION` to detect stale pgvector indexes when the
mock embedding model, version, or dimension changes.

---

## SQL Retrieval Paths

Retrieval providers have two query paths. The active path is selected
automatically based on the storage provider that is wired at container
construction time.

### Provider path table

| Provider | SQL path | In-memory path | Notes |
| --- | --- | --- | --- |
| `FullTextProvider` | ✅ tsvector (`plainto_tsquery`) | ✅ lexical term overlap | SQL used when storage has non-null `.db` getter |
| `PgVectorProvider` | ✅ pgvector `<=>` cosine | ✅ in-memory cosine + mock vectors | SQL used when storage has non-null `.db` getter AND EmbeddingProvider injected |
| `DocumentTreeProvider` | — | ✅ heading extraction | Uses `getChunks()` bulk SQL fetch for Postgres |
| `SymbolCodeProvider` | — | ✅ regex symbol extraction | Uses `getChunks()` bulk SQL fetch for Postgres |
| `PageIndexProvider` | — | ✅ section splitting | Uses `getChunks()` bulk SQL fetch for Postgres |
| `GraphProvider` | — | ✅ import/link edges | Uses `getChunks()` bulk SQL fetch for Postgres |

### SQL path activation

The SQL path activates automatically when the storage provider exposes a
non-null `.db` getter — which is the case for `PostgresStorageProvider`
constructed with an injected `QueryableDatabase`. There is no flag to toggle
or configuration field to set. The provider duck-type checks at query time:

```txt
  retrieve() called
       │
       ├── storage has non-null .db?  ──YES──▶  SQL path
       │                                         (FullTextProvider: tsvector)
       │                                         (PgVectorProvider: <=> + embed)
       └── no                         ──────▶  in-memory path
                                               (build corpus from getChunks())
                                               (score in memory)
```

For providers without an optimized SQL path (DocumentTree, SymbolCode,
PageIndex, Graph), `getChunks()` on `PostgresStorageProvider` runs a SQL JOIN
of `agentic_chunks` and `agentic_sources` to fetch the full corpus, then
scoring runs in memory. This is correct but less efficient for large databases —
native SQL paths for these providers are planned for future stages.

### FullTextProvider SQL query pattern

Uses the pre-computed `search_vector` tsvector column (generated always stored
column, indexed with GIN) and `plainto_tsquery` for natural-language queries:

```sql
SELECT
  c.chunk_id,
  c.source_id AS file_path,       -- source_id holds the file path value
  c.heading_path,
  c.content,
  c.token_estimate,
  ts_rank(c.search_vector, plainto_tsquery('english', $1)) AS rank
FROM agentic_chunks c
WHERE c.search_vector @@ plainto_tsquery('english', $1)
ORDER BY rank DESC
LIMIT $2
```

### PgVectorProvider SQL query pattern

Computes the query embedding first, then uses pgvector's `<=>` cosine distance
operator with the HNSW index (added in migration 003):

```sql
SELECT
  c.chunk_id,
  c.source_id AS file_path,
  c.heading_path,
  c.content,
  c.token_estimate,
  1 - (e.embedding <=> $1::vector) AS similarity
FROM agentic_embeddings e
JOIN agentic_chunks c ON c.chunk_id = e.chunk_id
WHERE e.embedding IS NOT NULL
ORDER BY e.embedding <=> $1::vector
LIMIT $2
```

`$1` is the query embedding as a pgvector literal `[0.1,0.2,...]`.
`similarity = 1 - cosine_distance`, so higher values mean more similar.

### PgVectorProvider not-configured on SQL path

When Postgres storage is detected but no `EmbeddingProvider` is injected, the
SQL path returns `retrieval.not-configured` rather than falling back to
deterministic mock embeddings. Production vector queries must use a real
semantic embedding model. The in-memory path retains the mock-embedding fallback
for development and fixture-based tests.

---

## Knowledge Chunking

The chunking pipeline splits project files into bounded `KnowledgeChunk` units
that are sized for embedding and retrieval. Each chunk carries stable SHA-256
derived identifiers, a token estimate, and provenance metadata (heading path,
symbol name, chunking strategy) so the index layer can detect staleness without
re-reading the original file.

### Chunking strategies

Three strategies are implemented. `dispatchChunker` selects automatically by
file extension; individual strategies can also be called directly.

```txt
  File extension
       │
       ├── .md   → chunkMarkdownByHeadings
       ├── .ts   → chunkTypeScriptBySymbols
       ├── .tsx  → chunkTypeScriptBySymbols
       └── other → chunkTextWithFallback
```

| Strategy | Trigger | Split point | Falls back to |
| --- | --- | --- | --- |
| `markdown-heading` | `.md` files | H1–H6 heading lines | `fallback` when no headings or oversized section |
| `typescript-ast` | `.ts` / `.tsx` files | Top-level `export` declarations | `fallback` when no exports found |
| `fallback` | Any file; also used as sub-chunker | Sliding window, newline/space boundary | — |

### `dispatchChunker`

Entry point for the chunking pipeline. Routes to the right strategy and
guarantees a non-empty result for non-empty input.

```typescript
import { dispatchChunker } from "@maharudra/agentic-ai-infra-runtime";

const chunks = dispatchChunker({
  filePath: "docs/04-core-framework/retrieval-providers.md",
  sourceType: "framework-doc",
  fileHash: "abc123",
  content: markdownText
});

for (const chunk of chunks) {
  console.log(chunk.chunkId);          // SHA-256–derived stable id
  console.log(chunk.headingPath);      // ["Provider Types"] for markdown-heading chunks
  console.log(chunk.chunkingStrategy); // "markdown-heading"
  console.log(chunk.tokenEstimate);    // heuristic: ceil(content.length / 4)
}
```

### Heading path preservation

`chunkMarkdownByHeadings` maintains a heading ancestry stack as it walks the
file line-by-line. Each chunk's `headingPath` field records the complete
ordered hierarchy from H1 down to the section that produced the chunk.

```txt
  # Retrieval Providers          → headingPath: ["Retrieval Providers"]
    ## Embedding Providers        → headingPath: ["Retrieval Providers", "Embedding Providers"]
      ### MockEmbeddingProvider   → headingPath: ["Retrieval Providers", "Embedding Providers",
                                                   "MockEmbeddingProvider"]
    ## Knowledge Chunking         → headingPath: ["Retrieval Providers", "Knowledge Chunking"]
```

Headings inside fenced code blocks (``` or ~~~) are never treated as split
points — a `# comment` inside a code example does not start a new chunk.

### Symbol extraction without AST

`chunkTypeScriptBySymbols` uses regex pattern matching against top-level
`export` declarations rather than a TypeScript AST parser, so no external
`typescript` package dependency is needed. The trade-off is that declarations
inside nested blocks (namespaces, conditional types, function bodies) are not
split points — only top-level exports are recognized.

Recognized patterns: `export class`, `export abstract class`,
`export interface`, `export type`, `export function`,
`export async function`, `export const`, `export enum`,
and their `declare export` variants.

Each chunk's `symbolName` and `metadata.symbolKind` fields carry the
extracted identifier and declaration keyword for use by `SymbolCodeProvider`.

### Chunk size limits and overlap

Default limits apply to all strategies:

| Parameter | Default | Notes |
| --- | --- | --- |
| `maxTokens` | 512 | Heuristic tokens per chunk (1 token ≈ 4 chars) |
| `overlapTokens` | 64 | Overlap between adjacent fallback windows |
| `maxChunks` | 100 | Hard cap per file; last chunk tagged `truncated: true` |

Overlap exists in the `fallback` strategy to preserve context that would
otherwise be cut across a window boundary — a sentence or argument that starts
near the end of one window also appears at the start of the next, so retrieval
can find it regardless of which window a query lands in.

Markdown sections and TypeScript symbol bodies that exceed `maxTokens` are
sub-chunked with the fallback strategy, retaining the parent `headingPath` or
`symbolName` on each sub-chunk.
