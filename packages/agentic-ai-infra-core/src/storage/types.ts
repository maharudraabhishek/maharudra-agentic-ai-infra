import type { FrameworkResult } from "../errors/index.js";
import type { EmbeddingResult, KnowledgeChunk, KnowledgeIndexSummary } from "../retrieval/types.js";

/**
 * Storage provider kinds supported by core contracts.
 *
 * - `"postgres"` — persistent Postgres-backed storage with pgvector support.
 * - `"memory"` — in-memory provider for the vectorless-local profile. No persistence — data is lost on restart.
 * - `"filesystem"` — reserved; not yet implemented. The validator rejects it with `config.filesystem-storage-not-implemented`.
 * - `"custom"` — caller-supplied extension provider.
 */
export type StorageProviderType =
  | "memory"
  | "filesystem"
  | "postgres"
  | "custom";

/** Configuration for one storage provider. */
export type StorageProviderConfig = {
  readonly id: string;
  readonly type: StorageProviderType;
  readonly connectionRef?: string;
  readonly localPath?: string;
  readonly capabilities?: readonly string[];
  readonly extension?: boolean;
};

/** Project storage configuration. */
export type StorageConfig = {
  readonly providers: readonly StorageProviderConfig[];
  readonly defaultProviderId?: string;
};

/** Result of a storage provider health check. */
export type StorageHealth = {
  readonly providerId: string;
  readonly ready: boolean;
  readonly message?: string;
};

/** Storage provider interface used by runtime implementations. */
export interface StorageProvider {
  readonly id: string;
  readonly type: StorageProviderType;
  /** Checks whether the provider is currently usable. */
  healthCheck(): Promise<FrameworkResult<StorageHealth>>;

  /**
   * Releases all resources held by this storage provider.
   *
   * For in-memory providers, clears internal state.
   * For Postgres providers, drains the connection pool.
   *
   * Must be called before process exit. Calling close() more than once
   * must be safe (idempotent).
   */
  close(): Promise<void>;
}

/**
 * Extended storage capability for persisting indexed knowledge.
 *
 * Framework users implementing custom storage providers can satisfy this
 * interface to enable knowledge persistence from `indexProjectKnowledge`.
 * The runtime detects this capability at runtime via duck-type check in
 * `hasIndexStorageCapability()` — no explicit registration is required.
 *
 * Implementors MUST NOT log or echo `indexVersion` values into user-visible
 * surfaces other than telemetry or structured audit logs.
 *
 * @example
 * ```typescript
 * class MyStorageProvider implements StorageProvider, KnowledgeIndexStorageCapability {
 *   async lookupIndexedFileHash(relativePath, indexVersion) { ... }
 *   async storeKnowledgeChunks(chunks, embeddings) { ... }
 *   async recordIndexRun(summary) { ... }
 * }
 * ```
 */
export interface KnowledgeIndexStorageCapability {
  /**
   * Returns the stored file hash for a given path + index version, or `null`
   * if the file has not been indexed under that version.
   *
   * Used for pre-chunking freshness checks in `indexProjectKnowledge`. When the
   * stored hash matches the current file hash, the file is up-to-date and
   * chunking can be skipped.
   *
   * @param relativePath - Project-relative POSIX path of the file.
   * @param indexVersion - Version string from the embedding provider, format:
   *   `<model>:<version>:dim<dimension>`.
   * @returns Stored SHA-256 hex digest, or `null` if not found.
   */
  lookupIndexedFileHash(relativePath: string, indexVersion: string): Promise<string | null>;

  /**
   * Stores a set of chunks together with their embedding vectors.
   *
   * `chunks` and `embeddings` are parallel arrays: `embeddings[i]` corresponds
   * to `chunks[i]`. Implementations must handle partial failures gracefully
   * and must not throw on individual chunk insert errors.
   *
   * @param chunks - Knowledge chunks produced by the chunking pipeline.
   * @param embeddings - Embedding vectors corresponding to each chunk.
   */
  storeKnowledgeChunks(
    chunks: readonly KnowledgeChunk[],
    embeddings: readonly EmbeddingResult[]
  ): Promise<void>;

  /**
   * Records a completed index run for observability and audit.
   *
   * Called after `indexProjectKnowledge` completes. The summary contains only
   * aggregate counts and provenance metadata — no chunk content, no vectors,
   * no raw file paths. Implementations should not throw; a recording failure
   * must not block or invalidate the index run.
   *
   * @param summary - Aggregate result of the completed index run.
   */
  recordIndexRun(summary: KnowledgeIndexSummary): Promise<void>;

  /**
   * Returns all stored chunks, optionally filtered to a single file path.
   *
   * Used by retrieval providers (FullTextProvider, DocumentTreeProvider,
   * SymbolCodeProvider, etc.) to load a corpus for in-memory scoring.
   *
   * - `InMemoryStorageProvider` resolves from its Maps — effectively sync.
   * - `PostgresStorageProvider` runs a SQL JOIN of `agentic_chunks` and
   *   `agentic_sources` and returns all matching rows mapped to `KnowledgeChunk`.
   * - Custom providers return chunks from wherever they store them.
   *
   * Providers call this method and score in-memory over the returned chunks.
   * FullTextProvider and PgVectorProvider also have optimized SQL paths (using
   * tsvector and pgvector <=> respectively) that bypass this call when a
   * `QueryableDatabase` is directly accessible; the `getChunks()` path is used
   * for all other providers and for connection-string (pool) Postgres instances.
   *
   * DECISION — async interface: PostgreSQL queries are inherently async. Changing
   * this signature from sync to `Promise<KnowledgeChunk[]>` lets Postgres run the
   * SQL query here rather than duplicating it in every provider. The in-memory
   * path wraps with `Promise.resolve()` (trivial overhead). All call sites are
   * inside async `retrieve()` methods so `await` adds no complexity.
   *
   * @param filePath - Optional project-relative POSIX path. When provided, only
   *   chunks belonging to that file are returned.
   * @returns All matching stored chunks, or `[]` if no chunks are stored.
   */
  getChunks(filePath?: string): Promise<KnowledgeChunk[]>;
}
