# Retrieval And Context Setup

Retrieval and context setup prepares safe project knowledge for bounded use.

```txt
┌──────────────────────────┐
│ Approved Indexed Sources │
└─────────────┬────────────┘
              ▼
┌──────────────────────────┐
│ Retrieval Providers      │
└─────────────┬────────────┘
              ▼
┌──────────────────────────┐
│ Retrieval Router         │
└─────────────┬────────────┘
              ▼
┌──────────────────────────┐
│ Context Builder          │
└─────────────┬────────────┘
              ▼
┌──────────────────────────┐
│ Bounded Context Package  │
└──────────────────────────┘
```

## Steps

1. Choose retrieval providers in `agentic-ai-infra.config.ts`.
2. Review storage and migration status.
3. Run migrations only through the explicit approved migration runner.
4. Index approved, non-secret sources.
5. Build context packages from bounded retrieval previews.

Retrieved content is evidence for the user task. It does not override project policy, user instructions, or runtime safety rules.

---

## Embedding Setup

The `PgVectorProvider` needs an embedding provider to compute the query
vector for semantic similarity search. Three tiers are available depending on
your project needs and infrastructure.

### Tier comparison

| Tier | Provider | Semantic quality | Setup required | Cost |
| --- | --- | --- | --- | --- |
| None (vectorless RAG) | `MockEmbeddingProvider` | None — not semantic | Zero | Free |
| Local (free) | `LocalEmbeddingProvider` + Ollama | Good to excellent | ~5 min | Free |
| Cloud (custom) | Custom `EmbeddingProvider` | Depends on model | API key + code | Paid |

**What works with each tier:**

| Capability | Mock | Ollama | Cloud |
| --- | --- | --- | --- |
| Exercises pgvector code path | Yes | Yes | Yes |
| Deterministic test vectors | Yes | No | No |
| Semantic similarity ranking | No | Yes | Yes |
| Index schema / migration testing | Yes | Yes | Yes |
| Production-ready retrieval quality | No | Yes (model-dependent) | Yes |
| No external service dependency | Yes | No — needs Ollama process | No — needs API |

### Tier 1 — None (mock, vectorless RAG)

Use `MockEmbeddingProvider` when you want to exercise the pgvector path
without a local model server, run integration tests, or explore the framework
before committing to a specific embedding model.

```typescript
import { MockEmbeddingProvider, PgVectorProvider } from "@maharudra/agentic-ai-infra-runtime";

const vectorProvider = new PgVectorProvider("vec", corpus, new MockEmbeddingProvider());
```

A `retrieval.mock-embedding` warning is emitted on every result to remind
you that semantic quality is not guaranteed. The warning is intentional and
non-fatal — it signals the vector path ran but the ranking is not meaningful.

### Tier 2 — Local Ollama (free, recommended for development)

Ollama runs local open-weight embedding models with no API key or cost.

**Quick-start:**

```txt
Step 1 — Install Ollama
  Download from https://ollama.ai/download
  Ollama starts automatically after install on http://localhost:11434

Step 2 — Pull an embedding model
  ollama pull nomic-embed-text      # 768 dims, good general-purpose quality
  ollama pull mxbai-embed-large     # 1024 dims, higher quality, larger download
  ollama pull all-minilm            # 384 dims, fastest option

Step 3 — Configure the provider
  See code example below.

Step 4 — Verify the model is running
  curl http://localhost:11434/api/embeddings \
    -d '{"model":"nomic-embed-text","prompt":"hello"}'
  Expected: {"embedding":[...768 numbers...]}
```

**Code:**

```typescript
import {
  LocalEmbeddingProvider,
  PgVectorProvider
} from "@maharudra/agentic-ai-infra-runtime";

const embedding = new LocalEmbeddingProvider({
  baseUrl:   "http://localhost:11434",
  model:     "nomic-embed-text",
  dimension: 768
});

const vectorProvider = new PgVectorProvider("vec", corpus, embedding);
```

**Diagnosing provider errors:**

| Error message | Likely cause | Fix |
| --- | --- | --- |
| `network error connecting to …` | Ollama is not running | Start Ollama; check port 11434 |
| `HTTP 404` | Model not pulled | `ollama pull nomic-embed-text` |
| `missing "embedding" array field` | Wrong `embeddingField` setting | Check Ollama response shape |
| `expected 768-dimensional vector but got N` | Wrong `dimension` value | Match to model's actual dimension |

### Tier 3 — Cloud or custom provider

Implement the `EmbeddingProvider` interface to use any cloud embedding API
(OpenAI, Anthropic, Cohere, Voyage, etc.) or any other embedding source.

```typescript
import type {
  EmbeddingInput,
  EmbeddingProvider,
  EmbeddingResult
} from "@maharudra/agentic-ai-infra-core";

class MyCloudEmbeddingProvider implements EmbeddingProvider {
  readonly model = "text-embedding-3-small";
  readonly version = "openai-text-embedding-3-small-v1";
  readonly dimension = 1536;

  async embedText(text: string): Promise<EmbeddingResult> {
    // Call your chosen embedding API here.
    // Throw with a descriptive message on failure.
    throw new Error("not implemented");
  }

  async embedBatch(inputs: readonly EmbeddingInput[]): Promise<readonly EmbeddingResult[]> {
    // Implement native batch API call here, or fall back to sequential embedText.
    return Promise.all(inputs.map((input) =>
      this.embedText(input.text).then((r) => input.id ? { ...r, id: input.id } : r)
    ));
  }
}
```

Pass it to `PgVectorProvider` the same way as Ollama:
```typescript
const vectorProvider = new PgVectorProvider("vec", corpus, new MyCloudEmbeddingProvider());
```

