import type { FrameworkResult } from "../errors/index.js";

/** Retrieval provider types supported by framework contracts. */
export const RETRIEVAL_PROVIDER_TYPES = [
  "full-text",
  "pgvector",
  "document-tree",
  "page-index",
  "symbol-code",
  "graph",
  "hybrid"
] as const;

/** Retrieval provider type, including project-defined custom providers. */
export type RetrievalProviderType =
  | (typeof RETRIEVAL_PROVIDER_TYPES)[number]
  | "custom";

/**
 * Configuration for one retrieval provider.
 */
export type RetrievalProviderConfig = {
  readonly id: string;
  readonly type: RetrievalProviderType;
  readonly enabled: boolean;
  readonly storageProviderId?: string;
  readonly extension?: boolean;
  readonly capabilities?: readonly string[];
  readonly safetyPolicy?: {
    readonly remoteSafe: boolean;
    readonly returnsRawContent?: boolean;
  };
};

/**
 * Configuration for provider routing and result limits.
 *
 * `merger` and `reranker` activate optional post-retrieval processing stages
 * for profiles that require higher recall quality. Both default to `"none"`.
 *
 * - `merger: "rrf"` — activate `ReciprocalRankFusion` across providers.
 * - `reranker: "heuristic"` — activate `HeuristicReranker` after merging.
 */
export type RetrievalRouterConfig = {
  readonly strategy: "single" | "hybrid" | "fallback";
  readonly providerOrder?: readonly string[];
  readonly maxResults?: number;
  /**
   * Post-retrieval merger strategy.
   *
   * - `"rrf"` — Reciprocal Rank Fusion across all provider result lists.
   * - `"none"` (default) — simple concat + dedup.
   */
  readonly merger?: "rrf" | "none";
  /**
   * Post-merge reranker strategy.
   *
   * - `"heuristic"` — deterministic score adjustments: exact match, recency,
   *   source type priority, heading depth.
   * - `"none"` (default) — no reranking after merge.
   */
  readonly reranker?: "heuristic" | "none";
  /**
   * Per-source-type priority weights used to stamp `RetrievalResult.sourcePriority`.
   *
   * Keys match `sourceType` values on `RetrievalResult` (e.g. `"agents-md"`,
   * `"docs"`, `"code"`, `"generated"`, `"pdf"`). Values are in [0, 1].
   * Source types not present in the map receive priority 0.
   *
   * When absent, `DEFAULT_SOURCE_PRIORITY_MAP` is used.
   */
  readonly sourcePriorityMap?: Record<string, number>;
};

/**
 * Top-level retrieval config.
 */
export type RetrievalConfig = {
  readonly enabled: boolean;
  readonly providers: readonly RetrievalProviderConfig[];
  readonly router?: RetrievalRouterConfig;
};

/**
 * Input for a retrieval request.
 */
export type RetrievalInput = {
  readonly query: string;
  readonly filters?: Record<string, readonly string[]>;
  readonly maxResults?: number;
  readonly maxTokens?: number;
};

/**
 * Bounded retrieval result.
 *
 * Providers may include compact content, but must not return vectors, secrets,
 * raw full files, or unbounded chunks.
 *
 * Optional fields (`updatedAt`, `sourceType`, `headingPath`) are used by
 * `HeuristicReranker` to apply recency, source-priority, and heading-depth
 * scoring adjustments. Providers that cannot supply these fields omit them;
 * the reranker falls back to neutral weights for absent fields.
 */
