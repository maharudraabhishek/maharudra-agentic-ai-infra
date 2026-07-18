/**
 * @fileoverview vectorless-local end-to-end example — MahaRudra Agentic AI Infra
 *
 * Demonstrates the complete retrieval pipeline using the vectorless-local profile:
 * no database, no Docker, no external network — everything runs in process memory.
 *
 * **What this example demonstrates:**
 * - Resolving the `vectorless-local` built-in profile via `DefaultProfileResolver`.
 * - Auto-wiring `InMemoryStorageProvider` and a `RetrievalRouter` from the profile
 *   config without any manual provider construction.
 * - Indexing a local directory with `indexProjectKnowledge` using
 *   `MockEmbeddingProvider` (deterministic SHA-256 vectors, zero network calls).
 * - Running a `SingleAgentExecutor` planning pass to show agent lifecycle (Layer 10).
 * - Calling the `agentic.retrieval.search` tool handler directly and printing results.
 *
 * **Prerequisites:**
 * - Node 20 or later (for `fs.readdir` with `{ recursive: true }` and
 *   `import.meta.url`).
 * - No external services — `pnpm install` is the only setup required.
 *
 * **How to run:**
 * ```sh
 * pnpm --filter @maharudra/agentic-ai-infra-examples build
 * pnpm --filter @maharudra/agentic-ai-infra-examples start:vectorless
 * ```
 *
 * **Expected output:**
 * - Diagnostic progress lines on stderr (profile resolution, indexing, agent plan).
 * - One JSON object on stdout: `{ status, query, results[], resultCount }`.
 *
 * **Upgrading to persistence:**
 * Change `"vectorless-local"` to `"local-context"` in the `profiles` array and
 * supply a `PostgresStorageProvider` in `RuntimeStartOptions`. All other code stays
 * the same. Run migrations 001–003 before the first startup.
 */

import { fileURLToPath } from "node:url";
import * as path from "node:path";
import {
  DefaultProfileResolver
} from "@maharudra/agentic-ai-infra-core";
import {
  createRuntimeServiceContainer,
  LocalStdioMcpRuntimeAdapter,
  indexProjectKnowledge,
  MockEmbeddingProvider,
  SingleAgentExecutor
} from "@maharudra/agentic-ai-infra-runtime";

// Resolve the examples/ directory without hardcoded absolute paths.
// Compiled location: examples/dist/vectorless-local/index.js
// Two levels up from the compiled directory → examples/
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const examplesRoot = path.resolve(__dirname, "../..");

/**
 * Runs the vectorless-local example: resolve → container → index → search → print.
 *
 * All diagnostic output goes to stderr. Only the final JSON search result goes to
 * stdout so the output remains compatible with MCP STDIO framing if a transport is
 * later attached to the same process.
 */
