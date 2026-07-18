/**
 * @fileoverview local-context end-to-end example — MahaRudra Agentic AI Infra
 *
 * Demonstrates Postgres-backed RAG and persistent sessions using the `local-context`
 * profile. Mirrors the vectorless-local example in structure but requires a running
 * Postgres instance (Docker recommended).
 *
 * **What this example demonstrates:**
 * - Resolving the `local-context` built-in profile via `DefaultProfileResolver`.
 * - Constructing `PostgresStorageProvider` with `DATABASE_URL` from the environment.
 * - Auto-wiring a `RetrievalRouter` (FullTextProvider, DocumentTreeProvider,
 *   SymbolCodeProvider) backed by Postgres via `createRuntimeServiceContainer`.
 * - Running framework migrations when `RUN_AGENTIC_AI_INFRA_MIGRATIONS` is set,
 *   replicating the logic from `startLocalRuntime` without connecting a transport.
 * - Indexing a local directory with `indexProjectKnowledge` using `MockEmbeddingProvider`
 *   (deterministic SHA-256 vectors, zero network calls). Production use: substitute
 *   `LocalEmbeddingProvider` (Ollama/LocalAI) or a real provider at this point.
 * - Printing `session_id` and `run_id` in the stdout JSON output to prove that
 *   session tracking is active for this run.
 * - Calling `storageProvider.close()` in a `finally` block to drain the Postgres pool.
 *
 * **Prerequisites:**
 * - Docker Desktop running.
 * - `docker compose up -d postgres` from the monorepo root.
 * - Copy `.env.example` to `.env`; verify `DATABASE_URL` matches docker-compose defaults.
 *
 * **How to run:**
 * ```sh
 * pnpm --filter @maharudra/agentic-ai-infra-examples start:local-context
 * # With migrations (required on first run):
 * # Bash:       RUN_AGENTIC_AI_INFRA_MIGRATIONS=true pnpm ...
 * # PowerShell: $env:RUN_AGENTIC_AI_INFRA_MIGRATIONS="true"; pnpm ...
 * ```
 *
 * **How this differs from vectorless-local:**
 * - Uses `PostgresStorageProvider` instead of `InMemoryStorageProvider` (data persists).
 * - Requires `DATABASE_URL` (exits 0 with a helpful setup message if absent).
 * - Optionally runs migrations via `RUN_AGENTIC_AI_INFRA_MIGRATIONS` env var.
 * - Prints `session_id` and `run_id` in stdout JSON to show session tracking is working.
 *
 * **Upgrade path:**
 * - Swap `MockEmbeddingProvider` for `LocalEmbeddingProvider` (Ollama) for semantic vectors.
 * - Change profile to `full-agentic-context` for all 6 retrieval providers (adds pgvector).
 * - Inject a `QueryableDatabase` to activate `PostgresSessionManager` for cross-restart
 *   session continuity. See `scripts/verify-postgres.ts` for the injection pattern.
 * - Use `TokenEfficientMultiAgentExecutor` when multi-agent mode is needed.
 */

import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import {
  DefaultProfileResolver
} from "@maharudra/agentic-ai-infra-core";
import {
  createRuntimeServiceContainer,
  LocalStdioMcpRuntimeAdapter,
  indexProjectKnowledge,
  MockEmbeddingProvider,
  PostgresStorageProvider,
  RUN_AGENTIC_AI_INFRA_MIGRATIONS,
  SingleAgentExecutor
} from "@maharudra/agentic-ai-infra-runtime";

// Resolve the examples/ directory without hardcoded absolute paths.
// When run via tsx: examples/src/local-context/index.ts — two levels up → examples/
// When compiled:   examples/dist/local-context/index.js — two levels up → examples/
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const examplesRoot = path.resolve(__dirname, "../..");

/**
 * Runs the local-context example: guard → resolve → provider → container
 * → migrate → start → index → search → print → stop.
 *
 * All diagnostic output goes to stderr. Only the final JSON (session ids + search
 * result) goes to stdout, keeping stdout compatible with MCP STDIO framing if a
 * transport is later attached to the same process.
 */
