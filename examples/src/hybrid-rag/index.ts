/**
 * @fileoverview hybrid-rag retrieval demo — MahaRudra Agentic AI Infra
 *
 * Demonstrates the hybrid-rag profile retrieval pipeline end-to-end:
 * - `DefaultProfileResolver` resolves the hybrid-rag built-in profile.
 * - `PostgresStorageProvider` persists indexed chunks (SQL-backed retrieval).
 * - `FullTextProvider`, `PageIndexProvider`, and `SymbolCodeProvider` are wired
 *   manually to show each component explicitly (mirrors what
 *   `createRuntimeServiceContainer` auto-wires for the hybrid-rag profile).
 * - `ReciprocalRankFusion` merges per-provider result lists.
 * - `HeuristicReranker` reorders merged results by exact-match, recency,
 *   source type, and heading depth.
 *
 * Requires: Postgres running on port 5433.
 * Start with: docker compose up -d postgres (from monorepo root)
 * Environment: DATABASE_URL must be set (see .env.example)
 * Setup guide: docs/06-runbooks/examples-quickstart-postgres.md
 *
 * **How to run:**
 * ```sh
 * pnpm --filter @maharudra/agentic-ai-infra-examples start:hybrid-rag
 * # With migrations (required on first run):
 * # Bash:       RUN_AGENTIC_AI_INFRA_MIGRATIONS=true pnpm ...
 * # PowerShell: $env:RUN_AGENTIC_AI_INFRA_MIGRATIONS="true"; pnpm ...
 * ```
 *
 * **Expected output (stderr):**
 * - Profile resolution, migration, and indexing progress messages.
 *
 * **Expected output (stdout):**
 * - JSON: `{ profile, merger, reranker, providerCount, top3 }` showing
 *   merged + reranked results with scores and source types.
 */

import { fileURLToPath } from "node:url";
import * as path from "node:path";
import {
  DefaultProfileResolver
} from "@maharudra/agentic-ai-infra-core";
import {
  PostgresStorageProvider,
  RUN_AGENTIC_AI_INFRA_MIGRATIONS,
  MockEmbeddingProvider,
  ReciprocalRankFusion,
  HeuristicReranker,
  RetrievalRouter,
  FullTextProvider,
  PageIndexProvider,
  SymbolCodeProvider,
  indexProjectKnowledge
} from "@maharudra/agentic-ai-infra-runtime";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// When run via tsx: examples/src/hybrid-rag/index.ts — two levels up → examples/
// When compiled:   examples/dist/hybrid-rag/index.js — two levels up → examples/
const examplesRoot = path.resolve(__dirname, "../..");

/**
 * Runs the hybrid-rag retrieval demo:
 * guard → profile resolve → Postgres provider → migrate → index
 * → RRF+heuristic retrieval → print → close.
 *
 * All diagnostic output goes to stderr. Only the final JSON goes to stdout,
 * keeping stdout compatible with MCP STDIO framing if a transport is later
 * attached to the same process.
 */
