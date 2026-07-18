export const MOCK_EMBEDDING_MODEL = "rudraloka-mock-embedding";
export const MOCK_EMBEDDING_VERSION = "mock-embedding-v1";
export const MOCK_EMBEDDING_DIMENSION = 64;
export const MOCK_EMBEDDING_HNSW_M = 8;
export const MOCK_EMBEDDING_HNSW_EF_CONSTRUCTION = 32;

/**
 * Mock embeddings are free, deterministic, and local-only.
 *
 * They validate scanner, chunker, storage, indexing, migration, and eval
 * plumbing without API keys, network calls, or paid provider usage. They are not
 * semantically meaningful, so retrieval quality must not be judged from this
 * provider. A future real provider may use a different dimension and must use a
 * separately versioned embedding model/version plus a reviewed migration path.
 */
export const MOCK_EMBEDDING_INDEX_VERSION =
  `${MOCK_EMBEDDING_MODEL}:${MOCK_EMBEDDING_VERSION}:dim${MOCK_EMBEDDING_DIMENSION}`;
