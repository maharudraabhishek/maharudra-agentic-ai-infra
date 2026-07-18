-- Milestone 3 mock embedding storage index.
--
-- This migration prepares the local-only pgvector column and a conservative
-- HNSW index for validating the mock embedding pipeline. It does not add
-- retrieval tools, full-text search, query tuning, production tuning, paid
-- providers, or real semantic quality.
--
-- HNSW can use more memory than IVFFlat. The settings below are intentionally
-- small local-development defaults for 64-d mock embeddings:
--   m = 8
--   ef_construction = 32
--
-- Exact vector scans remain possible by disabling index scans in an explicit
-- troubleshooting SQL session later; no MCP arbitrary SQL tool is added here.
-- A future real embedding provider may need a new embedding version, different
-- dimensions, a different partial index, and a separate reviewed migration.

do $$
begin
  if to_regclass('local_ai.rag_embeddings') is null then
    raise exception 'Milestone 3 migration requires local_ai.rag_embeddings from migration 001.';
  end if;

  -- Fail closed before changing the column type. Existing vectors must already
  -- be 64-dimensional or null; this migration never truncates, pads, coerces, or
  -- silently rewrites incompatible embedding data.
  if exists (
    select 1
    from local_ai.rag_embeddings
    where embedding is not null
      and vector_dims(embedding) <> 64
  ) then
    raise exception 'Cannot convert rag_embeddings.embedding to vector(64): incompatible existing embeddings are present.';
  end if;
end $$;

alter table local_ai.rag_embeddings
  alter column embedding type vector(64)
  using embedding::vector(64);

create index if not exists rag_embeddings_mock_hnsw_idx
  on local_ai.rag_embeddings
  using hnsw (embedding vector_cosine_ops)
  with (m = 8, ef_construction = 32)
  where embedding_model = 'rudraloka-mock-embedding'
    and embedding_version = 'mock-embedding-v1'
    and embedding_dimension = 64
    and embedding is not null;