export type RetrievalResult = {
  readonly providerId: string;
  readonly sourceId: string;
  /** Normalized relevance score in [0, 1] or a provider-specific positive number. */
  readonly score: number;
  readonly preview: string;
  readonly content?: string;
  readonly tokenEstimate?: number;
  readonly metadata?: Record<string, string | number | boolean>;
  /**
   * ISO-8601 timestamp of the last content update.
   *
   * Used by `HeuristicReranker` to apply a recency boost for recently updated
   * sources. Omit when the provider does not track update time.
   */
  readonly updatedAt?: string;
  /**
   * Source category matching the `KnowledgeSourceType` vocabulary or a
   * simplified tier string understood by `HeuristicReranker`.
   *
   * Recognized tiers in the default config: `"agents-md"`, `"docs"`,
   * `"code"`, `"generated"`. Providers that classify sources as
   * `"agent-instructions"` or `"project-policy"` should set `"agents-md"`;
   * `"architecture-doc"` / `"framework-doc"` should set `"docs"`;
   * `"typescript-source"` should set `"code"`.
   *
   * Omit when source classification is unavailable.
   */
  readonly sourceType?: string;
  /**
   * Heading ancestry for this result as a slash-separated path.
   *
   * Used by `HeuristicReranker` to prefer shallower sections.
   * Example: `"Overview"`, `"Overview/Details/Sub-section"`.
   * Omit when no heading path is available.
   */
  readonly headingPath?: string;
  /**
   * Resolved source priority in [0, 1].
   *
   * Derived from the profile's `sourcePriorityMap` keyed by `sourceType`, or
   * from the document's own priority when no map is configured. Higher values
   * mean higher priority in context selection and reranking.
   *
   * Recognized defaults: `"agents-md"` 1.0, `"pdf"` 0.75, `"docs"` 0.8,
   * `"code"` 0.6, `"generated"` 0.2. Omit when the provider cannot determine
   * source priority.
   */
  readonly sourcePriority?: number;
  /**
   * Embedding vector for this result, when available.
   *
   * Populated by providers that compute embeddings during retrieval (e.g.
   * `PgVectorProvider` attaches the stored chunk vector after a pgvector query).
   * Used by `ContextOptimizer` for cosine-similarity deduplication — two results
   * with `cosine(a.embedding, b.embedding) >= dedupThreshold` are considered
   * near-duplicates and the lower-priority one is dropped before context assembly.
   *
   * Providers that do not compute embeddings omit this field. The optimizer falls
   * back to text-overlap deduplication when both `embedding` is absent and no
   * `EmbeddingProvider` is injected.
   *
   * Length, when present, must equal the embedding provider's declared dimension.
   */
  readonly embedding?: readonly number[];
};

// ---------------------------------------------------------------------------
// Merger and reranker contracts (core interfaces for Layer 8)
// ---------------------------------------------------------------------------

/**
 * Merges ranked result lists from multiple retrieval providers into a single
 * deduplicated list.
 *
 * Implementations must be deterministic for the same inputs. The identity
 * invariant `merge([results])` must produce a valid ordered list. Callers must
 * not mutate the input arrays.
 *
 * @example
 * ```typescript
 * const merger: RetrievalMerger = new ReciprocalRankFusion();
 * const merged = merger.merge([ftResults, vecResults, pageResults]);
 * ```
 */
export interface RetrievalMerger {
  /**
   * Merges multiple provider result lists into one deduplicated list.
   *
   * @param providerResults - One array of results per provider, in provider
   *   priority order. Each inner array is a ranked list from one provider.
   * @returns A single deduplicated list ordered by merge score descending.
   */
  merge(providerResults: ReadonlyArray<RetrievalResult[]>): RetrievalResult[];
}

/**
 * Reranks a flat list of retrieval results, returning a new list in reranked
 * order without mutating the input.
 *
 * Rerankers must be deterministic and must not make network calls. Equal scores
 * must preserve stable input order. The output list must have the same length
 * as the input unless the implementation documents deliberate filtering.
 *
 * @example
 * ```typescript
 * const reranker: Reranker = new HeuristicReranker();
 * const reranked = reranker.rerank(mergedResults, "retrieval quality");
 * ```
 */
export interface Reranker {
  /**
   * Returns a new list of results in reranked order.
   *
   * @param results - The flat list to rerank. Must not be mutated.
   * @param query - The original query text used for exact-match scoring.
   */
  rerank(results: RetrievalResult[], query: string): RetrievalResult[];
}