### Index version compatibility

When switching embedding providers (e.g. from mock to Ollama, or from one
Ollama model to another), all previously indexed vectors are stale. Stale
vectors must be re-embedded because cosine similarity across different model
spaces is meaningless.

Track the provider identity using `EmbeddingResult.model`,
`EmbeddingResult.version`, and `EmbeddingResult.dimension`. For mock vectors
use the exported constant:

```typescript
import { MOCK_EMBEDDING_INDEX_VERSION } from "@maharudra/agentic-ai-infra-runtime";
// "agentic-ai-infra-mock-embedding:mock-embedding-v1:dim64"
```

Compare stored chunk provenance against the current provider before running
semantic queries to avoid silently serving stale results.

---

## Indexing Project Knowledge

`indexProjectKnowledge` runs the full chunking and embedding pipeline over your
project tree and persists the results to the configured storage provider.

### What gets indexed

The scanner walks the project root recursively and applies the indexing policy
to every discovered file. Only files that pass all policy checks are chunked
and embedded.

**Included by policy:**

| Path pattern | Source type |
| --- | --- |
| Root-level `.md` files (`AGENTS.md`, `CLAUDE.md`, etc.) | `project-policy` |
| `.agents/skills/**` | `skill` |
| `docs/02-architecture/**` | `architecture-doc` |
| `docs/03-cli/**` | `cli-doc` |
| `docs/04-core-framework/**` | `framework-doc` |
| `docs/05-security/**` | `security-doc` |
| `docs/06-runbooks/**` | `runbook` |
| `docs/internal/learning-notes/**` | `learning-journal` |
| Other `docs/**` | `project-doc` |
| `packages/**/src/**/*.ts`, `.tsx` | `typescript-source` |
| `examples/**` | `example` |

**Always excluded:**

- Directories: `node_modules`, `dist`, `build`, `coverage`, `.git`, `.turbo`,
  `.agentic-local`, `.cache`, `tmp`, `temp`
- Filenames: `.env*`, `.npmrc`, `*.key`, `*.pem`, `id_rsa`, `id_ed25519`,
  `credentials`, `private-key`
- Sensitive path patterns: paths containing `secret`, `token`, `credential`,
  `password`, `passwd`, `private-key`, `api-key`, `auth-key`
- Extensions other than `.md`, `.ts`, `.tsx`
- Symbolic links (never followed)
- Files larger than 512 KiB
- Files beyond the 500-file cap per run

### Running the indexer

```typescript
import {
  MockEmbeddingProvider,
  indexProjectKnowledge
} from "@maharudra/agentic-ai-infra-runtime";

const summary = await indexProjectKnowledge({
  embeddingProvider: new MockEmbeddingProvider(),
  storageProvider: myStorageProvider,
  projectRoot: "/path/to/project"  // defaults to process.cwd()
});

console.log(summary.filesIndexed);    // files successfully chunked and embedded
console.log(summary.chunksCreated);   // total new chunks
console.log(summary.embeddingsCreated); // total embedding vectors computed
console.log(summary.fileErrorCount);  // files that failed; never aborts the run
console.log(summary.indexVersion);    // provider identity for staleness checks
```

### Skip reasons

The `KnowledgeScanReport` (from `scanProjectFiles`) records why each skipped
file was excluded:

| Skip reason | Cause |
| --- | --- |
| `blocked-dir` | A path segment is in the blocked-directory list |
| `blocked-filename` | Filename matches `.env*`, `*.key`, etc. |
| `sensitive-path` | Path contains `secret`, `token`, `credential`, etc. |
| `unsupported-extension` | Not `.md`, `.ts`, or `.tsx` |
| `symlink` | Entry is a symbolic link |
| `file-too-large` | File exceeds 512 KiB |
| `too-many-files` | 500-file cap reached before this entry |
| `read-error` | I/O error while reading the file |
| `policy-error` | Other policy violation detected after path checks |

To review skips without running the full indexer:

```typescript
import { scanProjectFiles } from "@maharudra/agentic-ai-infra-runtime";

const report = await scanProjectFiles("/path/to/project");
const skipped = report.files.filter((f) => f.status === "skipped");
for (const entry of skipped) {
  console.log(entry.filePath, "→", entry.skipReason);
}
```

### Force re-index with approval

By default, `indexProjectKnowledge` skips files whose stored file hash and
index version match the current file — this avoids re-embedding unchanged
content on every call.

To force a full re-index (e.g. after switching embedding models):

```typescript
const summary = await indexProjectKnowledge({
  embeddingProvider: newProvider,
  storageProvider: myStorageProvider,
  forceReindex: true,
  approvalText: "REINDEX_AGENTIC_AI_KNOWLEDGE"  // exact string required
});
```

The `approvalText` must be the exact string `"REINDEX_AGENTIC_AI_KNOWLEDGE"`.
Any other value causes `indexProjectKnowledge` to throw before touching the
filesystem. This mirrors the approval gate pattern used by `DefaultApprovalPolicy`
for write and migration tools — an explicit opt-in prevents accidental full
re-indexes, which may be slow and expensive for large projects.

**Do not log, echo, or expose the approval string in user-visible output.**

### What to do after indexing

Once indexing completes, the retrieval providers can query the indexed chunks:

1. Check `summary.indexVersion` and compare it against your stored version
   to confirm the index is current.
2. Use `PgVectorProvider` with the same `EmbeddingProvider` that was used for
   indexing — query vectors must come from the same model space as stored vectors.
3. If `summary.fileErrorCount > 0`, inspect the scan report for the affected
   paths and re-run after fixing the underlying problem.
4. After switching embedding models, always run a full re-index (`forceReindex`)
   to invalidate stale vectors from the previous model.
