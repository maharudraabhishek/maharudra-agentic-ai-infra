/**
 * e2e-smoke.test.ts
 *
 * End-to-end critical-path smoke test for MahaRudra Agentic AI Infra.
 *
 * Verifies the full integration chain — config → indexer → retrieval → context
 * → live tool handlers — without a real Postgres instance. Every assertion uses
 * MockEmbeddingProvider and in-memory stubs so the test passes in CI and local
 * development regardless of database availability.
 *
 * Individual unit tests for each component live in their respective packages.
 * This file re-runs the most critical assertions as a single smoke check so
 * integration regressions surface immediately on any `pnpm ci` run.
 */

import { describe, expect, it } from "vitest";
import {
  DefaultConfigValidator
} from "@maharudra/agentic-ai-infra-core";
import type {
  FrameworkResult,
  StorageHealth,
  StorageProvider,
  ToolContract,
  ToolExecutionContext
} from "@maharudra/agentic-ai-infra-core";
import { ok } from "@maharudra/agentic-ai-infra-core";
import {
  ContextBuilder,
  FullTextProvider,
  MOCK_EMBEDDING_DIMENSION,
  MockEmbeddingProvider,
  RetrievalRouter,
  createFrameworkToolHandlers,
  hasIndexStorageCapability
} from "@maharudra/agentic-ai-infra-runtime";

// ---------------------------------------------------------------------------
// Shared fixture helpers
// ---------------------------------------------------------------------------

/**
 * Returns a minimal ToolExecutionContext for handler invocations.
 * Mirrors the fixture in runtime's tools-live-handlers.test.ts.
 */
function makeContext(toolId: string): ToolExecutionContext {
  const contract: ToolContract = {
    id: toolId,
    name: toolId,
    description: "Smoke test tool",
    category: "retrieval",
    riskLevel: "low",
    outputPolicy: { remoteSafe: true, maxBytes: 8192 },
    runtimePolicy: { allowedModes: ["local-stdio-mcp"], remoteSafe: true }
  };
  return {
    runtimeMode: "local-stdio-mcp",
    traceId: "trace-smoke",
    runId: "run-smoke",
    tool: contract,
    startedAt: new Date().toISOString()
  };
}

/**
 * Minimal in-memory StorageProvider that does NOT implement
 * KnowledgeIndexStorageCapability. Represents what CI environments provide
 * when no Postgres instance is available.
 */
const inMemoryStore: StorageProvider = {
  id: "memory-smoke",
  type: "memory",
  healthCheck: (): Promise<FrameworkResult<StorageHealth>> =>
    Promise.resolve(ok({ providerId: "memory-smoke", ready: true }))
};

// ---------------------------------------------------------------------------
// Smoke tests
// ---------------------------------------------------------------------------

describe("E2E smoke — full critical path without a database", () => {
  // 1. Config validation
  it("config validates cleanly for the local-context profile", () => {
    const result = new DefaultConfigValidator().validate({
      project: { name: "Smoke Test Project", slug: "smoke-test-project" },
      profiles: ["local-context"]
    });
    expect(result.ok).toBe(true);
  });

  // 2. MockEmbeddingProvider initialises
  it("MockEmbeddingProvider initialises with correct properties and produces stable vectors", async () => {
    const provider = new MockEmbeddingProvider();
    expect(provider.dimension).toBe(MOCK_EMBEDDING_DIMENSION);
    expect(provider.model).toBe("agentic-ai-infra-mock-embedding");

    const result = await provider.embedText("smoke test query");
    expect(result.embedding.length).toBe(provider.dimension);
    // Two-pass SHA-256 vectors are unit-normalised — magnitude ≈ 1.0.
    const magnitude = Math.sqrt(result.embedding.reduce((s, v) => s + v * v, 0));
    expect(magnitude).toBeCloseTo(1.0, 5);
    // Same input must always produce identical vectors (deterministic).
    const result2 = await provider.embedText("smoke test query");
    expect(result2.embedding).toEqual(result.embedding);
  });

  // 3. hasIndexStorageCapability returns false for in-memory store
  it("hasIndexStorageCapability() returns false for an in-memory StorageProvider (no Postgres in CI)", () => {
    // Expected: false. An in-memory provider has no lookupIndexedFileHash,
    // storeKnowledgeChunks, or recordIndexRun methods, so the duck-type guard
    // correctly reports it lacks persistence capability. This is the normal CI
    // outcome and must not be treated as an error by the calling pipeline.
    expect(hasIndexStorageCapability(inMemoryStore)).toBe(false);
  });

  // 4. RetrievalRouter returns empty results when no data is indexed
  it("RetrievalRouter initialises and returns empty results when corpus is empty", async () => {
    // FullTextProvider with an empty corpus emits a recoverable not-indexed
    // failure. The router absorbs recoverable failures and returns ok([]) so
    // callers can distinguish "nothing indexed yet" from a retrieval error.
    const emptyCorpus = { documents: [], chunks: [] };
    const router = new RetrievalRouter([new FullTextProvider("full-smoke", emptyCorpus)]);
    const result = await router.retrieve({ query: "smoke test", maxResults: 10 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Array.isArray(result.value)).toBe(true);
      expect(result.value.length).toBe(0);
    }
  });

  // 5. ContextBuilder with no retrieval results
  it("ContextBuilder builds an empty context packet without error", async () => {
    const contextResult = await new ContextBuilder().build({
      task: "smoke test task",
      retrievalResults: [],
      tokenBudget: {
        maxTotalTokens: 4500,
        maxContextTokens: 4000,
        maxResponseTokens: 500
      }
    });
    expect(contextResult.ok).toBe(true);
    if (contextResult.ok) {
      expect(typeof contextResult.value.id).toBe("string");
      expect(contextResult.value.sources.length).toBe(0);
      expect(typeof contextResult.value.contextText).toBe("string");
      expect(typeof contextResult.value.tokenEstimate).toBe("number");
      expect(contextResult.value.tokenEstimate).toBeGreaterThan(0);
    }
  });

  // 6. agentic.retrieval.search — not-configured when no router injected
  it("agentic.retrieval.search handler returns not-configured status when no router is injected", async () => {
    const handlers = createFrameworkToolHandlers(); // no RetrievalRouter supplied
    const handler = handlers.get("agentic.retrieval.search")!;
    const result = await handler({ query: "runtime" }, makeContext("agentic.retrieval.search"));

    expect(result.ok).toBe(true);
    if (result.ok) {
      const output = result.value.output as Record<string, unknown>;
      expect(output.status).toBe("not-configured");
      expect(Array.isArray(output.results)).toBe(true);
      expect(output.resultCount).toBe(0);
    }
  });

  // 7. agentic.context.build — not-configured when no router injected
  it("agentic.context.build handler returns not-configured status when no router is injected", async () => {
    const handlers = createFrameworkToolHandlers(); // no RetrievalRouter supplied
    const handler = handlers.get("agentic.context.build")!;
    const result = await handler({ task: "Explain runtime." }, makeContext("agentic.context.build"));

    expect(result.ok).toBe(true);
    if (result.ok) {
      const output = result.value.output as Record<string, unknown>;
      expect(output.status).toBe("not-configured");
      expect(Array.isArray(output.citations)).toBe(true);
      expect(output.sourceCount).toBe(0);
    }
  });
});