/**
 * Retrieval provider interface implemented by runtime package providers.
 */
export interface RetrievalProvider {
  readonly id: string;
  readonly type: RetrievalProviderType;
  /**
   * Retrieves bounded evidence for the input query.
   */
  retrieve(input: RetrievalInput): Promise<FrameworkResult<readonly RetrievalResult[]>>;
}

// ---------------------------------------------------------------------------
// Embedding provider contracts
// ---------------------------------------------------------------------------

/**
 * Input to a single embedding request.
 *
 * The optional `id` field preserves caller-assigned correlation through batch
 * calls. When provided, the matching `EmbeddingResult` echoes the same `id`
 * so callers can reconcile results to their source texts without relying on
 * array position alone.
 *
 * @example
 * ```typescript
 * const inputs: EmbeddingInput[] = [
 *   { id: "doc-1", text: "retrieval context engineering" },
 *   { id: "doc-2", text: "token efficiency and budgeting" }
 * ];
 * ```
 */
export type EmbeddingInput = {
  /** Optional caller-assigned identifier echoed on the matching `EmbeddingResult`. */
  readonly id?: string;
  /** The source text to convert into an embedding vector. */
  readonly text: string;
};

/**
 * Embedding vector with full provenance returned by an `EmbeddingProvider`.
 *
 * Every result carries model, version, and dimension so callers can detect
 * index staleness between runs. If a stored chunk's provenance does not match
 * the current provider's identity the chunk must be re-embedded before
 * semantic search results are reliable.
 *
 * @example
 * ```typescript
 * const result = await provider.embedText("retrieval context");
 * console.log(result.model);     // "nomic-embed-text"
 * console.log(result.version);   // "local-nomic-embed-text"
 * console.log(result.dimension); // 768
 * console.log(result.embedding.length === result.dimension); // true
 * ```
 */
export type EmbeddingResult = {
  /** Caller-assigned correlation id, echoed from the corresponding `EmbeddingInput.id`. */
  readonly id?: string;
  /**
   * The embedding vector. Length must equal `dimension`.
   *
   * Providers are expected to return unit-normalized vectors when possible so
   * cosine similarity can be computed with a simple dot product.
   */
  readonly embedding: readonly number[];
  /**
   * Model identifier for this embedding, e.g. `"nomic-embed-text"`.
   *
   * Stored alongside indexed vectors so index consumers can detect model changes.
   */
  readonly model: string;
  /**
   * Provider-assigned version string for this embedding variant.
   *
   * Changing the version string signals that stored vectors are incompatible
   * with new results and must be regenerated. For local HTTP providers this is
   * typically auto-derived from the model name.
   */
  readonly version: string;
  /** Number of dimensions in the embedding vector. Must match `embedding.length`. */
  readonly dimension: number;
};

/**
 * Provider interface for converting text into fixed-dimension embedding vectors.
 *
 * All implementations must expose their model identity, version, and dimension
 * so callers can guard against stale index data when the underlying model
 * changes. Both `embedText` and `embedBatch` are required — not optional —
 * so callers never need to branch on provider capability.
 *
 * @example
 * ```typescript
 * // Using MockEmbeddingProvider (local, deterministic, no network):
 * const mock: EmbeddingProvider = new MockEmbeddingProvider();
 * const single = await mock.embedText("retrieval context");
 * console.log(single.embedding.length); // 64
 *
 * // Using LocalEmbeddingProvider (Ollama, LocalAI, or LM Studio):
 * const local: EmbeddingProvider = new LocalEmbeddingProvider({
 *   baseUrl: "http://localhost:11434",
 *   model: "nomic-embed-text",
 *   dimension: 768
 * });
 * const batch = await local.embedBatch([
 *   { id: "doc-1", text: "retrieval context" },
 *   { id: "doc-2", text: "token efficiency" }
 * ]);
 * console.log(batch[0]?.id); // "doc-1"
 * ```
 */