async function main(): Promise<void> {
  // -----------------------------------------------------------------------
  // Step 1: Resolve the vectorless-local capability profile.
  //
  // DefaultProfileResolver merges the built-in profile config on top of the
  // framework baseline (DEFAULT_PROJECT_CONFIG) and then applies the caller's
  // overrides. The result is a fully-populated ResolvedProjectConfig with
  // storage, retrieval, agent, token-budget, and security settings.
  // -----------------------------------------------------------------------
  const resolver = new DefaultProfileResolver();
  const configResult = resolver.resolve({
    project: { name: "vectorless-local-example", slug: "vectorless-local-example" },
    profiles: ["vectorless-local"]
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
  // Step 2: Create the runtime service container.
  //
  // Because vectorless-local declares storage.providers[0].type = "memory",
  // createRuntimeServiceContainer() auto-wires an InMemoryStorageProvider and
  // builds a RetrievalRouter backed by it (FullTextProvider, DocumentTreeProvider,
  // SymbolCodeProvider all wired to the same storage). No options required.
  // -----------------------------------------------------------------------
  const containerResult = createRuntimeServiceContainer({ config: resolvedConfig });

  if (!containerResult.ok) {
    process.stderr.write(
      `[example] container creation failed: ${containerResult.error.message}\n`
    );
    process.exit(1);
  }

  const container = containerResult.value;

  // Guard: vectorless-local always auto-wires a storage provider.
  const storageProvider = container.storageProvider;

  if (!storageProvider) {
    process.stderr.write(
      "[example] storageProvider not auto-wired — check profile config.\n"
    );
    process.exit(1);
  }

  // Start the local STDIO adapter to get a typed RuntimeHandle with stop().
  // In a generated start.ts this adapter also connects a StdioServerTransport.
  // Here the handle is used only for the clean shutdown call at the end.
  const handleResult = await new LocalStdioMcpRuntimeAdapter(container).start();

  if (!handleResult.ok) {
    process.stderr.write(
      `[example] adapter start failed: ${handleResult.error.message}\n`
    );
    process.exit(1);
  }

  const handle = handleResult.value;
  process.stderr.write(
    `[example] runtime ready: mode=${handle.mode}, ` +
    `tools=${handle.registeredTools.length}\n`
  );

  try {
    // -----------------------------------------------------------------------
    // Step 3: Index the examples/ directory.
    //
    // MockEmbeddingProvider: deterministic SHA-256 vectors, 64 dimensions, zero
    // network. The indexer scans .md and .ts files in examplesRoot, chunks them
    // by extension strategy (heading-based for .md, symbol-based for .ts), and
    // stores the resulting KnowledgeChunks in the InMemoryStorageProvider.
    //
    // Blocked directories (node_modules, dist, .git, etc.) are automatically
    // excluded by isIndexablePath policy — the indexer never reads them.
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
    // Step 4a: Run the SingleAgentExecutor planning pass.
    //
    // The executor classifies the task (selecting tool ids and estimating token
    // usage) and opens a session + thread via InMemorySessionManager. No network
    // calls and no tool handlers are invoked during planning — this is a
    // deterministic Layer-10 pass.
    // -----------------------------------------------------------------------
    const executor = new SingleAgentExecutor({
      config: resolvedConfig,
      trajectoryRecorder: container.trajectoryRecorder,
      tokenRecorder: container.tokenRecorder,
      sessionManager: container.sessionManager,
      agentRegistry: container.agentRegistry
    });

    const agentResult = await executor.execute({
      task: "Search the project knowledge base for examples of vectorless-local usage"
    });

    if (agentResult.ok) {
      process.stderr.write(
        `[example] agent plan: ` +
        `selected=[${agentResult.value.selectedToolIds.join(", ")}], ` +
        `tokens=${agentResult.value.tokenUsage.totalTokens}\n`
      );
    } else {
      // Non-fatal: log and continue to the live retrieval step.
      process.stderr.write(
        `[example] agent plan skipped: ${agentResult.error.message}\n`
      );
    }

    // -----------------------------------------------------------------------
    // Step 4b: Execute agentic.retrieval.search to get live results.
    //
    // The handler is called directly here. In MCP mode the AgentHarness would
    // call this same handler for every STDIO tool call received on the transport.
    // The handler delegates to the auto-wired RetrievalRouter, which queries the
    // InMemoryStorageProvider chunks stored in Step 3 via getChunks().
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
        { query: "example" },
        {
          runtimeMode: "local-stdio-mcp",
          traceId: "vectorless-local-example-trace",
          runId: "vectorless-local-example-run",
          tool: searchTool,
          startedAt: new Date().toISOString()
        }
      )
    );

    // -----------------------------------------------------------------------
    // Step 5: Print the result to stdout as JSON.
    //
    // stdout is reserved for the MCP protocol if a transport is attached.
    // All diagnostic output went to stderr to avoid corrupting protocol framing.
    // -----------------------------------------------------------------------
    if (searchResult.ok) {
      process.stdout.write(JSON.stringify(searchResult.value.output, null, 2) + "\n");
    } else {
      process.stdout.write(
        JSON.stringify(
          { error: { code: searchResult.error.code, message: searchResult.error.message } },
          null,
          2
        ) + "\n"
      );
    }
  } finally {
    // -----------------------------------------------------------------------
    // Step 6: Stop cleanly.
    //
    // handle.stop() is the typed shutdown point for the local STDIO adapter.
    // It calls storageProvider.close() internally — clearing the in-memory
    // Maps (vectorless-local) or draining the pool (Postgres profiles).
    // StorageProvider.close() is a formal interface contract, so no
    // duck-typing is required here.
    // -----------------------------------------------------------------------
    await handle.stop();
    process.stderr.write("[example] stopped.\n");
  }
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[example] fatal: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(1);
});
