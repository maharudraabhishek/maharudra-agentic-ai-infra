# Ollama Embeddings Setup

Step-by-step guide to running local semantic embeddings with Ollama and `mxbai-embed-large`, wired into the framework via `LocalEmbeddingProvider`.

---

## 1. Prerequisites

- **Ollama** installed on your machine — see [ollama.ai/download](https://ollama.ai/download)
- **Postgres with pgvector** running locally (Docker recommended)

For Postgres setup see: [examples-quickstart-postgres.md](./examples-quickstart-postgres.md)

---

## 2. Pull the Embedding Model

```bash
ollama pull mxbai-embed-large
```

This downloads a ~670 MB model. The model produces 1024-dimensional vectors, matching the `vector(1024)` schema column from migration 005.

---

## 3. Verify Ollama is Running

```bash
# Start the Ollama server (if not already running):
ollama serve

# In a separate terminal, verify it responds:
curl http://localhost:11434/api/embeddings \
  -H "Content-Type: application/json" \
  -d '{"model":"mxbai-embed-large","prompt":"test"}'
```

Expected response shape:
```json
{ "embedding": [0.123, -0.456, ...] }
```

If Ollama is not running, `LocalEmbeddingProvider` throws a network error on the first embed call.

---

## 4. Configure Embedding in `agentic-ai-infra.config.ts`

```typescript
import { defineConfig } from "@maharudra/agentic-ai-infra-core";

export default defineConfig({
  profiles: ["local-context"],
  // or "hybrid-rag" for multi-provider retrieval

  embedding: {
    type: "local-http",
    baseUrl: "http://localhost:11434",
    model: "mxbai-embed-large",
    dimension: 1024
  },

  storage: {
    providers: [
      {
        id: "rag-context-store",
        type: "postgres",
        connectionRef: "local-ai-context-postgres"
      }
    ]
  }
});
```

---

## 5. Run Migration 005

Migration 005 changes the `agentic_embeddings.embedding` column from `vector(64)` to `vector(1024)`. This migration deletes all existing embeddings (re-embedding required after migration).

**PowerShell:**
```powershell
$env:RUN_AGENTIC_AI_INFRA_MIGRATIONS = "RUN_AGENTIC_AI_INFRA_MIGRATIONS"
$env:DATABASE_URL = "postgresql://agentic_user:agentic_pass@localhost:5433/agentic_ai_infra"
pnpm.cmd verify:postgres
```

**Bash:**
```bash
RUN_AGENTIC_AI_INFRA_MIGRATIONS=RUN_AGENTIC_AI_INFRA_MIGRATIONS \
DATABASE_URL=postgresql://agentic_user:agentic_pass@localhost:5433/agentic_ai_infra \
pnpm verify:postgres
```

The script runs all pending migrations (001–005) in order. Look for:
```
✅ Migration 005_agentic_embedding_dimension_1024 applied
```

---

## 6. Verify End-to-End

Start your local runtime with the embedding config set. Expected log output:

```
[agentic-ai-infra] Embedding provider: LocalEmbeddingProvider (mxbai-embed-large, 1024-dim)
[agentic-ai-infra] Embedding dimension validated: 1024 ✓
[agentic-ai-infra] Local STDIO MCP runtime prepared.
```

If these lines appear, the `LocalEmbeddingProvider` is wired and the schema dimension is confirmed.

---

## 7. Troubleshooting

### "Embedding dimension mismatch" at startup

**Cause:** The `agentic_embeddings` column still stores `vector(64)` (pre-migration 005).
**Fix:** Run `pnpm verify:postgres` with `RUN_AGENTIC_AI_INFRA_MIGRATIONS` set. Migration 005 will alter the column to `vector(1024)`.

### Ollama unreachable

**Cause:** `ollama serve` is not running, or it is running on a different port.
**Fix:** Run `ollama serve` in a terminal and verify with:
```bash
curl http://localhost:11434/api/version
```

### Model not found (`404`)

**Cause:** `mxbai-embed-large` was not pulled before starting.
**Fix:** Run `ollama pull mxbai-embed-large` first.

### "dimension mismatch: expected 1024, got 768"

**Cause:** The `model` field in `embedding` config refers to a different model (e.g. `nomic-embed-text` produces 768-dim vectors).
**Fix:** Either change `model` to `mxbai-embed-large` and `dimension` to `1024`, or run a new migration to adjust the column dimension if you want to use a 768-dim model.