export interface EmbeddingProvider {
  /** Model identifier used in every `EmbeddingResult` produced by this provider. */
  readonly model: string;
  /**
   * Version string used in every `EmbeddingResult`.
   *
   * Callers compare this against stored index provenance to detect stale data.
   */
  readonly version: string;
  /** Dimension of the embedding vectors this provider produces. */
  readonly dimension: number;
  /**
   * Embeds a single text string and returns the result with full provenance.
   *
   * Errors are thrown rather than returned as `FrameworkResult` so callers that
   * want to treat failures as warnings can wrap the call in a try/catch.
   */
  embedText(text: string): Promise<EmbeddingResult>;
  /**
   * Embeds a batch of texts. `id` fields on inputs are echoed on the matching
   * results.
   *
   * All providers must implement batching; sequential per-item fallback is
   * acceptable when the backing service has no native batch endpoint.
   */
  embedBatch(inputs: readonly EmbeddingInput[]): Promise<readonly EmbeddingResult[]>;
}

/**
 * Configuration for an embedding provider wired into the framework.
 *
 * Used within `AgenticInfraProjectConfig` to describe which embedding provider
 * the runtime should instantiate. Concrete fields vary by `type`.
 *
 * @example
 * ```typescript
 * const config: EmbeddingProviderConfig = {
 *   type: "local-http",
 *   baseUrl: "http://localhost:11434",
 *   model: "nomic-embed-text",
 *   dimension: 768
 * };
 * ```
 */
export type EmbeddingProviderConfig = {
  /**
   * Provider implementation type.
   *
   * - `"mock"` — deterministic SHA-256-based mock; no network; safe for tests
   *   and vectorless RAG setups that want to exercise the pgvector path.
   * - `"local-http"` — HTTP client for local embedding servers (Ollama, LocalAI,
   *   LM Studio). Requires `baseUrl`, `model`, and `dimension`.
   * - `"custom"` — caller-supplied `EmbeddingProvider` instance; no config fields
   *   are read by the framework.
   */
  readonly type: "mock" | "local-http" | "custom";
  /**
   * Root URL of the local embedding HTTP server.
   * Required for `type: "local-http"`. Example: `"http://localhost:11434"`.
   */
  readonly baseUrl?: string;
  /** Model name to request from the embedding server. Required for `type: "local-http"`. */
  readonly model?: string;
  /** Expected embedding vector dimension. Required for `type: "local-http"`. */
  readonly dimension?: number;
  /** Provider version string. Auto-derived when absent. */
  readonly version?: string;
};

// ---------------------------------------------------------------------------
// Knowledge indexing contracts — chunking pipeline and project scanner
// ---------------------------------------------------------------------------

/**
 * All recognized source categories that the framework can index.
 *
 * Each type maps to a specific area of the project tree defined in STRUCTURE.md.
 * The classification controls which retrieval providers handle a chunk and how
 * it is ranked when the router dispatches queries.
 */
export const KNOWLEDGE_SOURCE_TYPES = [
  "project-policy",
  "agent-instructions",
  "skill",
  "architecture-doc",
  "cli-doc",
  "framework-doc",
  "security-doc",
  "runbook",
  "learning-journal",
  "project-doc",
  "typescript-source",
  "example",
  "pdf"
] as const;

/** Union of all recognized knowledge source category strings. */
export type KnowledgeSourceType = (typeof KNOWLEDGE_SOURCE_TYPES)[number];

/**
 * Strategy used to split a file's content into indexable chunks.
 *
 * - `"markdown-heading"` — splits on H1–H6 headings; code fences are never
 *   treated as split points; falls back to `"fallback"` for oversized sections
 *   or files with no headings.
 * - `"typescript-ast"` — regex-based top-level symbol extraction (export class /
 *   interface / type / function / const / enum); falls back to `"fallback"` when
 *   no symbols are found.
 * - `"fallback"` — sliding-window text split with newline/space boundary
 *   preference and configurable overlap.
 */
