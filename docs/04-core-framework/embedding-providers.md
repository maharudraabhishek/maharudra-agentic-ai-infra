# Embedding Providers

This document covers the `EmbeddingProvider` interface, the built-in provider types, configuration, factory usage, and how providers integrate into the framework's retrieval pipeline.

---

## 1. Overview

An `EmbeddingProvider` converts a text string into a fixed-dimension floating-point vector. These vectors are stored in Postgres via the `pgvector` extension and enable semantic similarity search — the foundation of the `pgvector` retrieval provider.

The query path through the embedding layer:

```txt
  query text
      │
      ▼
  PgVectorProvider.retrieve()
      │
      │  embedText(query)
      ▼
  EmbeddingProvider  ───►  vector(1024)
      │
      ▼
  Postgres pgvector <=> (cosine distance)
      │
      ▼
  ranked RetrievalResult[]
```

The `EmbeddingProvider` interface sits in `@maharudra/agentic-ai-infra-core` (contracts-only). Provider implementations live in `@maharudra/agentic-ai-infra-runtime`. No paid SDKs ever enter the framework — cloud providers are wired by the caller via the `EmbeddingProvider` interface.

---

## 2. Provider Types

| Type | Class | Network | Use case | CI-safe |
|------|-------|---------|----------|---------|
| `"mock"` | `MockEmbeddingProvider` | no | Tests, CI, vectorless RAG | yes |
| `"local-http"` | `LocalEmbeddingProvider` | yes (loopback) | Ollama / LocalAI / LM Studio | no |
| `"custom"` | caller-supplied | depends | Any `EmbeddingProvider` implementation | depends |

**`MockEmbeddingProvider`** produces 1024-dimensional unit-normalized vectors using chained SHA-256 passes over the input text. Vectors are deterministic (same input → same output) and fully network-free. The provider exercises the full pgvector code path in CI without requiring Ollama.

**`LocalEmbeddingProvider`** POSTs to a local embedding server compatible with Ollama, LocalAI, or LM Studio (in Ollama-compatible mode). Supports both the flat Ollama response format and the OpenAI-compatible nested format automatically.

**Custom providers** pass through the interface unchanged. Construct the instance and pass it via `RuntimeStartOptions.embeddingProvider`.

---

## 3. Configuration

Set the `embedding` field in your `agentic-ai-infra.config.ts`:

```typescript
// Ollama with mxbai-embed-large (recommended for local dev):
embedding: {
  type: "local-http",
  baseUrl: "http://localhost:11434",
  model: "mxbai-embed-large",
  dimension: 1024
}
```

```typescript
// Deterministic mock — no Ollama required:
embedding: {
  type: "mock"
}
```

```typescript
// Custom provider — pass instance directly at runtime:
embedding: {
  type: "custom"   // signals "no factory construction"
}
// Then pass the instance via RuntimeStartOptions:
// startLocalRuntime(config, { embeddingProvider: myProvider })
```

The `dimension` field must match the pgvector schema column dimension (migration 005 sets `vector(1024)`).

---

## 4. Factory

`createEmbeddingProvider(config)` is the single construction point for all config-driven providers. The runtime container calls it automatically when `config.embedding` is set.

```typescript
import { createEmbeddingProvider } from "@maharudra/agentic-ai-infra-runtime";

const provider = createEmbeddingProvider({
  type: "local-http",
  baseUrl: "http://localhost:11434",
  model: "mxbai-embed-large",
  dimension: 1024
});
const result = await provider.embedText("what is retrieval-augmented generation?");
console.log(result.embedding.length); // 1024
```

The factory throws synchronously for invalid config (missing required fields, unknown type). A bad config is a startup failure, not a runtime condition — the error surfaces immediately rather than on the first embed call.

---

## 5. Auto-Selection Logic

The runtime container resolves the embedding provider with this precedence:

```txt
  1. options.embeddingProvider     (explicit caller instance — highest priority)
         │
         │  if absent:
         ▼
  2. config.embedding              (config-driven, constructed via factory)
         │
         │  if absent AND profile declares pgvector:
         ▼
  3. MockEmbeddingProvider         (auto-fallback — no Ollama required)
         │
         │  if no pgvector provider in profile:
         ▼
  4. undefined                     (non-vector profiles — no embedding needed)
```

The auto-fallback (`MockEmbeddingProvider`) is intentional: `hybrid-rag` and `local-context` profiles exercise the full SQL vector code path in CI without Ollama, producing deterministic but non-semantic results. For production-quality retrieval, configure `embedding: { type: "local-http", ... }`.

---

## 6. Response Format Support

`LocalEmbeddingProvider` transparently supports two response shapes:

**Flat Ollama format** (default):
```json
{ "embedding": [0.1, 0.2, ...] }
```

**OpenAI-compatible nested format** (LocalAI in OpenAI mode, LM Studio):
```json
{ "data": [{ "embedding": [0.1, 0.2, ...] }] }
```

The flat format is tried first. If absent, the nested path is checked. If neither is found, an error is thrown naming both paths checked, so setup problems surface immediately with actionable messages.

---

## 7. Vector Dimension

The `embedding.dimension` field must match the `agentic_embeddings.embedding` column in Postgres. Migration 005 sets this to `vector(1024)` for `mxbai-embed-large` compatibility.

At runtime startup, `startLocalRuntime()` validates the schema column dimension against the wired provider's `dimension` field. A mismatch returns a fatal error: apply migration 005 first.

See [ollama-embeddings-setup.md](../06-runbooks/ollama-embeddings-setup.md) for the full setup runbook including migration steps.

---

## 8. CI vs Local Development

| Scenario | Provider | Ollama needed | Semantic quality |
|----------|----------|---------------|-----------------|
| CI / no DB | MockEmbeddingProvider (auto) | no | deterministic, not semantic |
| CI / Postgres | MockEmbeddingProvider (auto) | no | deterministic, not semantic |
| Local dev / Ollama | LocalEmbeddingProvider | yes | full semantic quality |
| Production | LocalEmbeddingProvider or custom | model server | full semantic quality |

The mock provider ensures that all CI tests exercise the full pgvector SQL code path (vector literal construction, `<=>` cosine operator, HNSW index scan) with zero external dependencies. Retrieval quality is not verified in CI — that belongs in eval runs with real embeddings.
