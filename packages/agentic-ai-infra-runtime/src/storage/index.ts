import { createHash } from "node:crypto";
// pg exports a CJS module; Node ESM interop surfaces its exports as the default.
// We import the runtime value (Pool constructor) alongside the type-only imports.
import pg from "pg";
import type { Pool, PoolClient, PoolConfig } from "pg";
import {
  type ChunkingStrategy,
  type EmbeddingResult,
  type FrameworkError,
  type FrameworkResult,
  type KnowledgeChunk,
  type KnowledgeChunkMetadata,
  type KnowledgeIndexStorageCapability,
  type KnowledgeIndexSummary,
  type KnowledgeSourceType,
  type StorageHealth,
  type StorageProvider,
  ok
} from "@maharudra/agentic-ai-infra-core";
import { recoverable } from "../errors/index.js";
import {
  FRAMEWORK_MIGRATIONS,
  RUN_AGENTIC_AI_INFRA_MIGRATIONS,
  type FrameworkMigration,
  migrationChecksum
} from "./migrations.js";

type QueryResult<Row> = {
  readonly rows: readonly Row[];
};

/**
 * Minimal database interface used by storage code.
 *
 * The abstraction keeps Postgres access injectable and restricts callers to
 * parameterized query execution rather than arbitrary shell or SQL tools.
 */
export type QueryableDatabase = {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[]
  ): Promise<QueryResult<Row>>;
};

/**
 * Read-only migration status returned by discovery.
 */
export type MigrationStatus = {
  readonly id: string;
  readonly description: string;
  readonly checksum: string;
  readonly applied: boolean;
  readonly appliedAt?: string;
};

/**
 * Result of an explicit approved migration run.
 */
export type MigrationRunResult = {
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
};

/**
 * Supplies the reviewed framework migration list to storage services.
 *
 * The provider abstraction keeps migration discovery deterministic in tests and
 * lets future packages swap the migration source without changing the runner.
 */
export class StaticMigrationProvider {
  /**
   * Accepts an explicit migration list or falls back to the built-in framework
   * migrations that cover the supported retrieval and context surfaces.
   */
  constructor(private readonly migrations: readonly FrameworkMigration[] = FRAMEWORK_MIGRATIONS) {}

  /**
   * Returns migration definitions without executing SQL.
   *
   * Discovery and status checks call this method because listing migrations is
   * safe and non-mutating.
   */
  list(): readonly FrameworkMigration[] {
    return this.migrations;
  }
}

/**
 * In-memory storage provider for the vectorless-local profile.
 *
 * Stores indexed knowledge entirely in Maps — no database, no I/O, no Docker
 * required. Data is lost when the process exits; use `PostgresStorageProvider`
 * for persistence across sessions.
 *
 * Satisfies the same duck-type surface as `PostgresStorageProvider`:
 * `StorageProvider` + `KnowledgeIndexStorageCapability`. Used automatically
 * when the resolved profile config declares `storage.type = "memory"`.
 *
 * @example
 * const storage = new InMemoryStorageProvider("in-memory-store");
 * const health = await storage.healthCheck(); // always ready
 */
export class InMemoryStorageProvider implements StorageProvider, KnowledgeIndexStorageCapability {
  readonly type = "memory" as const;

  /** Latest file hash per project-relative file path. */
  private readonly fileHashes = new Map<string, string>();

  /** Indexed chunks per project-relative file path. */
  private readonly fileChunks = new Map<string, KnowledgeChunk[]>();

  #closed = false;

  constructor(readonly id: string) {}

  /** Always returns ready — no I/O to perform. */
  async healthCheck(): Promise<FrameworkResult<StorageHealth>> {
    return ok({ providerId: this.id, ready: true, message: "In-memory store is ready." });
  }

  /** Returns an empty list — no migrations apply to in-memory storage. */
  async discoverMigrationStatus(): Promise<FrameworkResult<readonly MigrationStatus[]>> {
    return ok([]);
  }