export type ChunkingStrategy = "markdown-heading" | "typescript-ast" | "fallback";

/**
 * Structured metadata attached to each `KnowledgeChunk`.
 *
 * Values are limited to JSON-safe primitives so chunks serialize without
 * custom revivers. String arrays allow multi-value fields such as heading
 * paths stored before normalization. `null` is permitted as an explicit
 * "absent" marker that is cheaper than an optional field in dense tables.
 */
export type KnowledgeChunkMetadata = Record<string, string | number | boolean | null | string[]>;

/**
 * Bounded unit of indexed project knowledge produced by the chunking pipeline.
 *
 * A `KnowledgeChunk` carries enough provenance to detect staleness (file and
 * content hashes), reconstruct its position within the source file (chunkIndex,
 * headingPath, symbolName), and store or retrieve it without re-reading the
 * original file. Embeddings are computed from `content` and stored separately
 * by the index storage layer.
 *
 * @example
 * ```typescript
 * import { dispatchChunker } from "@maharudra/agentic-ai-infra-runtime";
 *
 * const chunks = dispatchChunker({
 *   filePath: "docs/04-core-framework/retrieval-providers.md",
 *   sourceType: "framework-doc",
 *   fileHash: "abc123",
 *   content: markdownContent
 * });
 *
 * for (const chunk of chunks) {
 *   console.log(chunk.chunkId);        // SHA-256 derived stable id
 *   console.log(chunk.headingPath);    // ["Retrieval Providers", "Embedding Providers"]
 *   console.log(chunk.tokenEstimate);  // heuristic: ceil(content.length / 4)
 * }
 * ```
 */
export type KnowledgeChunk = {
  /** Stable SHA-256–derived id combining filePath, chunkIndex, and contentHash prefix. */
  readonly chunkId: string;
  /** Project-relative file path that produced this chunk. */
  readonly filePath: string;
  /** Source category used for routing and scoring. */
  readonly sourceType: KnowledgeSourceType;
  /** SHA-256 hex digest of the whole file at index time; used for freshness checks. */
  readonly fileHash: string;
  /** Zero-based position of this chunk within its source file. */
  readonly chunkIndex: number;
  /**
   * Ordered heading ancestry at the point where this chunk starts.
   *
   * Present only for `markdown-heading` chunks. Example:
   * `["Retrieval Providers", "Embedding Providers", "MockEmbeddingProvider"]`
   */
  readonly headingPath?: readonly string[];
  /**
   * Name of the TypeScript symbol this chunk represents.
   *
   * Present only for `typescript-ast` chunks; matches the identifier in the
   * export declaration (e.g. `"LocalEmbeddingProvider"`, `"EmbeddingResult"`).
   */
  readonly symbolName?: string;
  /** Raw text content of this chunk; passed to `EmbeddingProvider.embedBatch`. */
  readonly content: string;
  /** SHA-256 hex digest of `content`; used for per-chunk freshness checks. */
  readonly contentHash: string;
  /** Strategy that produced this chunk. */
  readonly chunkingStrategy: ChunkingStrategy;
  /** Heuristic token count: `Math.max(1, Math.ceil(content.length / 4))`. */
  readonly tokenEstimate: number;
  /** Provider- and strategy-specific extra fields. Never contains secrets or raw paths. */
  readonly metadata: KnowledgeChunkMetadata;
};

/**
 * All reasons the scanner may skip a file before reading its content.
 *
 * The scanner records a reason for every skipped entry in `KnowledgeScanReport`
 * so operators can diagnose over-aggressive blocking policies without guessing.
 */
