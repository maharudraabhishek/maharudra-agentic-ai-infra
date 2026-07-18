-- Rudraloka local development AI infrastructure schema.
--
-- This schema is for local MCP Agentic Context Engineering + RAG work only.
-- No production data, customer data, credentials, tokens, private keys, or
-- other secrets should ever be copied into these tables.
--
-- Vector indexes are intentionally not created in this base migration. HNSW
-- remains the future target, but it should be added later with memory-conscious
-- tuning after chunking, embedding dimensions, and retrieval behavior are
-- stable.

create schema if not exists local_ai;

create table if not exists local_ai.schema_migrations (
  version text primary key,
  name text not null,
  checksum text not null,
  applied_at timestamptz not null default now()
);

create table if not exists local_ai.rag_index_runs (
  id uuid primary key,
  index_version text not null,
  status text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  files_scanned integer not null default 0,
  files_indexed integer not null default 0,
  chunks_created integer not null default 0,
  chunks_embedded integer not null default 0,
  error_message text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists local_ai.rag_documents (
  id uuid primary key,
  file_path text not null,
  source_type text not null,
  file_hash text not null,
  content_hash text not null,
  indexed_at timestamptz not null default now(),
  index_version text not null,
  is_archived boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  constraint rag_documents_file_content_index_unique
    unique (file_path, content_hash, index_version)
);

create table if not exists local_ai.rag_chunks (
  id uuid primary key,
  document_id uuid not null references local_ai.rag_documents(id) on delete cascade,
  chunk_index integer not null,
  heading_path text,
  symbol_name text,
  content text not null,
  content_hash text not null,
  chunking_strategy text not null,
  token_estimate integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint rag_chunks_document_index_content_unique
    unique (document_id, chunk_index, content_hash)
);

create table if not exists local_ai.rag_embeddings (
  id uuid primary key,
  chunk_id uuid not null references local_ai.rag_chunks(id) on delete cascade,
  -- Use pgvector's dimension-flexible vector type for the base schema.
  -- The mock provider and any future real provider can choose dimensions later
  -- without forcing a premature table rewrite during Milestone 1.
  embedding vector,
  embedding_model text not null,
  embedding_dimension integer not null,
  embedding_version text not null,
  content_hash text not null,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint rag_embeddings_chunk_model_version_content_unique
    unique (chunk_id, embedding_model, embedding_version, content_hash)
);

create table if not exists local_ai.rag_retrieval_evals (
  id uuid primary key,
  eval_name text not null,
  query text not null,
  expected_sources jsonb not null default '[]'::jsonb,
  actual_sources jsonb not null default '[]'::jsonb,
  status text not null,
  score numeric,
  ran_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);
