-- Milestone 4 local project knowledge retrieval search support.
--
-- This migration is local-only. It adds Postgres full-text search support and
-- read/query indexes for the existing mock knowledge index. It does not run
-- retrieval, mutate source files, change embedding dimensions, or modify the
-- Milestone 3 HNSW index.

do $$
begin
  if to_regclass('local_ai.rag_documents') is null
     or to_regclass('local_ai.rag_chunks') is null
     or to_regclass('local_ai.rag_embeddings') is null then
    raise exception 'Milestone 4 retrieval migration requires local_ai RAG tables from migration 001.';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'local_ai'
      and table_name = 'rag_chunks'
      and column_name = 'search_vector'
      and udt_name <> 'tsvector'
  ) then
    raise exception 'Cannot add retrieval search_vector: local_ai.rag_chunks.search_vector already exists with an unexpected type.';
  end if;
end $$;

alter table local_ai.rag_chunks
  add column if not exists search_vector tsvector
  generated always as (
    to_tsvector(
      'simple',
      coalesce(heading_path, '') || ' ' ||
      coalesce(symbol_name, '') || ' ' ||
      coalesce(content, '')
    )
  ) stored;

create index if not exists rag_chunks_search_vector_gin_idx
  on local_ai.rag_chunks
  using gin (search_vector);

create index if not exists rag_documents_retrieval_filters_idx
  on local_ai.rag_documents
  (index_version, is_archived, source_type, file_path);

create index if not exists rag_chunks_document_id_idx
  on local_ai.rag_chunks (document_id);

create index if not exists rag_embeddings_mock_retrieval_idx
  on local_ai.rag_embeddings
  (chunk_id, embedding_model, embedding_version, embedding_dimension)
  where embedding_model = 'rudraloka-mock-embedding'
    and embedding_version = 'mock-embedding-v1'
    and embedding_dimension = 64;
