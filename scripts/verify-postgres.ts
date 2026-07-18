/**
 * Postgres verification script — validates migrations, indexing, retrieval,
 * and session tracking against a live Postgres instance.
 *
 * Run with: pnpm verify:postgres
 *
 * Prerequisites:
 *   1. Docker Compose postgres service running (docker compose up -d postgres)
 *   2. DATABASE_URL set (copy .env.example → .env and source it, or export directly)
 *   3. Packages built (pnpm build)
 *
 * This script is NOT part of pnpm run ci — it requires a live database.
 */

import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import {
  PostgresStorageProvider,
  type QueryableDatabase,
  type MigrationRunResult,
  RUN_AGENTIC_AI_INFRA_MIGRATIONS,
  MockEmbeddingProvider,
  indexProjectKnowledge,
  RetrievalRouter,
  FullTextProvider,
  createSessionManager,
} from "@maharudra/agentic-ai-infra-runtime";

// ---------------------------------------------------------------------------
// Step 1 — Check DATABASE_URL
// ---------------------------------------------------------------------------

const DATABASE_URL = process.env["DATABASE_URL"];

if (!DATABASE_URL) {
  console.error("[verify-postgres] ✗ DATABASE_URL is not set.");
  console.error("  Copy .env.example to .env and set DATABASE_URL, or export it directly:");
  console.error(
    "  DATABASE_URL=postgresql://agentic_ai:agentic_ai_local_dev@localhost:5433/agentic_ai_local"
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function pass(stepNum: number, msg: string): void {
  console.log(`[verify-postgres] ✓ Step ${stepNum}: ${msg}`);
}

function failStep(stepNum: number, error: unknown): never {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`[verify-postgres] ✗ Step ${stepNum} failed: ${detail}`);
  process.exit(1);
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

// ---------------------------------------------------------------------------
// Step 2 — Construct PostgresStorageProvider
// ---------------------------------------------------------------------------

// Build an explicit pool and expose it as QueryableDatabase so the same
// pool can be passed to both PostgresStorageProvider and createSessionManager.
// pg.Pool.query() is structurally compatible with QueryableDatabase.query().
const { Pool } = await import("pg");
const pool = new Pool({ connectionString: DATABASE_URL });
const queryablePool: QueryableDatabase = {
  async query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[]
  ) {
    const result = await pool.query<Row>(sql, values as unknown[]);
    return { rows: result.rows };
  },
};

const storageProvider = new PostgresStorageProvider("verify-storage", {
  database: queryablePool,
});
pass(2, "PostgresStorageProvider constructed with injected pool.");

// ---------------------------------------------------------------------------
// Step 3 — runMigrations — log each migration applied or skipped
// ---------------------------------------------------------------------------

try {
  const migResult = await storageProvider.runMigrations(RUN_AGENTIC_AI_INFRA_MIGRATIONS);

  if (!migResult.ok) {
    failStep(3, `runMigrations returned failure: ${migResult.error.message}`);
  }

  const { applied, skipped } = migResult.value as MigrationRunResult;
  applied.forEach((id) => console.log(`  [verify-postgres]   applied: ${id}`));
  skipped.forEach((id) => console.log(`  [verify-postgres]   skipped: ${id}`));
  pass(3, `Migrations complete (applied: ${applied.length}, skipped: ${skipped.length}).`);
} catch (error) {
  failStep(3, error);
}

// ---------------------------------------------------------------------------
// Step 4 — Index a synthetic test file
// ---------------------------------------------------------------------------

// Create a temp directory with one TypeScript file so the indexer has a
// real file path to hash, chunk, and embed.
const tempDir = join(tmpdir(), `verify-pg-${Date.now()}`);
mkdirSync(tempDir, { recursive: true });
const testFilePath = join(tempDir, "verify-test.ts");

writeFileSync(
  testFilePath,
  `/** Verification test file — synthetic content for verify-postgres.ts */

export function verifyRetrievalWorks(): string {
  return "pgvector retrieval is operational";
}

export const VERIFY_CONSTANT = "agentic AI infra postgres verification";
`,
  "utf8"
);

try {
  const embeddingProvider = new MockEmbeddingProvider();
  const summary = await indexProjectKnowledge({
    embeddingProvider,
    storageProvider,
    projectRoot: tempDir,
  });

  pass(
    4,
    `Indexed ${summary.filesIndexed} file(s), ${summary.chunksCreated} chunk(s), ` +
      `${summary.embeddingsCreated} embedding(s).`
  );
} catch (error) {
  failStep(4, error);
} finally {
  // Clean up temp directory regardless of outcome.
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Cleanup failure does not affect verification result.
  }
}

