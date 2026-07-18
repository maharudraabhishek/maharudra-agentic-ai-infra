import type { PoolClient } from "pg";
import {
  LocalAiDbSafeError,
  withLocalAiDbClient
} from "../../db/local-ai-db-client.js";
import type { KnowledgeSourceType } from "../chunking/chunk-types.js";
import {
  MOCK_EMBEDDING_DIMENSION,
  MOCK_EMBEDDING_INDEX_VERSION,
  MOCK_EMBEDDING_MODEL,
  MOCK_EMBEDDING_VERSION
} from "../embeddings/embedding-config.js";
import {
  ProjectKnowledgeRetrievalSafeError,
  type ProjectKnowledgeCandidate,
  type ProjectKnowledgeIndexState
} from "../retrieval/retrieval-types.js";

type ReadyRow = {
  schema_migrations: string | null;
  rag_documents: string | null;
  rag_chunks: string | null;
  rag_embeddings: string | null;
  search_vector: string | null;
};

type AppliedMigrationRow = {
  migration_003: boolean;
};

type LatestCompletedRunRow = {
  id: string;
  index_version: string;
  completed_at: Date | string;
};

type CountRow = {
  count: string;
};

type CandidateRow = {
  chunk_id: string;
  document_id: string;
  file_path: string;
  source_type: KnowledgeSourceType;
  is_archived: boolean;
  chunk_index: number;
  heading_path: string | null;
  symbol_name: string | null;
  content: string;
  content_hash: string;
  chunking_strategy: ProjectKnowledgeCandidate["chunkingStrategy"];
  token_estimate: number | null;
  vector_score: number | string | null;
  full_text_score: number | string | null;
};

type RetrievalFilters = {
  includeArchived: boolean;
  sourceTypes: KnowledgeSourceType[];
  pathPrefixes: string[];
};

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toNumber(value: number | string | null | undefined): number {
  return Number(value ?? 0);
}

