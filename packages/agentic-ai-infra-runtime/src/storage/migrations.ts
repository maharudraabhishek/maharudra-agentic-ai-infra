import { createHash } from "node:crypto";

/**
 * One reviewed framework migration.
 */
export type FrameworkMigration = {
  readonly id: string;
  readonly description: string;
  readonly sql: string;
};

/**
 * Exact approval text required before the framework migration runner can mutate
 * a database schema.
 */
export const RUN_AGENTIC_AI_INFRA_MIGRATIONS = "RUN_AGENTIC_AI_INFRA_MIGRATIONS";

/**
 * Reviewed framework migrations for the neutral AI context schema.
 *
 * The SQL is stored as framework-owned migration content and is never exposed as
 * an arbitrary SQL tool. Runtime startup and status discovery read these
 * definitions without executing them.
 */
export const FRAMEWORK_MIGRATIONS: readonly FrameworkMigration[] = [
  {
    id: "001_agentic_context_foundation",
    description: "Sources, documents, chunks, freshness, cache, trace, and audit metadata.",
    sql: `
create extension if not exists vector;

create table if not exists agentic_sources (
  source_id text primary key,
  source_type text not null,
  label text not null,
  source_version text,
  content_hash text,
  archived boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists agentic_documents (
  document_id text primary key,
  source_id text not null references agentic_sources(source_id) on delete cascade,
  title text not null,
  safe_path text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists agentic_chunks (
  chunk_id text primary key,
  document_id text not null references agentic_documents(document_id) on delete cascade,
  source_id text not null references agentic_sources(source_id) on delete cascade,
  ordinal integer not null,
  heading_path text[] not null default '{}',
  preview text not null,
  content text not null,
  token_estimate integer,
  metadata jsonb not null default '{}'::jsonb,
  search_vector tsvector generated always as (to_tsvector('english', coalesce(content, ''))) stored
);

create index if not exists agentic_chunks_search_idx on agentic_chunks using gin(search_vector);
create index if not exists agentic_chunks_source_idx on agentic_chunks(source_id);

create table if not exists agentic_cache_metadata (
  cache_key text primary key,
  source_version text,
  content_hash text,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create table if not exists agentic_trace_events (
  trace_id text not null,
  span_id text not null,
  name text not null,
  attributes jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (trace_id, span_id)
);

create table if not exists agentic_audit_events (
  audit_id text primary key,
  trace_id text,
  action text not null,
  decision text not null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
`
  },
  {
    id: "002_agentic_retrieval_surfaces",
    description: "Embedding metadata/vector storage, document tree, page index, symbols, graph, eval, and token metrics.",
    sql: `
create table if not exists agentic_embeddings (
  embedding_id text primary key,
  chunk_id text not null references agentic_chunks(chunk_id) on delete cascade,
  provider_id text not null,
  model_id text not null,
  dimensions integer not null,
  embedding vector(32),
  is_mock boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists agentic_document_tree_nodes (
  node_id text primary key,
  document_id text not null references agentic_documents(document_id) on delete cascade,
  parent_node_id text,
  heading text not null,
  depth integer not null,
  ordinal integer not null,
  chunk_id text references agentic_chunks(chunk_id) on delete set null,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists agentic_page_index_sections (
  section_id text primary key,
  document_id text not null references agentic_documents(document_id) on delete cascade,
  page_label text,
  heading text not null,
  ordinal integer not null,
  chunk_id text references agentic_chunks(chunk_id) on delete set null,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists agentic_symbol_index_entries (
  symbol_id text primary key,
  source_id text not null references agentic_sources(source_id) on delete cascade,
  symbol_name text not null,
  symbol_kind text not null,
  safe_path text,
  line_number integer,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists agentic_graph_nodes (
  graph_node_id text primary key,
  node_type text not null,
  label text not null,
  source_id text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists agentic_graph_edges (
  graph_edge_id text primary key,
  from_node_id text not null references agentic_graph_nodes(graph_node_id) on delete cascade,
  to_node_id text not null references agentic_graph_nodes(graph_node_id) on delete cascade,
  relationship text not null,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists agentic_eval_history (
  eval_id text primary key,
  suite_name text not null,
  status text not null,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists agentic_token_usage_metrics (
  metric_id text primary key,
  trace_id text,
  input_tokens integer not null,
  output_tokens integer not null,
  total_tokens integer not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
`
  },
  {
    id: "003_agentic_embedding_dimension_fix",
    description:
      "fixes vector(32→64) mismatch, adds HNSW index, adds agentic_index_runs. Deletes existing embeddings (dev data loss, intentional).",
    sql: `
DELETE FROM agentic_embeddings;

ALTER TABLE agentic_embeddings
  ALTER COLUMN embedding TYPE vector(64);

CREATE INDEX IF NOT EXISTS agentic_embeddings_hnsw_idx
  ON agentic_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 8, ef_construction = 32);

CREATE TABLE IF NOT EXISTS agentic_index_runs (
  run_id        text PRIMARY KEY,
  started_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  status        text NOT NULL DEFAULT 'running',
  index_version text NOT NULL DEFAULT '1',
  files_scanned integer NOT NULL DEFAULT 0,
  files_indexed integer NOT NULL DEFAULT 0,
  chunks_created integer NOT NULL DEFAULT 0,
  embeddings_created integer NOT NULL DEFAULT 0,
  file_error_count integer NOT NULL DEFAULT 0,
  embedding_provider text,
  embedding_dimension integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
`
  },
  /**
   * Migration 004 — `agentic_sessions`, `agentic_threads`, `agentic_tool_calls`.
   *
   * Implements the Layer 4 (Session & Thread State) schema surface of the v3
   * architecture. Provides the database foundation for session continuity,
   * multi-turn thread tracking, and per-call observability. No runtime code
   * reads or writes these tables yet; the schema is deployed first so that
   * Layer 4 runtime code can be added without a later blocking migration.
   *
   * ### Why sessions and threads are separate tables
   *
   * A session represents a single runtime connection lifecycle — one client
   * process, one project identity, one runtime mode (local-stdio-mcp,
   * remote-http-mcp, api-service). A thread represents a distinct user goal
   * pursued within that session. One session can host many threads: e.g. a
   * developer session spanning code search, doc lookup, and context builds.
   * Keeping them separate preserves the 1-to-N cardinality and allows thread
   * status to be queried or updated independently of session state.
   *
   * ### CASCADE delete rationale
   *
   * `agentic_threads` declares `REFERENCES agentic_sessions ON DELETE CASCADE`
   * and `agentic_tool_calls` declares `REFERENCES agentic_threads ON DELETE
   * CASCADE`. When a session is purged (e.g. by a retention policy), all of
   * its threads and their call records are logically dead. CASCADE removes them
   * atomically, prevents orphaned rows, and keeps the schema referentially
   * sound without requiring multi-step application-layer deletes.
   *
   * ### Index strategy
   *
   * - `agentic_sessions_project_idx` — filters sessions by `project_id`,
   *   the most common predicate (list all sessions for a project).
   * - `agentic_sessions_status_idx` — composite `(status, last_seen_at DESC)`
   *   so "active sessions sorted by recency" queries avoid a full table scan.
   * - `agentic_threads_session_idx` — locates all threads for a session in
   *   O(log n); used by context-build and thread-list queries.
   * - `agentic_tool_calls_thread_idx` — composite `(thread_id, started_at DESC)`
   *   for chronological tool-call history per thread; supports dashboard
   *   timeline views without sorting on an unindexed column.
   */
  {
    id: "004_agentic_session_thread_state",
    description: "Adds session, thread, and tool-call tracking tables for Layer 4.",
    sql: `
CREATE TABLE IF NOT EXISTS agentic_sessions (
  session_id    TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL,
  client        TEXT NOT NULL,
  runtime_mode  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata      JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS agentic_sessions_project_idx
  ON agentic_sessions (project_id);

CREATE INDEX IF NOT EXISTS agentic_sessions_status_idx
  ON agentic_sessions (status, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS agentic_threads (
  thread_id      TEXT PRIMARY KEY,
  session_id     TEXT NOT NULL REFERENCES agentic_sessions(session_id) ON DELETE CASCADE,
  user_goal      TEXT NOT NULL,
  active_task    TEXT,
  state_summary  TEXT,
  status         TEXT NOT NULL DEFAULT 'open',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agentic_threads_session_idx
  ON agentic_threads (session_id);

CREATE TABLE IF NOT EXISTS agentic_tool_calls (
  call_id        TEXT PRIMARY KEY,
  thread_id      TEXT NOT NULL REFERENCES agentic_threads(thread_id) ON DELETE CASCADE,
  tool_name      TEXT NOT NULL,
  input_hash     TEXT NOT NULL,
  output_hash    TEXT,
  status         TEXT NOT NULL DEFAULT 'pending',
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at   TIMESTAMPTZ,
  error_code     TEXT,
  token_estimate INTEGER
);

CREATE INDEX IF NOT EXISTS agentic_tool_calls_thread_idx
  ON agentic_tool_calls (thread_id, started_at DESC);
`
  },
  /**
   * Migration 005 — `agentic_embeddings` column widened from `vector(64)` to
   * `vector(1024)` to support mxbai-embed-large (1024-dimensional output).
   *
   * ### Why embeddings are deleted
   *
   * Existing 64-dim stored vectors cannot be cast to 1024-dim — Postgres has
   * no implicit cast between different-length vector types. A DELETE + ALTER is
   * the only safe path. All chunks must be re-embedded from their source content
   * after this migration runs. This mirrors the migration 003 precedent (32→64
   * deletion was acceptable in local dev). Production deployments must schedule
   * a re-embedding job before applying this migration.
   *
   * ### HNSW parameter rationale
   *
   * `m=16` is the minimum recommended for `d≥768`; the original `m=8` was
   * appropriate for 64-dim vectors. `ef_construction=64` balances build time
   * vs index recall quality for a local development machine.
   *
   * ### Index rebuild requirement
   *
   * The old HNSW index is dropped and re-created (not `REINDEX`) because the
   * column type change makes the existing index invalid — it was built over a
   * `vector(64)` column and cannot serve a `vector(1024)` column.
   */
  {
    id: "005_agentic_embedding_dimension_1024",
    description:
      "changes agentic_embeddings.embedding from vector(64) to vector(1024) for " +
      "mxbai-embed-large compatibility. Drops and rebuilds the HNSW index with " +
      "m=16 ef_construction=64 (appropriate for d=1024). Deletes existing " +
      "embeddings — dev data loss, intentional (same precedent as migration 003).",
    sql: `
DELETE FROM agentic_embeddings;

DROP INDEX IF EXISTS agentic_embeddings_hnsw_idx;

ALTER TABLE agentic_embeddings
  ALTER COLUMN embedding TYPE vector(1024);

CREATE INDEX IF NOT EXISTS agentic_embeddings_hnsw_idx
  ON agentic_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
`
  }
];

/**
 * Calculates a stable checksum for a reviewed migration definition.
 *
 * Migration status uses the checksum to compare local definitions with applied
 * metadata without exposing full SQL in tool outputs.
 */
export function migrationChecksum(migration: FrameworkMigration): string {
  return createHash("sha256").update(migration.sql).digest("hex");
}