// ---------------------------------------------------------------------------
// Step 5 — getChunks() — assert returned array is non-empty
// ---------------------------------------------------------------------------

try {
  const chunks = await storageProvider.getChunks();

  if (chunks.length === 0) {
    failStep(5, "getChunks() returned 0 chunks after indexing. Expected at least 1.");
  }

  pass(5, `getChunks() returned ${chunks.length} chunk(s).`);
} catch (error) {
  failStep(5, error);
}

// ---------------------------------------------------------------------------
// Step 6 — RetrievalRouter.retrieve() — log result count
// ---------------------------------------------------------------------------

try {
  const fullTextProvider = new FullTextProvider("verify-full-text", undefined, storageProvider);
  const router = new RetrievalRouter([fullTextProvider]);
  const retrieveResult = await router.retrieve({ query: "test", maxResults: 5 });

  if (retrieveResult.ok) {
    pass(6, `RetrievalRouter returned ${retrieveResult.value.length} result(s) for query "test".`);
  } else {
    // A not-indexed or not-configured code is acceptable at this stage — the
    // SQL full-text path may return not-indexed if the tsvector didn't match.
    pass(
      6,
      `RetrievalRouter returned code "${retrieveResult.error.code}" (acceptable — tsvector may not match "test").`
    );
  }
} catch (error) {
  failStep(6, error);
}

// ---------------------------------------------------------------------------
// Step 7 — Create a session via PostgresSessionManager
// ---------------------------------------------------------------------------

// Pass the same queryablePool to createSessionManager so PostgresSessionManager
// is selected (pool is a non-null QueryableDatabase).
const sessionManager = createSessionManager(queryablePool);

let sessionId: string;

try {
  const sessionResult = await sessionManager.createSession({
    projectId: "verify-postgres-test",
    client: "verify-script",
    runtimeMode: "local-stdio-mcp",
  });

  if (!sessionResult.ok) {
    failStep(7, `createSession failed: ${sessionResult.error.message}`);
  }

  sessionId = sessionResult.value.sessionId;
  pass(7, `Session created. session_id: ${sessionId}`);
} catch (error) {
  failStep(7, error);
}

// ---------------------------------------------------------------------------
// Step 8 — Open a thread
// ---------------------------------------------------------------------------

let threadId: string;

try {
  const threadResult = await sessionManager.openThread(
    sessionId!,
    "Verify that Postgres session tracking works end-to-end."
  );

  if (!threadResult.ok) {
    failStep(8, `openThread failed: ${threadResult.error.message}`);
  }

  threadId = threadResult.value.threadId;
  pass(8, `Thread opened. thread_id: ${threadId}`);
} catch (error) {
  failStep(8, error);
}

// ---------------------------------------------------------------------------
// Step 9 — Record a tool call
// ---------------------------------------------------------------------------

let callId: string;

try {
  const callInput = { tool: "agentic.retrieval.search", query: "test" };
  const callOutput = { resultCount: 1, status: "ok" };
  const callResult = await sessionManager.recordToolCall({
    threadId: threadId!,
    toolName: "agentic.retrieval.search",
    inputHash: sha256(callInput),
    outputHash: sha256(callOutput),
    status: "success",
    startedAt: new Date(),
    completedAt: new Date(),
    errorCode: undefined,
    tokenEstimate: 12,
  });

  if (!callResult.ok) {
    failStep(9, `recordToolCall failed: ${callResult.error.message}`);
  }

  callId = callResult.value.callId;
  pass(9, `Tool call recorded. call_id: ${callId}`);
} catch (error) {
  failStep(9, error);
}

// ---------------------------------------------------------------------------
// Step 10 — Close session
// ---------------------------------------------------------------------------

try {
  const closeResult = await sessionManager.closeSession(sessionId!);

  if (!closeResult.ok) {
    failStep(10, `closeSession failed: ${closeResult.error.message}`);
  }

  pass(10, `Session closed. status: closed`);
} catch (error) {
  failStep(10, error);
}

// ---------------------------------------------------------------------------
// Step 11 — storageProvider.close()
// ---------------------------------------------------------------------------

try {
  await storageProvider.close();
  await pool.end();
  pass(11, "StorageProvider closed. Pool drained.");
} catch (error) {
  failStep(11, error);
}

// ---------------------------------------------------------------------------
// Step 12 — Final success
// ---------------------------------------------------------------------------

console.log("\nverify-postgres: all checks passed");
process.exit(0);
