/**
 * Stable identity constants for the built-in mock embedding provider.
 *
 * These constants govern the model name, version string, vector dimensions,
 * and pgvector HNSW index parameters used by `MockEmbeddingProvider`.
 *
 * IMPORTANT — changing any value below invalidates previously indexed data:
 *
 * - `MOCK_EMBEDDING_MODEL` or `MOCK_EMBEDDING_VERSION` change → all stored
 *   vectors were produced under a different provider identity. The framework
 *   uses model:version as an index generation key; mismatches signal stale
 *   chunks that must be re-embedded before semantic queries are reliable.
 *
 * - `MOCK_EMBEDDING_DIMENSION` changes → existing pgvector columns have the
 *   wrong vector length. The schema migration for the vector column specifies
 *   the dimension explicitly; changing the dimension requires a new migration
 *   and a full re-embedding run.
 *
 * - `MOCK_EMBEDDING_HNSW_M` or `MOCK_EMBEDDING_HNSW_EF_CONSTRUCTION` change →
 *   existing HNSW indexes were built with different graph parameters. Changed
 *   parameters require a `REINDEX` before recall guarantees apply. Values here
 *   define the baseline for any future framework-generated pgvector HNSW DDL.
 *
 * Treat the combination of model, version, and dimension as a composite
 * "index generation key". Bump `MOCK_EMBEDDING_VERSION` whenever the hash
 * function, normalization algorithm, or dimension changes so downstream index
 * consumers can detect the mismatch and trigger re-indexing.
 */

/** Model name included in every `EmbeddingResult.model` from `MockEmbeddingProvider`. */
export const MOCK_EMBEDDING_MODEL = "agentic-ai-infra-mock-embedding" as const;

/**
 * Version string included in every `EmbeddingResult.version` from
 * `MockEmbeddingProvider`.
 *
 * Bump this value whenever the SHA-256 derivation, normalization logic, or
 * output dimension changes so consumers can detect stale stored vectors.
 *
 * Bumped to mock-embedding-v2 in Stage 20 when the dimension changed from 64
 * to 1024. Any stored vector indexed under v1 must be re-embedded — the
 * framework detects this via the embedding_dimension field in agentic_index_runs.
 */
export const MOCK_EMBEDDING_VERSION = "mock-embedding-v2" as const;

/**
 * Vector dimension produced by `MockEmbeddingProvider`.
 *
 * 1024 matches the mxbai-embed-large output dimension and the production
 * pgvector schema (migration 005). Mock vectors remain deterministic SHA-256
 * with no network dependency — only the output array length changed from 64.
 */
export const MOCK_EMBEDDING_DIMENSION = 1024 as const;

/**
 * HNSW `m` parameter recommended for pgvector indexes over mock vectors.
 *
 * `m` controls the number of bi-directional links per node in the HNSW graph.
 * Lower values reduce index build time and memory use; values below 4 can
 * degrade recall for nearest-neighbour comparisons.
 *
 * 16 is the recommended lower bound for high-dimensional HNSW indexes
 * (d ≥ 768). More bi-directional links per node preserve recall in larger
 * vector spaces at the cost of slightly larger index memory.
 */
export const MOCK_EMBEDDING_HNSW_M = 16 as const;

/**
 * HNSW `ef_construction` parameter recommended for pgvector indexes over mock
 * vectors.
 *
 * Controls the dynamic candidate-list size during index construction. Higher
 * values improve recall at the cost of build time.
 *
 * ef_construction=64 for 1024-dim vectors is a conservative baseline
 * balancing index build time and recall on a local development machine.
 */
export const MOCK_EMBEDDING_HNSW_EF_CONSTRUCTION = 64 as const;

/**
 * Composite index version key for detecting stale pgvector indexes.
 *
 * Format: `<model>:<version>:dim<dimension>`.
 *
 * Any stored vector whose provenance string does not match this key was
 * produced by a different model, version, or dimension and must be re-indexed
 * before semantic search results are reliable.
 */
export const MOCK_EMBEDDING_INDEX_VERSION =
  `${MOCK_EMBEDDING_MODEL}:${MOCK_EMBEDDING_VERSION}:dim${MOCK_EMBEDDING_DIMENSION}` as const;
