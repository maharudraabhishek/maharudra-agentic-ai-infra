/**
 * Stage 13 — SQL-backed retrieval tests.
 *
 * All assertions run without a live Postgres instance. A `MockQueryableDatabase`
 * captures SQL queries and returns preconfigured row sets so the SQL paths in
 * FullTextProvider, PgVectorProvider, and PostgresStorageProvider.getChunks()
 * can be exercised deterministically.
 */
import { describe, expect, it } from "vitest";
import {
  FullTextProvider,
  InMemoryStorageProvider,
  MockEmbeddingProvider,
  PgVectorProvider,
  PostgresStorageProvider
} from "../src/index.js";
import type { QueryableDatabase } from "../src/storage/index.js";

// ---------------------------------------------------------------------------
// MockQueryableDatabase
// ---------------------------------------------------------------------------

/**
 * Minimal injectable database that captures all queries and returns preconfigured
 * row sets by SQL substring match. Rows for the first matching substring key are
 * returned; all other queries return empty rows.
 */
class MockQueryableDatabase implements QueryableDatabase {
  readonly capturedQueries: Array<{ sql: string; values: readonly unknown[] }> = [];
  private readonly responseMap = new Map<string, readonly Record<string, unknown>[]>();

  /** Register a row set to be returned when a query contains `sqlSubstring`. */
  setResponse(sqlSubstring: string, rows: readonly Record<string, unknown>[]): void {
    this.responseMap.set(sqlSubstring, rows);
  }

  async query<Row>(
    sql: string,
    values?: readonly unknown[]
  ): Promise<{ rows: readonly Row[] }> {
    this.capturedQueries.push({ sql, values: values ?? [] });

    for (const [key, rows] of this.responseMap) {
      if (sql.includes(key)) {
        return { rows: rows as Row[] };
      }
    }

    return { rows: [] as Row[] };
  }

  /** Returns true if any captured query contains the given substring. */
  queriedWith(sqlSubstring: string): boolean {
    return this.capturedQueries.some((q) => q.sql.includes(sqlSubstring));
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("sql-retrieval — Stage 13", () => {

  // -------------------------------------------------------------------------
  // a) PostgresStorageProvider.getChunks() runs SQL and maps to KnowledgeChunk[]
  // -------------------------------------------------------------------------
  it("PostgresStorageProvider.getChunks() queries agentic_chunks and maps to KnowledgeChunk[]", async () => {
    const mockDb = new MockQueryableDatabase();

    // Provide a row set that mirrors the JOIN result shape expected by getChunks().
    mockDb.setResponse("agentic_chunks", [
      {
        chunk_id: "chunk-001",
        file_path: "src/index.ts",
        chunk_index: 0,
        heading_path: null,
        content: "export function foo() { return 42; }",
        token_estimate: 9,
        metadata: null,
        source_type: "typescript-source",
        file_hash: "deadbeef",
        chunking_strategy: "typescript-ast",
      }
    ]);

    const storage = new PostgresStorageProvider("test", { database: mockDb });
    const chunks = await storage.getChunks();

    // SQL was issued
    expect(mockDb.queriedWith("agentic_chunks")).toBe(true);
    expect(mockDb.queriedWith("agentic_sources")).toBe(true);

    // Row mapped to KnowledgeChunk
    expect(chunks.length).toBe(1);

    const chunk = chunks[0]!;
    expect(chunk.chunkId).toBe("chunk-001");
    expect(chunk.filePath).toBe("src/index.ts");
    expect(chunk.chunkIndex).toBe(0);
    expect(chunk.content).toBe("export function foo() { return 42; }");
    expect(chunk.tokenEstimate).toBe(9);
    expect(chunk.sourceType).toBe("typescript-source");
    expect(chunk.fileHash).toBe("deadbeef");
    expect(chunk.chunkingStrategy).toBe("typescript-ast");
    // contentHash is recomputed from content — just verify it is a non-empty string
    expect(typeof chunk.contentHash).toBe("string");
    expect(chunk.contentHash.length).toBeGreaterThan(0);
  });

  it("PostgresStorageProvider.getChunks(filePath) passes the filter to SQL", async () => {
    const mockDb = new MockQueryableDatabase();
    mockDb.setResponse("agentic_chunks", []);

    const storage = new PostgresStorageProvider("test", { database: mockDb });
    await storage.getChunks("docs/guide.md");

    // The filePath should have been passed as the query parameter
    const lastQuery = mockDb.capturedQueries.find((q) => q.sql.includes("agentic_chunks"));
    expect(lastQuery).toBeDefined();
    expect(lastQuery!.values[0]).toBe("docs/guide.md");
  });

  // -------------------------------------------------------------------------
  // b) FullTextProvider uses SQL path when storage has .db getter
  // -------------------------------------------------------------------------
  it("FullTextProvider.retrieve() uses SQL tsvector path when storage has .db getter", async () => {
    const mockDb = new MockQueryableDatabase();
    mockDb.setResponse("plainto_tsquery", [
      {
        chunk_id: "chunk-ft-001",
        file_path: "src/search.ts",
        heading_path: ["Search Module"],
        content: "export function search(query: string) { return results; }",
        token_estimate: 11,
        rank: 0.75,
      }
    ]);

    const storage = new PostgresStorageProvider("test-ft", { database: mockDb });
    const provider = new FullTextProvider("full-text-pg", undefined, storage);

    const result = await provider.retrieve({ query: "search function", maxResults: 5 });

    // SQL path executed
    expect(mockDb.queriedWith("plainto_tsquery")).toBe(true);

    // Result mapped correctly
    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.value.length).toBe(1);
      expect(result.value[0]!.sourceId).toBe("src/search.ts");
      expect(result.value[0]!.score).toBe(0.75);
      expect(result.value[0]!.providerId).toBe("full-text-pg");
    }
  });

  it("FullTextProvider.retrieve() returns notIndexed via SQL path when no rows match", async () => {
    const mockDb = new MockQueryableDatabase();
    // No setResponse — all queries return []

    const storage = new PostgresStorageProvider("test-empty", { database: mockDb });
    const provider = new FullTextProvider("full-text-empty", undefined, storage);

    const result = await provider.retrieve({ query: "nonexistent term" });

    expect(mockDb.queriedWith("plainto_tsquery")).toBe(true);
    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("retrieval.not-indexed");
    }
  });