  /** No-op — in-memory storage has no schema to migrate. */
  async runMigrations(_approvalText: string): Promise<FrameworkResult<MigrationRunResult>> {
    return ok({ applied: [], skipped: [] });
  }

  /** No-op — in-memory storage has no vector column dimension to validate. */
  async assertEmbeddingDimension(_dimension: number): Promise<void> {
    // In-memory store has no schema column, so any dimension is accepted.
  }

  /** Clears all stored hashes and chunks. Idempotent — safe to call more than once. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.fileHashes.clear();
    this.fileChunks.clear();
  }

  // ---------------------------------------------------------------------------
  // KnowledgeIndexStorageCapability
  // ---------------------------------------------------------------------------

  /**
   * Returns the stored file hash for the given path, or `null` if not indexed.
   *
   * `indexVersion` is accepted to satisfy the interface but is not used as a
   * discriminator — the in-memory store holds one hash per file path.
   */
  async lookupIndexedFileHash(relativePath: string, _indexVersion: string): Promise<string | null> {
    return this.fileHashes.get(relativePath) ?? null;
  }

  /**
   * Groups incoming chunks by file path and stores them in the internal Maps.
   *
   * `embeddings` are accepted to satisfy the interface but are not persisted —
   * vectorless-local retrieval operates over raw chunk content, not vectors.
   *
   * @param chunks - Knowledge chunks from the chunking pipeline.
   * @param embeddings - Embedding vectors (unused by this provider).
   */
  async storeKnowledgeChunks(
    chunks: readonly KnowledgeChunk[],
    _embeddings: readonly EmbeddingResult[]
  ): Promise<void> {
    const byFile = new Map<string, KnowledgeChunk[]>();

    for (const chunk of chunks) {
      const group = byFile.get(chunk.filePath) ?? [];
      group.push(chunk);
      byFile.set(chunk.filePath, group);
    }

    for (const [filePath, fileChunks] of byFile) {
      const first = fileChunks[0];

      if (first) {
        this.fileHashes.set(filePath, first.fileHash);
      }

      this.fileChunks.set(filePath, fileChunks);
    }
  }

  /** No-op — run tracking is not needed for in-memory storage. */
  async recordIndexRun(_summary: KnowledgeIndexSummary): Promise<void> {
    // In-memory store discards run metadata — no database or audit sink available.
  }

  /**
   * Returns all stored chunks, optionally filtered to a single file path.
   *
   * Retrieval providers call this to build an in-memory corpus for scoring.
   * Returns chunks directly from the `fileChunks` Map — no I/O; the async
   * signature matches the interface contract (Postgres path requires async).
   *
   * @param filePath - Optional project-relative POSIX path. When provided, only
   *   chunks for that exact file are returned.
   */
  async getChunks(filePath?: string): Promise<KnowledgeChunk[]> {
    if (filePath !== undefined) {
      return this.fileChunks.get(filePath) ?? [];
    }

    const all: KnowledgeChunk[] = [];

    for (const chunks of this.fileChunks.values()) {
      all.push(...chunks);
    }

    return all;
  }
}

/**
 * Postgres-backed storage provider for runtime health, migration, and knowledge
 * index operations.
 *
 * The provider uses dependency inversion: tests can inject a `QueryableDatabase`
 * while real projects can supply a connection string that lazily creates a
 * `pg` pool. No database connection is opened by construction or import.
 *
 * Implements `KnowledgeIndexStorageCapability` so `indexProjectKnowledge` can
 * persist chunks, embeddings, and run metadata to the agentic schema tables
 * created by migrations 001–003.
 */
export class PostgresStorageProvider implements StorageProvider, KnowledgeIndexStorageCapability {
  readonly type = "postgres" as const;
  private pool?: Pool;
  #closed = false;

