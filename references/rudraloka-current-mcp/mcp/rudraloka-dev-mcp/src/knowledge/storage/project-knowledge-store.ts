import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  LocalAiDbSafeError,
  withLocalAiDbClient
} from "../../db/local-ai-db-client.js";
import type { KnowledgeChunk } from "../chunking/chunk-types.js";
import {
  MOCK_EMBEDDING_DIMENSION,
  MOCK_EMBEDDING_HNSW_EF_CONSTRUCTION,
  MOCK_EMBEDDING_HNSW_M,
  MOCK_EMBEDDING_INDEX_VERSION,
  MOCK_EMBEDDING_MODEL,
  MOCK_EMBEDDING_VERSION
} from "../embeddings/embedding-config.js";

const MAX_STATUS_RUN_EXAMPLES = 5;

type CountRow = {
  count: string;
};

type ReadyRow = {
  schema_migrations: string | null;
  rag_index_runs: string | null;
  rag_documents: string | null;
  rag_chunks: string | null;
  rag_embeddings: string | null;
};

type AppliedMigrationRow = {
  exists: boolean;
};

type ExistingDocumentRow = {
  document_id: string;
  chunk_count: string;
  embedding_count: string;
};

type ExistingScannedFileRow = ExistingDocumentRow & {
  total_chunks_metadata: string | null;
};

type LatestRunRow = {
  id: string;
  index_version: string;
  status: string;
  started_at: Date | string;
  completed_at: Date | string | null;
  files_scanned: number;
  files_indexed: number;
  chunks_created: number;
  chunks_embedded: number;
  error_message: string | null;
  metadata: unknown;
};

type EmbeddingMetadataRow = {
  embedding_model: string;
  embedding_version: string;
  embedding_dimension: number;
};

export type ProjectKnowledgeRunStatus = "running" | "completed" | "failed";

export type ProjectKnowledgeRunSummary = {
  id: string;
  indexVersion: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  filesScanned: number;
  filesIndexed: number;
  chunksCreated: number;
  chunksEmbedded: number;
  errorMessage?: string;
};

export type ProjectKnowledgeIndexStatus = {
  status: "ok";
  indexVersion: string;
  documentCount: number;
  chunkCount: number;
  embeddingCount: number;
  embeddingModel: string;
  embeddingVersion: string;
  embeddingDimension: number;
  latestRun?: ProjectKnowledgeRunSummary;
  pendingOrFailedRuns: ProjectKnowledgeRunSummary[];
  pendingOrFailedRunsCap: number;
  diagnostics: ProjectKnowledgeIndexDiagnostics;
  message: string;
};

export type ProjectKnowledgeIndexDiagnostics = {
  provider: {
    embeddingModel: string;
    embeddingVersion: string;
    embeddingDimension: number;
  };
  hnsw: {
    indexType: "hnsw";
    m: number;
    efConstruction: number;
    scope: "mock-embedding-local-dev";
    migrationManaged: true;
  };
  maintenance: {
    latestRunStatus?: string;
    pendingOrFailedRunCount: number;
    forceReindexApprovalText: "REINDEX_PROJECT_KNOWLEDGE";
  };
  outputSafety: {
    returnsChunks: false;
    returnsVectors: false;
    returnsSql: false;
  };
};

export type PreChunkIndexCheckResult = {
  complete: boolean;
  reason:
    | "complete"
    | "no-document"
    | "missing-total-chunks-metadata"
    | "chunk-count-mismatch"
    | "embedding-count-mismatch";
  expectedChunks?: number;
  chunkCount?: number;
  embeddingCount?: number;
};

export type UpsertDocumentInput = {
  filePath: string;
  sourceType: string;
  fileHash: string;
  contentHash: string;
  indexVersion: string;
  isArchived: boolean;
  metadata: Record<string, unknown>;
};

export type UpsertEmbeddingInput = {
  chunkId: string;
  embedding: number[];
  embeddingModel: string;
  embeddingVersion: string;
  embeddingDimension: number;
  contentHash: string;
  metadata: Record<string, unknown>;
};

export type CompleteIndexRunInput = {
  runId: string;
  filesScanned: number;
  filesIndexed: number;
  chunksCreated: number;
  chunksEmbedded: number;
  metadata: Record<string, unknown>;
};