async function main(): Promise<void> {
  // -----------------------------------------------------------------------
  // Startup guard: DATABASE_URL is required for PostgresStorageProvider.
  //
  // Exit 0 (not 1) — a missing env var is a configuration gap, not a crash.
  // The user needs to complete setup steps, not investigate an error.
  // -----------------------------------------------------------------------
  const databaseUrl = process.env["DATABASE_URL"];

  if (!databaseUrl) {
    process.stderr.write(
      "[example] DATABASE_URL is not set — cannot start local-context example.\n" +
      "  Set DATABASE_URL in .env — see .env.example\n" +
      "  Quick setup:\n" +
      "    docker compose up -d postgres   # from the monorepo root\n" +
      "    cp .env.example .env\n"
    );
    process.exit(0);
  }

  // -----------------------------------------------------------------------
  // Step 1: Resolve the local-context capability profile.
  //
  // DefaultProfileResolver merges the built-in local-context config on top of
  // DEFAULT_PROJECT_CONFIG. The result has:
  //   - storage.providers[0].type = "postgres"  → Postgres provider required
  //   - retrieval.enabled = true (full-text, document-tree, symbol-code)
  //   - agents.mode = "single-agent" (inherited from framework baseline)
  //   - tokenEfficiency.tokenBudget inherited from baseline
  // -----------------------------------------------------------------------
  const resolver = new DefaultProfileResolver();
  const configResult = resolver.resolve({
    project: { name: "local-context-example", slug: "local-context-example" },
    profiles: ["local-context"]
  });

  if (!configResult.ok) {
    process.stderr.write(
      `[example] profile resolution failed: ${configResult.error.message}\n`
    );
    process.exit(1);
  }

  const resolvedConfig = configResult.value;
  process.stderr.write(
    `[example] profile resolved: ${resolvedConfig.profiles.join(", ")}\n`
  );

  // -----------------------------------------------------------------------
  // Step 2: Construct PostgresStorageProvider.
  //
  // The provider creates a pg.Pool lazily on first query — no connection is
  // opened during construction or import. Pool defaults: min:2, max:10,
  // idle:30s, timeout:5s. Pass optional pool overrides via params.pool if
  // the defaults are insufficient for your environment.
  //
  // close() drains the pool and must be called before the process exits.
  // This example calls it explicitly in the finally block.
  // -----------------------------------------------------------------------
  const storageProvider = new PostgresStorageProvider("local-context-store", {
    connectionString: databaseUrl
  });

  // -----------------------------------------------------------------------
  // Step 3: Create the runtime service container.
  //
  // Passing storageProvider in options takes precedence over any auto-wiring.
  // createRuntimeServiceContainer detects that PostgresStorageProvider
  // implements KnowledgeIndexStorageCapability (via getChunks) and auto-creates
  // a RetrievalRouter with FullTextProvider, DocumentTreeProvider, and
  // SymbolCodeProvider all backed by this Postgres provider.
  //
  // NOTE: Because the provider was constructed with connectionString only (no
  // injected QueryableDatabase), storageProvider.db returns undefined. The
  // session manager duck-type check finds no db, so InMemorySessionManager is
  // selected. For PostgresSessionManager, inject a QueryableDatabase adapter —
  // see scripts/verify-postgres.ts for the pattern.
  // -----------------------------------------------------------------------
  const containerResult = createRuntimeServiceContainer({ config: resolvedConfig, storageProvider });

  if (!containerResult.ok) {
    process.stderr.write(
      `[example] container creation failed: ${containerResult.error.message}\n`
    );
    await storageProvider.close();
    process.exit(1);
  }

  const container = containerResult.value;

  // -----------------------------------------------------------------------
  // Step 4: Run migrations if requested (same pattern as startLocalRuntime).
  //
  // This replicates the migration startup logic from startLocalRuntime() without
  // calling startLocalRuntime() directly — examples do not connect transports.
  //
  // Set RUN_AGENTIC_AI_INFRA_MIGRATIONS to any non-empty string (e.g. "true")
  // to apply all pending framework migrations before indexing begins.
  // Required on the first run against a fresh Postgres instance.
  // -----------------------------------------------------------------------
  const envMigrations = process.env["RUN_AGENTIC_AI_INFRA_MIGRATIONS"];

  if (storageProvider.type === "postgres" && envMigrations) {
    process.stderr.write("[example] running migrations...\n");
    const migResult = await storageProvider.runMigrations(RUN_AGENTIC_AI_INFRA_MIGRATIONS);

    if (!migResult.ok) {
      process.stderr.write(
        `[example] migration failed: ${migResult.error.message}\n`
      );
      await storageProvider.close();
      process.exit(1);
    }

    const { applied, skipped } = migResult.value;
    process.stderr.write(
      `[example] migrations: ${applied.length} applied, ${skipped.length} skipped\n`
    );
  } else if (storageProvider.type === "postgres" && !envMigrations) {
    process.stderr.write(
      "[example] tip: set RUN_AGENTIC_AI_INFRA_MIGRATIONS=true on first run to apply migrations.\n"
    );
  }

  // Start the local STDIO adapter to obtain a typed RuntimeHandle with stop().
  // In a generated start.ts this adapter also connects a StdioServerTransport.
  // Here the handle is used only for context framing.
  const handleResult = await new LocalStdioMcpRuntimeAdapter(container).start();

  if (!handleResult.ok) {
    process.stderr.write(
      `[example] adapter start failed: ${handleResult.error.message}\n`
    );
    await storageProvider.close();
    process.exit(1);
  }

  const handle = handleResult.value;
  process.stderr.write(
    `[example] runtime ready: mode=${handle.mode}, ` +
    `tools=${handle.registeredTools.length}\n`
  );

  try {
    // -----------------------------------------------------------------------
    // Step 5: Index the examples/ directory.
    //
    // MockEmbeddingProvider: deterministic SHA-256 vectors, 64 dimensions, zero
    // network. Production use: substitute LocalEmbeddingProvider (Ollama/LocalAI)
    // or a real EmbeddingProvider at this callsite.
    //
    // For the local-context profile, storeKnowledgeChunks() persists chunks and
    // embedding vectors to Postgres — data survives process restarts. On repeated
    // runs, unchanged files are skipped via hash-based freshness checks.
    //
    // Blocked directories (node_modules, dist, .git, etc.) are excluded by
    // isIndexablePath policy — the indexer never reads them.
    // -----------------------------------------------------------------------
    process.stderr.write(`[example] indexing ${examplesRoot} ...\n`);

    const indexSummary = await indexProjectKnowledge({
      embeddingProvider: new MockEmbeddingProvider(),
      storageProvider,
      projectRoot: examplesRoot
    });

    process.stderr.write(
      `[example] index complete: ` +
      `${indexSummary.filesIndexed} files indexed, ` +
      `${indexSummary.chunksCreated} chunks, ` +
      `${indexSummary.fileErrorCount} file errors\n`
    );

    if (indexSummary.filesIndexed === 0) {
      process.stderr.write(
        "[example] no indexable files found — only .md, .ts, .tsx files " +
        "outside blocked directories are indexed.\n"
      );
    }

    // -----------------------------------------------------------------------
    // Step 6a: Run the SingleAgentExecutor planning pass.
    //
    // Pass a known sessionId so it is visible in the stdout output below,
    // proving that session tracking is wired for this run. The executor calls
    // resumeOrCreateSession(exampleSessionId, ...) internally — with InMemory
    // SessionManager the session is tracked in-process for this run.
    //
    // The deterministic executor performs no LLM API calls, no network access.
    // -----------------------------------------------------------------------
    const exampleSessionId = randomUUID();
    const executor = new SingleAgentExecutor({
      config: resolvedConfig,
      trajectoryRecorder: container.trajectoryRecorder,
      tokenRecorder: container.tokenRecorder,
      sessionManager: container.sessionManager,
      sessionId: exampleSessionId,
      agentRegistry: container.agentRegistry
    });

    const agentResult = await executor.execute({
      task: "Search the project knowledge base for local-context Postgres usage examples"
    });

    let runId: string | undefined;

    if (agentResult.ok) {
      runId = agentResult.value.runId;
      process.stderr.write(
        `[example] agent plan: ` +
        `selected=[${agentResult.value.selectedToolIds.join(", ")}], ` +
        `tokens=${agentResult.value.tokenUsage.totalTokens}\n`
      );
    } else {
      // Non-fatal: log the reason and continue to the live retrieval step.
      process.stderr.write(
        `[example] agent plan skipped: ${agentResult.error.message}\n`
      );
    }

    // -----------------------------------------------------------------------
    // Step 6b: Execute agentic.retrieval.search via the live Postgres handler.
    //
    // The Postgres-backed RetrievalRouter dispatches to FullTextProvider,
    // DocumentTreeProvider, and SymbolCodeProvider. FullTextProvider uses the
    // SQL tsvector path (search_vector @@ plainto_tsquery) when storageProvider
    // is Postgres-backed. Results are bounded to ≤10 with previews ≤300 chars.
    // -----------------------------------------------------------------------
    const searchTool = container.tools.find((t) => t.id === "agentic.retrieval.search");
    const searchHandler = container.handlers.get("agentic.retrieval.search");

    if (!searchHandler || !searchTool) {
      throw new Error(
        "agentic.retrieval.search not found in container. " +
        "Verify the tool contract is registered."
      );
    }

    const searchResult = await Promise.resolve(
      searchHandler(
        { query: "local-context postgres" },
        {
          runtimeMode: "local-stdio-mcp",
          traceId: "local-context-example-trace",
          runId: "local-context-example-run",
          tool: searchTool,
          startedAt: new Date().toISOString()
        }
      )
    );

    // -----------------------------------------------------------------------
    // Step 7: Print results to stdout.
    //
    // session_id is the UUID passed to SingleAgentExecutor — the executor called
    // resumeOrCreateSession(session_id, ...) internally, so this id IS the live
    // session identifier. run_id is the deterministic run identifier derived from
    // the task hash via sha256. Together they prove session tracking is wired.
    //
    // stdout is reserved for the MCP protocol if a transport is attached later.
    // All diagnostic output went to stderr to avoid corrupting protocol framing.
    // -----------------------------------------------------------------------
    const output = {
      session_id: exampleSessionId,
      run_id: runId ?? "skipped",
      search: searchResult.ok
        ? searchResult.value.output
        : { error: { code: searchResult.error.code, message: searchResult.error.message } }
    };

    process.stdout.write(JSON.stringify(output, null, 2) + "\n");
  } finally {
    // -----------------------------------------------------------------------
    // Step 8: Drain the Postgres connection pool.
    //
    // storageProvider.close() is idempotent (#closed flag) and MUST be called
    // before the process exits to release all connections back to the Postgres
    // server. Without it the Node process may hang waiting for idle connections.
    //
    // LocalStdioMcpRuntimeAdapter.stop() also calls container.storageProvider
    // ?.close() internally. Calling close() here explicitly makes the Postgres
    // pool-drain contract visible in examples that own the provider directly.
    // -----------------------------------------------------------------------
    await storageProvider.close();
    process.stderr.write("[example] stopped.\n");
  }
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[example] fatal: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(1);
});