  /**
   * Creates a Postgres storage provider with either injected database access or
   * a connection string for eager pool creation.
   *
   * When `connectionString` is supplied without an injected `database`, a
   * `pg.Pool` is created in the constructor. Pool construction is side-effect
   * free — no connections are opened until the first query. Eager pool creation
   * allows the `.db` getter to expose a `QueryableDatabase` synchronously so
   * `createRuntimeServiceContainer` can duck-type check for it immediately.
   *
   * @param id - Unique provider id, used in health and status reports.
   * @param params.connectionString - Postgres connection string. Creates a pool
   *   eagerly so `.db` returns a non-null `QueryableDatabase` without awaiting.
   * @param params.database - Injected `QueryableDatabase` for tests or advanced
   *   hosts. When present, no pool is created.
   * @param params.migrationProvider - Override the migration list. Defaults to
   *   `StaticMigrationProvider` with the built-in framework migrations.
   * @param params.pool - Optional pg.PoolConfig overrides. Merged over the
   *   framework defaults (min:2, max:10, idleTimeoutMillis:30000,
   *   connectionTimeoutMillis:5000). Ignored when `database` is injected.
   */
  constructor(
    readonly id: string,
    private readonly params: {
      readonly connectionString?: string;
      readonly database?: QueryableDatabase;
      readonly migrationProvider?: StaticMigrationProvider;
      readonly pool?: PoolConfig;
    } = {}
  ) {
    // Eagerly create the pool when connectionString is provided and no injected
    // database is supplied. This makes `.db` synchronously non-null so the
    // duck-type check in createRuntimeServiceContainer selects
    // PostgresSessionManager without requiring an async initialization step.
    // pg.Pool() does not open connections at construction time.
    if (params.connectionString && !params.database) {
      const poolConfig: PoolConfig = {
        min: 2,
        max: 10,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
        ...params.pool,
        connectionString: params.connectionString,
      };
      this.pool = new pg.Pool(poolConfig);
    }
  }

  /**
   * Exposes the active `QueryableDatabase` for session manager creation.
   *
   * Returns the injected `database` first (test / verify-postgres path).
   * Falls back to the internal `pg.Pool` created eagerly in the constructor
   * when only a `connectionString` was supplied — `pg.Pool` satisfies
   * `QueryableDatabase` because it exposes the same `.query(sql, values)`
   * signature.
   *
   * This getter being synchronously non-null for connectionString-only
   * providers is what causes `createRuntimeServiceContainer` to select
   * `PostgresSessionManager` rather than `InMemorySessionManager`.
   *
   * ```ts
   * if (typeof storageProvider.db === 'object' && storageProvider.db !== null) { ... }
   * ```
   */
  get db(): QueryableDatabase | undefined {
    return this.params.database ?? this.pool ?? undefined;
  }

  /**
   * Resolves the database object used by health, status, and migration methods.
   *
   * Priority: injected `database` → eagerly-created `pool` → failure.
   * The pool is created in the constructor when `connectionString` is supplied,
   * so this method is effectively synchronous for both construction paths.
   */
  private async database(): Promise<FrameworkResult<QueryableDatabase>> {
    if (this.params.database) return ok(this.params.database);
    if (this.pool) return ok(this.pool);

    return recoverable(
      "storage.unavailable",
      "Postgres connection string is not configured."
    );
  }

  /**
   * Checks database reachability by running a fixed `SELECT 1` query.
   *
   * Health checks never run migrations and never inspect user data; they only
   * confirm that the configured provider can answer a simple query.
   *
   * For injected-database paths (tests / advanced hosts), the query runs
   * directly on the injected adapter. For the lazy-pool path, a dedicated
   * connection is acquired from the pool, the query runs, and the connection
   * is released — the standard `pg.Pool` health-check pattern.
   */
  async healthCheck(): Promise<FrameworkResult<StorageHealth>> {
    // Injected-database path: delegate directly, no pool involved.
    if (this.params.database) {
      try {
        await this.params.database.query("select 1 as ok", []);
        return ok({ providerId: this.id, ready: true, message: "Postgres is reachable." });
      } catch (error) {
        return recoverable("storage.unavailable", "Postgres health check failed.", error);
      }
    }

    // Ensure pool is initialized before acquiring a connection.
    const dbResult = await this.database();

    if (!dbResult.ok) {
      return dbResult;
    }

    // Pool path: acquire a pooled connection, run SELECT 1, then release it
    // back to the pool regardless of outcome. pool.connect() checks out one
    // connection from the pool for the duration of the health query.
    let client: PoolClient | undefined;

    try {
      client = await this.pool!.connect();
      await client.query("SELECT 1");
      return ok({ providerId: this.id, ready: true, message: "Postgres is reachable." });
    } catch (error) {
      return recoverable("storage.unavailable", "Postgres health check failed.", error);
    } finally {
      client?.release();
    }
  }