export type FailIndexRunInput = {
  runId: string;
  filesScanned: number;
  filesIndexed: number;
  chunksCreated: number;
  chunksEmbedded: number;
  errorMessage: string;
  metadata: Record<string, unknown>;
};

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function optionalIsoString(value: Date | string | null): string | undefined {
  return value ? toIsoString(value) : undefined;
}

function toNumber(value: string | number | undefined): number {
  return Number(value ?? 0);
}

function toOptionalPositiveInteger(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function toPgVector(embedding: readonly number[]): string {
  if (embedding.length !== MOCK_EMBEDDING_DIMENSION) {
    throw new LocalAiDbSafeError(
      "Embedding dimension mismatch. Mock embeddings must be 64-dimensional."
    );
  }

  return `[${embedding.join(",")}]`;
}

function mapRun(row: LatestRunRow): ProjectKnowledgeRunSummary {
  return {
    id: row.id,
    indexVersion: row.index_version,
    status: row.status,
    startedAt: toIsoString(row.started_at),
    completedAt: optionalIsoString(row.completed_at),
    filesScanned: row.files_scanned,
    filesIndexed: row.files_indexed,
    chunksCreated: row.chunks_created,
    chunksEmbedded: row.chunks_embedded,
    errorMessage: row.error_message ?? undefined
  };
}

async function assertMilestone3SchemaReady(client: PoolClient): Promise<void> {
  const tables = await client.query<ReadyRow>(
    [
      "select",
      "to_regclass('local_ai.schema_migrations')::text as schema_migrations,",
      "to_regclass('local_ai.rag_index_runs')::text as rag_index_runs,",
      "to_regclass('local_ai.rag_documents')::text as rag_documents,",
      "to_regclass('local_ai.rag_chunks')::text as rag_chunks,",
      "to_regclass('local_ai.rag_embeddings')::text as rag_embeddings"
    ].join(" ")
  );
  const row = tables.rows[0];

  if (
    !row?.schema_migrations ||
    !row.rag_index_runs ||
    !row.rag_documents ||
    !row.rag_chunks ||
    !row.rag_embeddings
  ) {
    throw new LocalAiDbSafeError(
      "Local AI DB migrations are not applied. Run local AI migrations before using project knowledge indexing."
    );
  }

  const migration = await client.query<AppliedMigrationRow>(
    [
      "select exists (",
      "select 1 from local_ai.schema_migrations",
      "where version = $1 and name = $2",
      ") as exists"
    ].join(" "),
    ["002", "add_mock_embedding_hnsw_index"]
  );

  if (migration.rows[0]?.exists !== true) {
    throw new LocalAiDbSafeError(
      "Local AI DB migration 002 is pending. Run local AI migrations before using project knowledge indexing."
    );
  }
}

async function countRows(
  client: PoolClient,
  sql: string,
  values: unknown[]
): Promise<number> {
  const result = await client.query<CountRow>(sql, values);

  return toNumber(result.rows[0]?.count);
}

export class ProjectKnowledgeStore {
  async assertReady(): Promise<void> {
    await withLocalAiDbClient(async (client) => {
      await assertMilestone3SchemaReady(client);
    });
  }

  async startIndexRun(params: {
    indexVersion: string;
    metadata: Record<string, unknown>;
  }): Promise<string> {
    return withLocalAiDbClient(async (client) => {
      await assertMilestone3SchemaReady(client);

      const runId = randomUUID();

      await client.query(
        [
          "insert into local_ai.rag_index_runs",
          "(id, index_version, status, metadata)",
          "values ($1, $2, $3, $4::jsonb)"
        ].join(" "),
        [runId, params.indexVersion, "running", params.metadata]
      );

      return runId;
    });
  }

  async completeIndexRun(params: CompleteIndexRunInput): Promise<void> {
    await withLocalAiDbClient(async (client) => {
      await client.query(
        [
          "update local_ai.rag_index_runs",
          "set status = $2, completed_at = now(), files_scanned = $3,",
          "files_indexed = $4, chunks_created = $5, chunks_embedded = $6,",
          "metadata = $7::jsonb",
          "where id = $1"
        ].join(" "),
        [
          params.runId,
          "completed",
          params.filesScanned,
          params.filesIndexed,
          params.chunksCreated,
          params.chunksEmbedded,
          params.metadata
        ]
      );
    });
  }

  async failIndexRun(params: FailIndexRunInput): Promise<void> {
    await withLocalAiDbClient(async (client) => {
      await client.query(
        [
          "update local_ai.rag_index_runs",
          "set status = $2, completed_at = now(), files_scanned = $3,",
          "files_indexed = $4, chunks_created = $5, chunks_embedded = $6,",
          "error_message = $7, metadata = $8::jsonb",
          "where id = $1"
        ].join(" "),
        [
          params.runId,
          "failed",
          params.filesScanned,
          params.filesIndexed,
          params.chunksCreated,
          params.chunksEmbedded,
          params.errorMessage,
          params.metadata
        ]
      );
    });
  }

  async clearCurrentMockIndex(): Promise<number> {
    return withLocalAiDbClient(async (client) => {
      await assertMilestone3SchemaReady(client);

      /**
       * Force reindexing is scoped to the current mock index version. Documents
       * cascade to chunks and embeddings, but schema_migrations, schema objects,
       * migration files, docs, and source files are untouched.
       */
      const result = await client.query(
        "delete from local_ai.rag_documents where index_version = $1",
        [MOCK_EMBEDDING_INDEX_VERSION]
      );

      return result.rowCount ?? 0;
    });
  }

  async hasCompleteDocumentIndex(params: {
    filePath: string;
    fileHash: string;
    contentHash: string;
    indexVersion: string;
    expectedChunks: number;
    embeddingModel: string;
    embeddingVersion: string;
    embeddingDimension: number;
  }): Promise<boolean> {
    return withLocalAiDbClient(async (client) => {
      await assertMilestone3SchemaReady(client);

      const result = await client.query<ExistingDocumentRow>(
        [
          "select d.id as document_id,",
          "count(c.id)::text as chunk_count,",
          "count(e.id)::text as embedding_count",
          "from local_ai.rag_documents d",
          "left join local_ai.rag_chunks c on c.document_id = d.id",
          "left join local_ai.rag_embeddings e on e.chunk_id = c.id",
          "and e.embedding_model = $5",
          "and e.embedding_version = $6",
          "and e.embedding_dimension = $7",
          "and e.content_hash = c.content_hash",
          "where d.file_path = $1",
          "and d.file_hash = $2",
          "and d.content_hash = $3",
          "and d.index_version = $4",
          "group by d.id"
        ].join(" "),
        [
          params.filePath,
          params.fileHash,
          params.contentHash,
          params.indexVersion,
          params.embeddingModel,
          params.embeddingVersion,
          params.embeddingDimension
        ]
      );
      const row = result.rows[0];

      if (!row) {
        return false;
      }

      return (
        toNumber(row.chunk_count) === params.expectedChunks &&
        toNumber(row.embedding_count) === params.expectedChunks
      );
    });
  }

  async checkCompleteScannedFileIndex(params: {
    filePath: string;
    fileHash: string;
    contentHash: string;
    indexVersion: string;
    embeddingModel: string;
    embeddingVersion: string;
    embeddingDimension: number;
  }): Promise<PreChunkIndexCheckResult> {
    return withLocalAiDbClient(async (client) => {
      await assertMilestone3SchemaReady(client);

      const result = await client.query<ExistingScannedFileRow>(
        [
          "select d.id as document_id,",
          "d.metadata ->> 'totalChunks' as total_chunks_metadata,",
          "count(c.id)::text as chunk_count,",
          "count(e.id)::text as embedding_count",
          "from local_ai.rag_documents d",
          "left join local_ai.rag_chunks c on c.document_id = d.id",
          "left join local_ai.rag_embeddings e on e.chunk_id = c.id",
          "and e.embedding_model = $5",
          "and e.embedding_version = $6",
          "and e.embedding_dimension = $7",
          "and e.content_hash = c.content_hash",
          "where d.file_path = $1",
          "and d.file_hash = $2",
          "and d.content_hash = $3",
          "and d.index_version = $4",
          "group by d.id, d.metadata",
          "limit 1"
        ].join(" "),
        [
          params.filePath,
          params.fileHash,
          params.contentHash,
          params.indexVersion,
          params.embeddingModel,
          params.embeddingVersion,
          params.embeddingDimension
        ]
      );
      const row = result.rows[0];

      if (!row) {
        return { complete: false, reason: "no-document" };
      }

      const expectedChunks = toOptionalPositiveInteger(row.total_chunks_metadata);

      if (!expectedChunks) {
        return {
          complete: false,
          reason: "missing-total-chunks-metadata"
        };
      }

      const chunkCount = toNumber(row.chunk_count);
      const embeddingCount = toNumber(row.embedding_count);

      if (chunkCount !== expectedChunks) {
        return {
          complete: false,
          reason: "chunk-count-mismatch",
          expectedChunks,
          chunkCount,
          embeddingCount
        };
      }

      if (embeddingCount !== expectedChunks) {
        return {
          complete: false,
          reason: "embedding-count-mismatch",
          expectedChunks,
          chunkCount,
          embeddingCount
        };
      }

      return {
        complete: true,
        reason: "complete",
        expectedChunks,
        chunkCount,
        embeddingCount
      };
    });
  }

  async upsertDocument(params: UpsertDocumentInput): Promise<string> {
    return withLocalAiDbClient(async (client) => {
      await assertMilestone3SchemaReady(client);

      const result = await client.query<{ id: string }>(
        [
          "insert into local_ai.rag_documents",
          "(id, file_path, source_type, file_hash, content_hash, index_version, is_archived, metadata)",
          "values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)",
          "on conflict (file_path, content_hash, index_version) do update set",
          "source_type = excluded.source_type,",
          "file_hash = excluded.file_hash,",
          "indexed_at = now(),",
          "is_archived = excluded.is_archived,",
          "metadata = excluded.metadata",
          "returning id"
        ].join(" "),
        [
          randomUUID(),
          params.filePath,
          params.sourceType,
          params.fileHash,
          params.contentHash,
          params.indexVersion,
          params.isArchived,
          params.metadata
        ]
      );

      return result.rows[0]?.id ?? "";
    });
  }

  async upsertChunk(params: {
    documentId: string;
    chunk: KnowledgeChunk;
  }): Promise<string> {
    return withLocalAiDbClient(async (client) => {
      await assertMilestone3SchemaReady(client);

      const result = await client.query<{ id: string }>(
        [
          "insert into local_ai.rag_chunks",
          "(id, document_id, chunk_index, heading_path, symbol_name, content,",
          "content_hash, chunking_strategy, token_estimate, metadata)",
          "values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)",
          "on conflict (document_id, chunk_index, content_hash) do update set",
          "heading_path = excluded.heading_path,",
          "symbol_name = excluded.symbol_name,",
          "content = excluded.content,",
          "chunking_strategy = excluded.chunking_strategy,",
          "token_estimate = excluded.token_estimate,",
          "metadata = excluded.metadata",
          "returning id"
        ].join(" "),
        [
          randomUUID(),
          params.documentId,
          params.chunk.chunkIndex,
          params.chunk.headingPath?.join(" > ") ?? null,
          params.chunk.symbolName ?? null,
          params.chunk.content,
          params.chunk.contentHash,
          params.chunk.chunkingStrategy,
          params.chunk.tokenEstimate,
          {
            ...params.chunk.metadata,
            sourceChunkId: params.chunk.chunkId,
            headingPath: params.chunk.headingPath ?? null
          }
        ]
      );

      return result.rows[0]?.id ?? "";
    });
  }

  async upsertEmbedding(params: UpsertEmbeddingInput): Promise<void> {
    await withLocalAiDbClient(async (client) => {
      await assertMilestone3SchemaReady(client);

      await client.query(
        [
          "insert into local_ai.rag_embeddings",
          "(id, chunk_id, embedding, embedding_model, embedding_dimension,",
          "embedding_version, content_hash, metadata)",
          "values ($1, $2, $3::vector, $4, $5, $6, $7, $8::jsonb)",
          "on conflict (chunk_id, embedding_model, embedding_version, content_hash)",
          "do update set embedding = excluded.embedding,",
          "embedding_dimension = excluded.embedding_dimension,",
          "metadata = excluded.metadata"
        ].join(" "),
        [
          randomUUID(),
          params.chunkId,
          toPgVector(params.embedding),
          params.embeddingModel,
          params.embeddingDimension,
          params.embeddingVersion,
          params.contentHash,
          params.metadata
        ]
      );
    });
  }

  async getIndexStatus(): Promise<ProjectKnowledgeIndexStatus> {
    return withLocalAiDbClient(async (client) => {
      await assertMilestone3SchemaReady(client);

      const [latestRun, pendingRuns, embeddingMetadata] = await Promise.all([
        client.query<LatestRunRow>(
          [
            "select id, index_version, status, started_at, completed_at,",
            "files_scanned, files_indexed, chunks_created, chunks_embedded,",
            "error_message, metadata",
            "from local_ai.rag_index_runs",
            "order by started_at desc",
            "limit 1"
          ].join(" ")
        ),
        client.query<LatestRunRow>(
          [
            "select id, index_version, status, started_at, completed_at,",
            "files_scanned, files_indexed, chunks_created, chunks_embedded,",
            "error_message, metadata",
            "from local_ai.rag_index_runs",
            "where status in ('running', 'failed')",
            "order by started_at desc",
            "limit $1"
          ].join(" "),
          [MAX_STATUS_RUN_EXAMPLES]
        ),
        client.query<EmbeddingMetadataRow>(
          [
            "select embedding_model, embedding_version, embedding_dimension",
            "from local_ai.rag_embeddings",
            "where embedding_model = $1",
            "and embedding_version = $2",
            "and embedding_dimension = $3",
            "limit 1"
          ].join(" "),
          [
            MOCK_EMBEDDING_MODEL,
            MOCK_EMBEDDING_VERSION,
            MOCK_EMBEDDING_DIMENSION
          ]
        )
      ]);

      const documentCount = await countRows(
        client,
        "select count(*)::text as count from local_ai.rag_documents where index_version = $1",
        [MOCK_EMBEDDING_INDEX_VERSION]
      );
      const chunkCount = await countRows(
        client,
        [
          "select count(c.id)::text as count",
          "from local_ai.rag_chunks c",
          "join local_ai.rag_documents d on d.id = c.document_id",
          "where d.index_version = $1"
        ].join(" "),
        [MOCK_EMBEDDING_INDEX_VERSION]
      );
      const embeddingCount = await countRows(
        client,
        [
          "select count(e.id)::text as count",
          "from local_ai.rag_embeddings e",
          "join local_ai.rag_chunks c on c.id = e.chunk_id",
          "join local_ai.rag_documents d on d.id = c.document_id",
          "where d.index_version = $1",
          "and e.embedding_model = $2",
          "and e.embedding_version = $3",
          "and e.embedding_dimension = $4"
        ].join(" "),
        [
          MOCK_EMBEDDING_INDEX_VERSION,
          MOCK_EMBEDDING_MODEL,
          MOCK_EMBEDDING_VERSION,
          MOCK_EMBEDDING_DIMENSION
        ]
      );
      const metadata = embeddingMetadata.rows[0];

      return {
        status: "ok",
        indexVersion: MOCK_EMBEDDING_INDEX_VERSION,
        documentCount,
        chunkCount,
        embeddingCount,
        embeddingModel: metadata?.embedding_model ?? MOCK_EMBEDDING_MODEL,
        embeddingVersion: metadata?.embedding_version ?? MOCK_EMBEDDING_VERSION,
        embeddingDimension:
          metadata?.embedding_dimension ?? MOCK_EMBEDDING_DIMENSION,
        latestRun: latestRun.rows[0] ? mapRun(latestRun.rows[0]) : undefined,
        pendingOrFailedRuns: pendingRuns.rows.map(mapRun),
        pendingOrFailedRunsCap: MAX_STATUS_RUN_EXAMPLES,
        diagnostics: {
          provider: {
            embeddingModel: metadata?.embedding_model ?? MOCK_EMBEDDING_MODEL,
            embeddingVersion: metadata?.embedding_version ?? MOCK_EMBEDDING_VERSION,
            embeddingDimension:
              metadata?.embedding_dimension ?? MOCK_EMBEDDING_DIMENSION
          },
          hnsw: {
            indexType: "hnsw",
            m: MOCK_EMBEDDING_HNSW_M,
            efConstruction: MOCK_EMBEDDING_HNSW_EF_CONSTRUCTION,
            scope: "mock-embedding-local-dev",
            migrationManaged: true
          },
          maintenance: {
            latestRunStatus: latestRun.rows[0]?.status,
            pendingOrFailedRunCount: pendingRuns.rows.length,
            forceReindexApprovalText: "REINDEX_PROJECT_KNOWLEDGE"
          },
          outputSafety: {
            returnsChunks: false,
            returnsVectors: false,
            returnsSql: false
          }
        },
        message:
          documentCount === 0
            ? "Project knowledge index is ready but currently empty."
            : "Project knowledge index status read safely."
      };
    });
  }
}