function clampScore(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

function toPgVector(embedding: readonly number[]): string {
  if (embedding.length !== MOCK_EMBEDDING_DIMENSION) {
    throw new LocalAiDbSafeError(
      "Embedding dimension mismatch. Mock embeddings must be 64-dimensional."
    );
  }

  return `[${embedding.join(",")}]`;
}

function makeCandidate(
  row: CandidateRow,
  source: "vector" | "full-text"
): ProjectKnowledgeCandidate {
  return {
    chunkId: row.chunk_id,
    documentId: row.document_id,
    filePath: row.file_path,
    sourceType: row.source_type,
    isArchived: row.is_archived,
    chunkIndex: row.chunk_index,
    headingPath: row.heading_path ?? undefined,
    symbolName: row.symbol_name ?? undefined,
    chunkingStrategy: row.chunking_strategy,
    tokenEstimate: toNumber(row.token_estimate),
    contentHash: row.content_hash,
    content: row.content,
    vectorScore:
      row.vector_score === null || row.vector_score === undefined
        ? undefined
        : clampScore(toNumber(row.vector_score)),
    fullTextScore:
      row.full_text_score === null || row.full_text_score === undefined
        ? undefined
        : clampScore(toNumber(row.full_text_score)),
    retrievalSources: [source]
  };
}

async function assertRetrievalSchemaReady(client: PoolClient): Promise<void> {
  const result = await client.query<ReadyRow>(
    [
      "select",
      "to_regclass('local_ai.schema_migrations')::text as schema_migrations,",
      "to_regclass('local_ai.rag_documents')::text as rag_documents,",
      "to_regclass('local_ai.rag_chunks')::text as rag_chunks,",
      "to_regclass('local_ai.rag_embeddings')::text as rag_embeddings,",
      "to_regclass('local_ai.rag_chunks_search_vector_gin_idx')::text as search_vector"
    ].join(" ")
  );
  const row = result.rows[0];

  if (
    !row?.schema_migrations ||
    !row.rag_documents ||
    !row.rag_chunks ||
    !row.rag_embeddings
  ) {
    throw new ProjectKnowledgeRetrievalSafeError(
      "schema-not-ready",
      "Local AI DB migrations are not applied. Run local AI migrations before retrieval."
    );
  }

  const migration = await client.query<AppliedMigrationRow>(
    [
      "select exists (",
      "select 1 from local_ai.schema_migrations",
      "where version = $1 and name = $2",
      ") as migration_003"
    ].join(" "),
    ["003", "add_project_knowledge_retrieval_search"]
  );

  if (migration.rows[0]?.migration_003 !== true || !row.search_vector) {
    throw new ProjectKnowledgeRetrievalSafeError(
      "schema-not-ready",
      "Local AI DB migration 003 is pending. Retrieval search schema is not ready."
    );
  }
}

function appendMetadataFilters(params: {
  clauses: string[];
  values: unknown[];
  filters: RetrievalFilters;
}): void {
  if (!params.filters.includeArchived) {
    params.clauses.push("d.is_archived = false");
  }

  if (params.filters.sourceTypes.length > 0) {
    params.values.push(params.filters.sourceTypes);
    params.clauses.push(`d.source_type = any($${params.values.length}::text[])`);
  }

  if (params.filters.pathPrefixes.length > 0) {
    params.values.push(params.filters.pathPrefixes);
    params.clauses.push(
      [
        "exists (",
        `select 1 from unnest($${params.values.length}::text[]) as allowed_prefix(value)`,
        "where d.file_path = allowed_prefix.value",
        "or d.file_path like allowed_prefix.value || '%'",
        ")"
      ].join(" ")
    );
  }
}

export class ProjectKnowledgeRetrievalStore {
  async getReadyMockIndexState(): Promise<ProjectKnowledgeIndexState> {
    return withLocalAiDbClient(async (client) => {
      await assertRetrievalSchemaReady(client);

      const latestRun = await client.query<LatestCompletedRunRow>(
        [
          "select id, index_version, completed_at",
          "from local_ai.rag_index_runs",
          "where status = $1",
          "and index_version = $2",
          "and completed_at is not null",
          "order by completed_at desc, started_at desc",
          "limit 1"
        ].join(" "),
        ["completed", MOCK_EMBEDDING_INDEX_VERSION]
      );
      const run = latestRun.rows[0];

      if (!run) {
        throw new ProjectKnowledgeRetrievalSafeError(
          "index-not-ready",
          "Project knowledge index is not ready. Run manual mock indexing after reviewing migrations."
        );
      }

      const chunkCount = await client.query<CountRow>(
        [
          "select count(c.id)::text as count",
          "from local_ai.rag_chunks c",
          "join local_ai.rag_documents d on d.id = c.document_id",
          "join local_ai.rag_embeddings e on e.chunk_id = c.id",
          "where d.index_version = $1",
          "and e.embedding_model = $2",
          "and e.embedding_version = $3",
          "and e.embedding_dimension = $4"
        ].join(" "),
        [
          run.index_version,
          MOCK_EMBEDDING_MODEL,
          MOCK_EMBEDDING_VERSION,
          MOCK_EMBEDDING_DIMENSION
        ]
      );

      if (toNumber(chunkCount.rows[0]?.count) === 0) {
        throw new ProjectKnowledgeRetrievalSafeError(
          "index-not-ready",
          "Project knowledge index is ready but empty. Run manual mock indexing before retrieval."
        );
      }

      return {
        indexVersion: run.index_version,
        indexRunId: run.id,
        completedAt: toIsoString(run.completed_at)
      };
    });
  }

  async searchVector(params: {
    queryEmbedding: readonly number[];
    indexVersion: string;
    filters: RetrievalFilters;
    limit: number;
  }): Promise<ProjectKnowledgeCandidate[]> {
    return withLocalAiDbClient(async (client) => {
      await assertRetrievalSchemaReady(client);

      const values: unknown[] = [
        toPgVector(params.queryEmbedding),
        params.indexVersion,
        MOCK_EMBEDDING_MODEL,
        MOCK_EMBEDDING_VERSION,
        MOCK_EMBEDDING_DIMENSION
      ];
      const clauses = [
        "d.index_version = $2",
        "e.embedding_model = $3",
        "e.embedding_version = $4",
        "e.embedding_dimension = $5",
        "e.embedding is not null"
      ];

      appendMetadataFilters({
        clauses,
        values,
        filters: params.filters
      });

      values.push(params.limit);

      const result = await client.query<CandidateRow>(
        [
          "select c.id as chunk_id, d.id as document_id, d.file_path,",
          "d.source_type, d.is_archived, c.chunk_index, c.heading_path,",
          "c.symbol_name, c.content, c.content_hash, c.chunking_strategy,",
          "c.token_estimate,",
          "(1 - (e.embedding <=> $1::vector)) as vector_score,",
          "null::real as full_text_score",
          "from local_ai.rag_chunks c",
          "join local_ai.rag_documents d on d.id = c.document_id",
          "join local_ai.rag_embeddings e on e.chunk_id = c.id",
          `where ${clauses.join(" and ")}`,
          "order by e.embedding <=> $1::vector asc, d.file_path asc, c.chunk_index asc",
          `limit $${values.length}`
        ].join(" "),
        values
      );

      return result.rows.map((row) => makeCandidate(row, "vector"));
    });
  }

  async searchFullText(params: {
    query: string;
    indexVersion: string;
    filters: RetrievalFilters;
    limit: number;
  }): Promise<ProjectKnowledgeCandidate[]> {
    return withLocalAiDbClient(async (client) => {
      await assertRetrievalSchemaReady(client);

      const values: unknown[] = [params.query, params.indexVersion];
      const clauses = ["d.index_version = $2", "c.search_vector @@ search_query.query"];

      appendMetadataFilters({
        clauses,
        values,
        filters: params.filters
      });

      values.push(params.limit);

      const result = await client.query<CandidateRow>(
        [
          "with search_query as (",
          "select websearch_to_tsquery('simple', $1) as query",
          ")",
          "select c.id as chunk_id, d.id as document_id, d.file_path,",
          "d.source_type, d.is_archived, c.chunk_index, c.heading_path,",
          "c.symbol_name, c.content, c.content_hash, c.chunking_strategy,",
          "c.token_estimate, null::real as vector_score,",
          "least(1, ts_rank_cd(c.search_vector, search_query.query) * 4) as full_text_score",
          "from local_ai.rag_chunks c",
          "join local_ai.rag_documents d on d.id = c.document_id",
          "cross join search_query",
          `where ${clauses.join(" and ")}`,
          "order by full_text_score desc, d.file_path asc, c.chunk_index asc",
          `limit $${values.length}`
        ].join(" "),
        values
      );

      return result.rows.map((row) => makeCandidate(row, "full-text"));
    });
  }
}