async function main(): Promise<void> {
  // -----------------------------------------------------------------------
  // Startup guard: DATABASE_URL is required for PostgresStorageProvider.
  //
  // Exit 0 (not 1) — a missing env var is a configuration gap, not a crash.
  // -----------------------------------------------------------------------
  const databaseUrl = process.env["DATABASE_URL"];

  if (!databaseUrl) {
    process.stderr.write(
      "[example] DATABASE_URL is not set — cannot start hybrid-rag example.\n" +
      "  Set DATABASE_URL in .env — see .env.example\n" +
      "  Quick setup:\n" +
      "    docker compose up -d postgres   # from the monorepo root\n" +
      "    cp .env.example .env\n" +
      "  Full guide: docs/06-runbooks/examples-quickstart-postgres.md\n"
    );
    process.exit(0);
  }

  // -----------------------------------------------------------------------
  // Step 1: Resolve the hybrid-rag capability profile.
  // -----------------------------------------------------------------------
  const resolver = new DefaultProfileResolver();
  const configResult = resolver.resolve({
    project: { name: "hybrid-rag-example", slug: "hybrid-rag-example" },
    profiles: ["hybrid-rag"]
  });

  if (!configResult.ok) {
    process.stderr.write(
      `[hybrid-rag] profile resolution failed: ${configResult.error.message}\n`
    );
    process.exit(1);
  }

  process.stderr.write(
    `[hybrid-rag] profile resolved: ${configResult.value.profiles.join(", ")}\n`
  );

  // -----------------------------------------------------------------------
  // Step 2: Construct PostgresStorageProvider.
  //
  // The provider creates a pg.Pool eagerly from the connectionString. Pool
  // defaults: min:2, max:10, idle:30s, timeout:5s.
  // close() drains the pool and must be called before the process exits.
  // -----------------------------------------------------------------------
  const storageProvider = new PostgresStorageProvider("hybrid-rag-store", {
    connectionString: databaseUrl,
  });

  // -----------------------------------------------------------------------
  // Step 3: Run migrations if requested (same pattern as startLocalRuntime).
  //
  // Set RUN_AGENTIC_AI_INFRA_MIGRATIONS to any non-empty string (e.g. "true")
  // to apply all pending framework migrations before indexing begins.
  // Required on the first run against a fresh Postgres instance.
  // -----------------------------------------------------------------------
  const envMigrations = process.env["RUN_AGENTIC_AI_INFRA_MIGRATIONS"];

  if (storageProvider.type === "postgres" && envMigrations) {
    process.stderr.write("[hybrid-rag] running migrations...\n");
    const migResult = await storageProvider.runMigrations(RUN_AGENTIC_AI_INFRA_MIGRATIONS);

    if (!migResult.ok) {
      process.stderr.write(
        `[hybrid-rag] migration failed: ${migResult.error.message}\n`
      );
      await storageProvider.close();
      process.exit(1);
    }

    const { applied, skipped } = migResult.value;
    process.stderr.write(
      `[hybrid-rag] migrations: ${applied.length} applied, ${skipped.length} skipped\n`
    );
  } else if (storageProvider.type === "postgres" && !envMigrations) {
    process.stderr.write(
      "[hybrid-rag] tip: set RUN_AGENTIC_AI_INFRA_MIGRATIONS=true on first run to apply migrations.\n"
    );
  }

  try {
    // -----------------------------------------------------------------------
    // Step 4: Index the examples/ directory.
    //
    // MockEmbeddingProvider: deterministic SHA-256 vectors, 64 dimensions, zero
    // network. Production use: substitute LocalEmbeddingProvider (Ollama/LocalAI).
    //
    // For the hybrid-rag profile, storeKnowledgeChunks() persists chunks and
    // embedding vectors to Postgres. On repeated runs, unchanged files are
    // skipped via hash-based freshness checks.
    // -----------------------------------------------------------------------
    process.stderr.write(`[hybrid-rag] indexing ${examplesRoot} ...\n`);

    const indexSummary = await indexProjectKnowledge({
      embeddingProvider: new MockEmbeddingProvider(),
      storageProvider,
      projectRoot: examplesRoot
    });

    process.stderr.write(
      `[hybrid-rag] index complete: ${indexSummary.filesIndexed} files, ` +
      `${indexSummary.chunksCreated} chunks\n`
    );

    // -----------------------------------------------------------------------
    // Step 5: Build a hybrid router with RRF merger + heuristic reranker.
    //
    // This mirrors what createRuntimeServiceContainer() auto-wires for the
    // hybrid-rag profile when a real PostgresStorageProvider is passed. Here
    // we construct the router manually to show each component explicitly.
    //
    // FullTextProvider uses the SQL tsvector path (search_vector @@ plainto_tsquery)
    // because storageProvider.db is non-null (pool exposed by Stage 17 Fix A).
    // PageIndexProvider and SymbolCodeProvider use getChunks() bulk SQL fetch.
    // -----------------------------------------------------------------------
    const providers = [
      new FullTextProvider("rag-full-text", undefined, storageProvider),
      new PageIndexProvider("rag-page-index", undefined, storageProvider),
      new SymbolCodeProvider("rag-symbol", undefined, storageProvider)
      // PgVectorProvider omitted: requires a real EmbeddingProvider + Postgres
      // vector path. Add LocalEmbeddingProvider (Ollama) to activate semantic search.
    ];

    const merger   = new ReciprocalRankFusion();
    const reranker = new HeuristicReranker();

    const router = new RetrievalRouter(providers, {
      merger,
      reranker,
      maxResults: 12
    });

    // -----------------------------------------------------------------------
    // Step 6: Run a hybrid retrieval query.
    // -----------------------------------------------------------------------
    const query = "hybrid retrieval quality";
    process.stderr.write(`[hybrid-rag] querying: "${query}"\n`);

    const retrievalResult = await router.retrieve({ query, maxResults: 12 });

    if (!retrievalResult.ok) {
      process.stdout.write(
        JSON.stringify({ error: retrievalResult.error.code }, null, 2) + "\n"
      );
      return;
    }

    const results = retrievalResult.value;

    // -----------------------------------------------------------------------
    // Step 7: Print a structured summary to stdout.
    // -----------------------------------------------------------------------
    const top3 = results.slice(0, 3).map((r) => ({
      sourceId:   r.sourceId,
      score:      Number(r.score.toFixed(4)),
      sourceType: r.sourceType ?? r.metadata?.retrievalType ?? "unknown",
      preview:    r.preview.slice(0, 120)
    }));

    process.stdout.write(
      JSON.stringify({
        profile:       "hybrid-rag",
        merger:        "ReciprocalRankFusion (k=60)",
        reranker:      "HeuristicReranker",
        providerCount: providers.length,
        top3
      }, null, 2) + "\n"
    );

    process.stderr.write("[hybrid-rag] done.\n");
  } finally {
    // -----------------------------------------------------------------------
    // Step 8: Drain the Postgres connection pool.
    //
    // storageProvider.close() is idempotent (#closed flag) and MUST be called
    // before the process exits to release all connections back to the Postgres
    // server. Without it the Node process may hang waiting for idle connections.
    // -----------------------------------------------------------------------
    await storageProvider.close();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[hybrid-rag] fatal: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(1);
});