export type KnowledgeScanSkipReason =
  | "blocked-dir"         // path segment is in the blocked-directory list
  | "blocked-filename"    // filename matches a blocked-filename pattern (.env*, *.key, …)
  | "sensitive-path"      // path matches the sensitive-path regex (secret, token, credential, …)
  | "unsupported-extension" // not .md, .ts, or .tsx
  | "symlink"             // lstat reports a symbolic link; never followed
  | "file-too-large"      // file exceeds MAX_FILE_BYTES (512 KB)
  | "too-many-files"      // reached MAX_SCAN_FILES (500) before this entry
  | "read-error"          // I/O error when reading file content
  | "policy-error";       // other policy violation detected after path checks passed

/**
 * One file entry in a `KnowledgeScanReport`.
 *
 * Entries with `status: "included"` carry a file hash and size; entries with
 * `status: "skipped"` carry only the reason. Use `IncludedKnowledgeScanFile`
 * when you need the narrowed included shape.
 */
export type KnowledgeScanFile = {
  /** Project-relative normalized POSIX path. */
  readonly filePath: string;
  /** Whether this file passed all policy checks. */
  readonly status: "included" | "skipped";
  /** Source type classification; present only for `status: "included"`. */
  readonly sourceType?: KnowledgeSourceType;
  /** Skip reason; present only for `status: "skipped"`. */
  readonly skipReason?: KnowledgeScanSkipReason;
  /** SHA-256 hex digest of file content; present only for `status: "included"`. */
  readonly fileHash?: string;
  /** Byte size of the file; present only for `status: "included"`. */
  readonly fileSizeBytes?: number;
};

/**
 * `KnowledgeScanFile` narrowed to the included case.
 *
 * All optional fields are guaranteed non-nullish so callers that iterate only
 * included files do not need null-guards on `sourceType`, `fileHash`, or
 * `fileSizeBytes`.
 */
export type IncludedKnowledgeScanFile = KnowledgeScanFile & {
  readonly status: "included";
  readonly sourceType: KnowledgeSourceType;
  readonly fileHash: string;
  readonly fileSizeBytes: number;
};

/**
 * Aggregate result of a project file scan.
 *
 * The report contains hashes but never raw file content. It is safe to log or
 * include in observability summaries. The `files` array contains one entry per
 * discovered file (both included and skipped), enabling operators to review
 * exactly what the indexer would process.
 */
export type KnowledgeScanReport = {
  /** Absolute path to the root that was scanned. */
  readonly projectRoot: string;
  /** ISO-8601 timestamp of when the scan completed. */
  readonly scannedAt: string;
  /** All discovered entries (included + skipped). */
  readonly files: readonly KnowledgeScanFile[];
  /** Count of files that passed all policy checks. */
  readonly includedCount: number;
  /** Count of files that were skipped for any reason. */
  readonly skippedCount: number;
  /** Total bytes across all included files; used for budget estimation. */
  readonly totalBytesIncluded: number;
};

/**
 * Output summary returned by `indexProjectKnowledge`.
 *
 * Contains only aggregate counts and provenance metadata — no chunk content,
 * no vectors, no SQL, no file paths beyond the project root. Safe to return
 * to callers, log, or include in dashboard snapshots.
 */
export type KnowledgeIndexSummary = {
  /** ISO-8601 timestamp when indexing completed. */
  readonly indexedAt: string;
  /** Absolute project root that was indexed. */
  readonly projectRoot: string;
  /** Number of files successfully scanned and chunked. */
  readonly filesIndexed: number;
  /** Number of files skipped (policy + freshness checks). */
  readonly filesSkipped: number;
  /** Number of new chunks written to the index. */
  readonly chunksCreated: number;
  /** Number of chunks skipped because they were already up-to-date. */
  readonly chunksSkipped: number;
  /** Number of embedding vectors computed and stored. */
  readonly embeddingsCreated: number;
  /** Number of files where an error occurred; those files are omitted from the index. */
  readonly fileErrorCount: number;
  /**
   * Composite index version from the embedding provider.
   *
   * Format: `<model>:<version>:dim<dimension>`. Consumers compare this against
   * stored chunk provenance to detect stale indexes that need re-embedding.
   */
  readonly indexVersion: string;
};
