/**
 * Stage 21 — SmartRouter query rewrite path in agentic.retrieval.search.
 *
 * Tests the query rewrite guard: the handler correctly rewrites with a valid
 * provider, rejects mock artifacts, and degrades silently on provider failure.
 * All assertions are deterministic and require no network access.
 */
import { describe, expect, it } from "vitest";
import type { FrameworkResult, LlmRequest, LlmResponse, ToolContract, ToolExecutionContext } from "@maharudra/agentic-ai-infra-core";
import {
  FullTextProvider,
  RetrievalRouter,
  createFrameworkToolHandlers
} from "../src/index.js";
import { SmartRouter } from "../src/llm/smart-router.js";
import { MockLlmProvider } from "../src/llm/mock-llm-provider.js";
import { DEFAULT_COST_CATALOG } from "../src/llm/cost-catalog.js";
import { NoopBudgetGate } from "../src/llm/budget-gate.js";

// ---------------------------------------------------------------------------
// Corpus fixture
// ---------------------------------------------------------------------------

const corpus = {
  documents: [
    {
      sourceId: "docs/runtime",
      title: "Runtime Adapters",
      content: "# Runtime Adapters\nRemote runtime requires auth and audit.\nruntime context engineering",
      sourcePriority: 3,
      sourceVersion: "v1"
    }
  ],
  chunks: [
    {
      chunkId: "chunk-runtime",
      sourceId: "docs/runtime",
      content: "Remote runtime requires auth, audit, and rate limits. runtime engine."
    }
  ]
};

const retrievalRouter = new RetrievalRouter([new FullTextProvider("ft", corpus)]);

// ---------------------------------------------------------------------------
// Provider stubs
// ---------------------------------------------------------------------------

/** Returns a valid rewritten query instead of the mock artifact. */
class RewritingMockLlmProvider extends MockLlmProvider {
  override async complete(_request: LlmRequest): Promise<FrameworkResult<LlmResponse>> {
    return {
      ok: true,
      value: {
        content: "semantic retrieval context engineering",
        inputTokens: 1,
        outputTokens: 4,
        totalTokens: 5,
        model: "mock-v1",
        providerId: this.id,
        estimatedCostUsd: 0
      }
    };
  }
}

/** Always returns llm.provider-unavailable — used to test graceful degradation. */
class FailingMockLlmProvider extends MockLlmProvider {
  override async complete(_request: LlmRequest): Promise<FrameworkResult<LlmResponse>> {
    return {
      ok: false,
      error: {
        code: "llm.provider-unavailable",
        message: "test failure",
        severity: "recoverable"
      }
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSmartRouter(provider: MockLlmProvider): SmartRouter {
  return new SmartRouter(
    [provider],
    { preferLocal: true, maxCostPerCallUsd: 1.0, fallbackChain: [] },
    DEFAULT_COST_CATALOG,
    new NoopBudgetGate()
  );
}

function makeContext(toolId: string): ToolExecutionContext {
  const contract: ToolContract = {
    id: toolId,
    name: toolId,
    description: "Test tool",
    category: "retrieval",
    riskLevel: "low",
    outputPolicy: { remoteSafe: true, maxBytes: 8192 },
    runtimePolicy: { allowedModes: ["local-stdio-mcp"], remoteSafe: true }
  };
  return {
    runtimeMode: "local-stdio-mcp",
    traceId: "trace-test",
    runId: "run-test",
    tool: contract,
    startedAt: new Date().toISOString()
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("agentic.retrieval.search — query rewrite (Stage 21)", () => {

  it("no smartRouter: output.query equals original, no rewrittenQuery field", async () => {
    const handlers = createFrameworkToolHandlers(retrievalRouter);
    const handler = handlers.get("agentic.retrieval.search")!;

    const result = await handler({ query: "runtime" }, makeContext("agentic.retrieval.search"));

    expect(result.ok).toBe(true);
    if (result.ok) {
      const output = result.value.output as Record<string, unknown>;
      expect(output.query).toBe("runtime");
      expect(output.rewrittenQuery).toBeUndefined();
    }
  });

  it("RewritingMockLlmProvider: rewrittenQuery is set and differs from original", async () => {
    const handlers = createFrameworkToolHandlers(
      retrievalRouter,
      makeSmartRouter(new RewritingMockLlmProvider("rewriter"))
    );
    const handler = handlers.get("agentic.retrieval.search")!;

    const result = await handler({ query: "runtime" }, makeContext("agentic.retrieval.search"));

    expect(result.ok).toBe(true);
    if (result.ok) {
      const output = result.value.output as Record<string, unknown>;
      expect(output.query).toBe("runtime");
      expect(output.rewrittenQuery).toBe("semantic retrieval context engineering");
    }
  });

  it("MockLlmProvider (returns [mock]...): guard rejects rewrite, no rewrittenQuery", async () => {
    const handlers = createFrameworkToolHandlers(
      retrievalRouter,
      makeSmartRouter(new MockLlmProvider("mock-guard-test"))
    );
    const handler = handlers.get("agentic.retrieval.search")!;

    const result = await handler({ query: "runtime" }, makeContext("agentic.retrieval.search"));

    expect(result.ok).toBe(true);
    if (result.ok) {
      const output = result.value.output as Record<string, unknown>;
      // Guard blocked the "[mock] received N chars" artifact.
      expect(output.rewrittenQuery).toBeUndefined();
    }
  });

  it("FailingMockLlmProvider: handler returns ok with no rewrittenQuery", async () => {
    const handlers = createFrameworkToolHandlers(
      retrievalRouter,
      makeSmartRouter(new FailingMockLlmProvider("failing"))
    );
    const handler = handlers.get("agentic.retrieval.search")!;

    const result = await handler({ query: "runtime" }, makeContext("agentic.retrieval.search"));

    // Provider failure must not propagate — handler degrades silently.
    expect(result.ok).toBe(true);
    if (result.ok) {
      const output = result.value.output as Record<string, unknown>;
      expect(output.rewrittenQuery).toBeUndefined();
    }
  });
});