  /**
   * Reads migration status from metadata without executing migration SQL.
   *
   * If the metadata table is absent, the method returns a recoverable
   * `storage.not-migrated` result so generated doctor/status flows can explain
   * the next manual step without mutating the database.
   */
  async discoverMigrationStatus(): Promise<FrameworkResult<readonly MigrationStatus[]>> {
    const database = await this.database();

    if (!database.ok) {
      return database;
    }

    try {
      // Build the expected migration id set from reviewed local definitions and
      // query only metadata rows for those ids.
      const migrations = (this.params.migrationProvider ?? new StaticMigrationProvider()).list();
      const ids = migrations.map((migration) => migration.id);
      const result = await database.value.query<{
        readonly migration_id: string;
        readonly checksum: string;
        readonly applied_at: string;
      }>(
        "select migration_id, checksum, applied_at from agentic_schema_migrations where migration_id = any($1)",
        [ids]
      );
      const appliedById = new Map(result.rows.map((row) => [row.migration_id, row]));

      // Compare definitions with metadata in memory. This keeps status
      // discovery read-only and makes checksum drift visible to callers.
      return ok(
        migrations.map((migration) => {
          const applied = appliedById.get(migration.id);

          return {
            id: migration.id,
            description: migration.description,
            checksum: migrationChecksum(migration),
            applied: Boolean(applied),
            appliedAt: applied?.applied_at
          };
        })
      );
    } catch (error) {
      return recoverable(
        "storage.not-migrated",
        "Migration metadata table is not available; migrations have not been applied.",
        error
      );
    }
  }

  /**
   * Executes reviewed framework migrations after exact approval.
   *
   * The exact approval string prevents accidental schema mutation from startup,
   * status discovery, tests, or scripted calls that forgot to ask the user.
   */
  async runMigrations(approvalText: string): Promise<FrameworkResult<MigrationRunResult>> {
    // Migrations change database schema and may affect user data. Requiring one
    // exact approval string makes accidental execution from startup, doctor, or
    // status checks impossible.
    if (approvalText !== RUN_AGENTIC_AI_INFRA_MIGRATIONS) {
      return recoverable(
        "migration.approval-required",
        `Migration execution requires exact approval text: ${RUN_AGENTIC_AI_INFRA_MIGRATIONS}.`
      );
    }

    const database = await this.database();

    if (!database.ok) {
      return database;
    }

    try {
      // Create the metadata table first so each migration can be applied once
      // and skipped deterministically on later approved runs.
      await database.value.query(
        `create table if not exists agentic_schema_migrations (
          migration_id text primary key,
          checksum text not null,
          applied_at timestamptz not null default now()
        )`,
        []
      );

      const applied: string[] = [];
      const skipped: string[] = [];

      for (const migration of (this.params.migrationProvider ?? new StaticMigrationProvider()).list()) {
        const checksum = migrationChecksum(migration);
        // Check metadata before executing each migration. This avoids rerunning
        // DDL and gives the caller a useful applied/skipped summary.
        const existing = await database.value.query<{ readonly migration_id: string }>(
          "select migration_id from agentic_schema_migrations where migration_id = $1",
          [migration.id]
        );

        if (existing.rows.length > 0) {
          skipped.push(migration.id);
          continue;
        }

        // Migration SQL is reviewed framework SQL, not user-provided SQL. Do not
        // expose this as a generic SQL execution tool.
        await database.value.query(migration.sql, []);
        await database.value.query(
          "insert into agentic_schema_migrations (migration_id, checksum) values ($1, $2)",
          [migration.id, checksum]
        );
        applied.push(migration.id);
      }

      return ok({ applied, skipped });
    } catch (error) {
      return recoverable("migration.discovery-failed", "Migration execution failed.", error);
    }
  }