  // -------------------------------------------------------------------------
  // c) FullTextProvider uses in-memory path when storage is InMemoryStorageProvider
  // -------------------------------------------------------------------------
  it("FullTextProvider.retrieve() uses in-memory path when storage is InMemoryStorageProvider", async () => {
    const storage = new InMemoryStorageProvider("mem");

    // Index a chunk directly
    await storage.storeKnowledgeChunks(
      [
        {
          chunkId: "mem-001",
          filePath: "docs/readme.md",
          sourceType: "project-doc",
          fileHash: "abc",
          chunkIndex: 0,
          content: "This is a test document about testing.",
          contentHash: "xyz",
          chunkingStrategy: "markdown-heading",
          tokenEstimate: 7,
          metadata: {}
        }
      ],
      []
    );

    const provider = new FullTextProvider("full-text-mem", undefined, storage);
    const result = await provider.retrieve({ query: "test document", maxResults: 3 });

    // InMemoryStorageProvider has no .db getter — in-memory scoring used
    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.value.length).toBeGreaterThan(0);
      expect(result.value[0]!.sourceId).toBe("docs/readme.md");
    }
  });

  // -------------------------------------------------------------------------
  // d) PgVectorProvider returns not-configured when no EmbeddingProvider + Postgres
  // -------------------------------------------------------------------------
  it("PgVectorProvider.retrieve() returns not-configured when no EmbeddingProvider is injected and storage is Postgres", async () => {
    const mockDb = new MockQueryableDatabase();
    const storage = new PostgresStorageProvider("test-pgv-nocfg", { database: mockDb });

    // No EmbeddingProvider passed — 3rd param is undefined
    const provider = new PgVectorProvider("pgvec-no-embed", undefined, undefined, storage);
    const result = await provider.retrieve({ query: "find similar content" });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("retrieval.not-configured");
    }

    // No SQL query should have been issued (returned early)
    expect(mockDb.queriedWith("<=>")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // e) PgVectorProvider calls db.query with vector parameter when both present
  // -------------------------------------------------------------------------
  it("PgVectorProvider.retrieve() calls db.query with vector literal when EmbeddingProvider and Postgres storage are present", async () => {
    const mockDb = new MockQueryableDatabase();
    mockDb.setResponse("<=>", [
      {
        chunk_id: "emb-chunk-001",
        file_path: "docs/vector-guide.md",
        heading_path: ["Vector Retrieval"],
        content: "pgvector enables fast approximate nearest-neighbour search.",
        token_estimate: 8,
        similarity: 0.91,
      }
    ]);

    const storage = new PostgresStorageProvider("test-pgv-full", { database: mockDb });
    const embeddingProvider = new MockEmbeddingProvider();
    const provider = new PgVectorProvider("pgvec-full", undefined, embeddingProvider, storage);

    const result = await provider.retrieve({ query: "vector similarity search", maxResults: 4 });

    // SQL path was taken with vector parameter
    expect(mockDb.queriedWith("<=>")).toBe(true);

    // The vector literal was passed as the first parameter
    const vecQuery = mockDb.capturedQueries.find((q) => q.sql.includes("<=>"));
    expect(vecQuery).toBeDefined();
    // First value should be a vector literal string '[0.123,...]'
    expect(typeof vecQuery!.values[0]).toBe("string");
    expect((vecQuery!.values[0] as string).startsWith("[")).toBe(true);

    // Result mapped correctly
    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.value.length).toBe(1);
      expect(result.value[0]!.sourceId).toBe("docs/vector-guide.md");
      expect(result.value[0]!.score).toBeCloseTo(0.91);
      expect(result.value[0]!.providerId).toBe("pgvec-full");
    }
  });
});
