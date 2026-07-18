-- Phase 2 only enables the pgvector extension for the local database runtime.
-- Milestone 1 schema tables live in reviewed migrations under infra/db/local-ai.
-- HNSW, IVFFlat, and other vector indexes come later after chunks and
-- embeddings exist.
CREATE EXTENSION IF NOT EXISTS vector;