  /**
   * Asserts that the stored vector dimension on `agentic_embeddings` matches
   * the configured embedding dimension.
   *
   * Queries `pg_attribute` for the `atttypmod` of the `embedding` column and
   * compares it to `configuredDimension`. Throws a `FrameworkError` with code
   * `storage.pgvector-unavailable` when the values differ so callers can halt
   * startup before any insert is attempted.
   *
   * Returns void when the table does not yet exist (pre-migration state is safe)
   * or when dimensions match. Unexpected database errors are silently swallowed
   * so a pg_attribute query failure does not block unrelated startup paths.
   *
   * Do NOT call this automatically — caller wiring is Stage 2 work.
   *
   * @example
   * await storageProvider.assertEmbeddingDimension(MOCK_EMBEDDING_DIMENSION);
   */
  async assertEmbeddingDimension(configuredDimension: number): Promise<void> {
    const database = await this.database();

    if (!database.ok) {
      return;
    }

    let storedDimension: number | undefined;

    try {
      const result = await database.value.query<{ readonly atttypmod: number }>(
        `select a.atttypmod
         from pg_class c
         join pg_attribute a on a.attrelid = c.oid
         where c.relname = 'agentic_embeddings'
           and a.attname = 'embedding'
           and a.attnum > 0
           and not a.attisdropped`,
        []
      );

      // Table absent means migrations have not run yet — no mismatch possible.
      if (result.rows.length === 0) {
        return;
      }

      storedDimension = result.rows[0]!.atttypmod;
    } catch {
      // Unexpected pg errors (schema query unavailable, etc.) do not block callers
      // because the dimension check is a pre-condition guard, not a required step.
      return;
    }

    if (storedDimension !== configuredDimension) {
      const error: FrameworkError = {
        code: "storage.pgvector-unavailable",
        message: `Embedding dimension mismatch: schema has vector(${storedDimension}) but configured dimension is ${configuredDimension}. Run migration 003 to fix.`,
        severity: "recoverable"
      };
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // KnowledgeIndexStorageCapability — knowledge persistence methods
  // ---------------------------------------------------------------------------

  /**
   * Returns the stored SHA-256 file hash for a given path + index version, or
   * `null` if the file has not been indexed under that version.
   *
   * Queries `agentic_cache_metadata` where the key encodes the relative path
   * and the `source_version` column holds the composite index version string.
   * A null return means the file is absent or was indexed under a different
   * provider version — the caller should re-index it.
   *
   * @param relativePath - Project-relative POSIX path of the file.
   * @param indexVersion - Provider composite version, format `<model>:<version>:dim<dim>`.
   */
  async lookupIndexedFileHash(relativePath: string, indexVersion: string): Promise<string | null> {
    const database = await this.database();

    if (!database.ok) {
      return null;
    }

    try {
      const result = await database.value.query<{ readonly content_hash: string }>(
        "select content_hash from agentic_cache_metadata where cache_key = $1 and source_version = $2",
        [`knowledge-index-file:${relativePath}`, indexVersion]
      );

      return result.rows[0]?.content_hash ?? null;
    } catch {
      // Treat lookup failures as cache misses so indexing continues safely.
      return null;
    }
  }

  /**
   * Persists a batch of knowledge chunks and their embedding vectors.
   *
   * Processing order for each batch:
   * 1. Upsert source and document records for every unique file path.
   * 2. For each chunk, upsert into `agentic_chunks` — safe metadata fields only
   *    on conflict (content is never overwritten because chunk IDs are
   *    content-addressed via SHA-256).
   * 3. For each embedding, upsert into `agentic_embeddings` with the vector
   *    formatted as a PostgreSQL `vector` literal.
   * 4. Update `agentic_cache_metadata` freshness entries so subsequent
   *    `lookupIndexedFileHash` calls reflect the stored state.
   *
   * Per-chunk errors are caught and silently swallowed; a single failed chunk
   * does not abort the rest of the batch. The calling `indexProjectKnowledge`
   * function tracks failures via `fileErrorCount` in the returned summary.
   *
   * @param chunks - Knowledge chunks from the chunking pipeline (parallel to embeddings).
   * @param embeddings - Embedding vectors for each chunk (parallel to chunks).
   */
  async storeKnowledgeChunks(
    chunks: readonly KnowledgeChunk[],
    embeddings: readonly EmbeddingResult[]
  ): Promise<void> {
    if (chunks.length === 0) {
      return;
    }

    const database = await this.database();

    if (!database.ok) {
      return;
    }

    const db = database.value;

    // Step 1 — Upsert a source record and a document record for every unique
    // file. Chunks reference both via FK so these must exist first.
    const seenFiles = new Set<string>();

    for (const chunk of chunks) {
      if (seenFiles.has(chunk.filePath)) {
        continue;
      }

      seenFiles.add(chunk.filePath);
      const filename = chunk.filePath.split("/").pop() ?? chunk.filePath;

      try {
        await db.query(
          `insert into agentic_sources
             (source_id, source_type, label, source_version, content_hash, metadata, updated_at)
           values ($1, $2, $3, $4, $5, '{}'::jsonb, now())
           on conflict (source_id) do update set
             source_type = excluded.source_type,
             label = excluded.label,
             source_version = excluded.source_version,
             content_hash = excluded.content_hash,
             updated_at = excluded.updated_at`,
          [chunk.filePath, chunk.sourceType, filename, chunk.chunkingStrategy, chunk.fileHash]
        );

        await db.query(
          `insert into agentic_documents
             (document_id, source_id, title, safe_path, metadata, updated_at)
           values ($1, $2, $3, $4, '{}'::jsonb, now())
           on conflict (document_id) do update set
             title = excluded.title,
             safe_path = excluded.safe_path,
             updated_at = excluded.updated_at`,
          [chunk.filePath, chunk.filePath, filename, chunk.filePath]
        );
      } catch {
        // If the source/document upsert fails, chunks for this file will also
        // fail their FK constraint. This is acceptable per-file isolation.
      }
    }

    // Step 2 — Upsert each chunk and its corresponding embedding.
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      const embedding = embeddings[i];

      try {
        const preview = chunk.content.slice(0, 200);
        const headingPath = [...(chunk.headingPath ?? [])];

        await db.query(
          `insert into agentic_chunks
             (chunk_id, document_id, source_id, ordinal, heading_path, preview, content, token_estimate, metadata)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
           on conflict (chunk_id) do update set
             ordinal = excluded.ordinal,
             heading_path = excluded.heading_path,
             preview = excluded.preview,
             token_estimate = excluded.token_estimate,
             metadata = excluded.metadata`,
          [
            chunk.chunkId,
            chunk.filePath,
            chunk.filePath,
            chunk.chunkIndex,
            headingPath,
            preview,
            chunk.content,
            chunk.tokenEstimate,
            JSON.stringify(chunk.metadata)
          ]
        );
      } catch {
        // Per-chunk insert failure: swallow and continue the batch.
        continue;
      }

      // Persist the embedding vector if one was computed for this chunk.
      if (embedding) {
        try {
          const embeddingId = `${chunk.chunkId}:${embedding.model}:${embedding.version}`;
          const providerId = `${embedding.model}:${embedding.version}`;
          // pgvector expects '[0.1,0.2,...]' format; cast with ::vector in SQL.
          const vectorLiteral = `[${embedding.embedding.join(",")}]`;

          await db.query(
            `insert into agentic_embeddings
               (embedding_id, chunk_id, provider_id, model_id, dimensions, embedding, is_mock, metadata)
             values ($1, $2, $3, $4, $5, $6::vector, $7, '{}'::jsonb)
             on conflict (embedding_id) do update set
               embedding = excluded.embedding,
               dimensions = excluded.dimensions`,
            [
              embeddingId,
              chunk.chunkId,
              providerId,
              embedding.model,
              embedding.dimension,
              vectorLiteral,
              false
            ]
          );
        } catch {
          // Embedding failure is isolated; the chunk row was already persisted.
        }
      }
    }

    // Step 3 — Update freshness cache so subsequent lookupIndexedFileHash calls
    // skip these files when the provider version and content hash match.
    if (embeddings.length > 0) {
      const firstEmbedding = embeddings[0]!;
      const indexVersion = `${firstEmbedding.model}:${firstEmbedding.version}:dim${firstEmbedding.dimension}`;

      for (const filePath of seenFiles) {
        // Find the file hash from the first chunk of this file.
        const fileChunk = chunks.find((c) => c.filePath === filePath);

        if (!fileChunk) {
          continue;
        }

        try {
          await db.query(
            `insert into agentic_cache_metadata (cache_key, source_version, content_hash, created_at)
             values ($1, $2, $3, now())
             on conflict (cache_key) do update set
               source_version = excluded.source_version,
               content_hash = excluded.content_hash,
               created_at = excluded.created_at`,
            [`knowledge-index-file:${filePath}`, indexVersion, fileChunk.fileHash]
          );
        } catch {
          // Cache update failure does not invalidate the stored chunks.
        }
      }
    }
  }

  /**
   * Inserts one row into `agentic_index_runs` summarising a completed indexing
   * run for observability and audit purposes.
   *
   * The `run_id` is derived from a SHA-256 hash of the completion timestamp and
   * the project root so the same run cannot be inserted twice. If the insert
   * fails (e.g. schema not yet migrated), the failure is silently swallowed
   * because recording a run must never invalidate the index itself.
   *
   * `embedding_provider` and `embedding_dimension` are parsed from the composite
   * `indexVersion` format: `<model>:<version>:dim<dimension>`.
   *
   * @param summary - Aggregate result returned by `indexProjectKnowledge`.
   */
  async recordIndexRun(summary: KnowledgeIndexSummary): Promise<void> {
    const database = await this.database();

    if (!database.ok) {
      return;
    }

    // Parse embedding_provider and embedding_dimension from the indexVersion
    // composite string, e.g. "nomic-embed-text:v1:dim768".
    const dimMatch = /^(.+):dim(\d+)$/.exec(summary.indexVersion);
    const embeddingProvider = dimMatch ? dimMatch[1] : summary.indexVersion;
    const embeddingDimension = dimMatch ? parseInt(dimMatch[2]!, 10) : null;

    // Stable run_id: SHA-256 of the completion timestamp and project root.
    const runId = createHash("sha256")
      .update(`${summary.indexedAt}:${summary.projectRoot}`)
      .digest("hex")
      .slice(0, 32);

    const filesScanned = summary.filesIndexed + summary.filesSkipped;

    try {
      await database.value.query(
        `insert into agentic_index_runs (
           run_id, completed_at, status, index_version,
           files_scanned, files_indexed, chunks_created,
           embeddings_created, file_error_count,
           embedding_provider, embedding_dimension, metadata
         ) values ($1, $2::timestamptz, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
         on conflict (run_id) do nothing`,
        [
          runId,
          summary.indexedAt,
          "completed",
          summary.indexVersion,
          filesScanned,
          summary.filesIndexed,
          summary.chunksCreated,
          summary.embeddingsCreated,
          summary.fileErrorCount,
          embeddingProvider,
          embeddingDimension,
          JSON.stringify({
            chunksSkipped: summary.chunksSkipped,
            projectRoot: summary.projectRoot
          })
        ]
      );
    } catch {
      // Recording failure must not block or invalidate the index run.
    }
  }

  /**
   * Fetches chunks from `agentic_chunks` joined with `agentic_sources` for
   * source-type, file-hash, and chunking-strategy provenance.
   *
   * Retrieval providers (DocumentTreeProvider, SymbolCodeProvider, PageIndexProvider)
   * call this to obtain a corpus for in-memory scoring against Postgres-backed
   * profiles. FullTextProvider and PgVectorProvider bypass this method with
   * optimized SQL paths (tsvector / pgvector <=>) when a `QueryableDatabase` is
   * directly accessible.
   *
   * SCHEMA NOTE: `agentic_chunks` does not have a `file_path` or `chunk_index`
   * column — the task SQL used those names, but the actual columns are `source_id`
   * (which holds the file path value) and `ordinal` (chunk position). The JOIN
   * to `agentic_sources` supplies `source_type`, `content_hash` (file hash), and
   * `source_version` (chunking strategy). `contentHash` is recomputed from
   * `content` since it is not persisted as a separate column.
   *
   * @param filePath - Optional project-relative POSIX path filter.
   * @returns Mapped KnowledgeChunk[] or [] on database unavailability.
   */
  async getChunks(filePath?: string): Promise<KnowledgeChunk[]> {
    const database = await this.database();

    if (!database.ok) {
      return [];
    }

    try {
      type ChunkRow = {
        readonly chunk_id: string;
        readonly file_path: string;
        readonly chunk_index: number;
        readonly heading_path: readonly string[] | null;
        readonly content: string;
        readonly token_estimate: number | null;
        readonly metadata: Record<string, unknown> | null;
        readonly source_type: string | null;
        readonly file_hash: string | null;
        readonly chunking_strategy: string | null;
      };

      const result = await database.value.query<ChunkRow>(
        `SELECT
          c.chunk_id,
          c.source_id AS file_path,
          c.ordinal    AS chunk_index,
          c.heading_path,
          c.content,
          c.token_estimate,
          c.metadata,
          s.source_type,
          s.content_hash  AS file_hash,
          s.source_version AS chunking_strategy
        FROM agentic_chunks c
        JOIN agentic_sources s ON s.source_id = c.source_id
        WHERE ($1::text IS NULL OR c.source_id = $1)
        ORDER BY c.source_id, c.ordinal`,
        [filePath ?? null]
      );

      return result.rows.map((row): KnowledgeChunk => ({
        chunkId: row.chunk_id,
        filePath: row.file_path,
        chunkIndex: row.chunk_index,
        headingPath: row.heading_path ?? [],
        content: row.content,
        // contentHash is not stored as a separate column; recompute from content.
        contentHash: createHash("sha256").update(row.content).digest("hex"),
        tokenEstimate: row.token_estimate ?? Math.max(1, Math.ceil(row.content.length / 4)),
        metadata: (row.metadata ?? {}) as KnowledgeChunkMetadata,
        sourceType: (row.source_type ?? "project-doc") as KnowledgeSourceType,
        fileHash: row.file_hash ?? "",
        chunkingStrategy: (row.chunking_strategy ?? "fallback") as ChunkingStrategy,
      }));
    } catch {
      // Any SQL failure returns empty — callers interpret this as not-indexed.
      return [];
    }
  }

  /**
   * Drains the lazily-created pool and marks this provider as closed.
   *
   * Calling `close()` more than once is safe — subsequent calls return
   * immediately without attempting to end an already-drained pool.
   *
   * Injected databases are owned by the caller and are not closed by this
   * provider.
   */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.pool?.end();
  }
}

export { FRAMEWORK_MIGRATIONS, RUN_AGENTIC_AI_INFRA_MIGRATIONS, migrationChecksum };
