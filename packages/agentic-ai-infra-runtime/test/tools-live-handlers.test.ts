import { describe, expect, it } from "vitest";
import type { ToolContract, ToolExecutionContext } from "@maharudra/agentic-ai-infra-core";
import { FullTextProvider, RetrievalRouter, createFrameworkToolHandlers } from "../src/index.js";
import type { RetrievalCorpus } from "../src/retrieval/index.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const corpus: RetrievalCorpus = {
  documents: [
    {
      sourceId: "docs/runtime",
      title: "Runtime Adapters",
      content: "# Runtime Adapters\nRemote runtime requires auth and audit.\n[Storage](storage.md)",
      sourcePriority: 3,
      sourceVersion: "v1"
    },
    {
      sourceId: "src/context",
      title: "Context Source",
      content: "import { x } from './runtime';\nexport function buildContext() { return 'context'; }",
      sourcePriority: 2,
      sourceVersion: "v1"
    }
  ],
  chunks: [
    {
      chunkId: "chunk-runtime",
      sourceId: "docs/runtime",
      content: "Remote runtime requires auth, audit, and rate limits."
    },
    {
      chunkId: "chunk-context",
      sourceId: "src/context",
      content: "export function buildContext creates bounded context packages."
    }
  ]
};

const router = new RetrievalRouter([new FullTextProvider("full", corpus)]);

/**
 * Minimal ToolExecutionContext used for all handler invocations.
 */
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
// agentic.retrieval.search
// ---------------------------------------------------------------------------

describe("agentic.retrieval.search live handler", () => {
  it("returns not-configured status when no router is provided", async () => {
    const handlers = createFrameworkToolHandlers();
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

  it("returns live results when router is configured", async () => {
    const handlers = createFrameworkToolHandlers(router);
    const handler = handlers.get("agentic.retrieval.search")!;

    const result = await handler({ query: "runtime" }, makeContext("agentic.retrieval.search"));

    expect(result.ok).toBe(true);

    if (result.ok) {
      const output = result.value.output as Record<string, unknown>;

      expect(output.status).toBe("ok");
      expect(Array.isArray(output.results)).toBe(true);

      const results = output.results as Array<Record<string, unknown>>;

      expect(results.length).toBeGreaterThan(0);
      // Sanitization: no vectors or raw embeddings in output
      expect(JSON.stringify(output)).not.toMatch(/"vector"\s*:|"embedding"\s*:/);
      // Each result must have the required bounded fields
      for (const r of results) {
        expect(typeof r.chunkId).toBe("string");
        expect(typeof r.relPath).toBe("string");
        expect(Array.isArray(r.headingPath)).toBe(true);
        expect(typeof r.preview).toBe("string");
        expect((r.preview as string).length).toBeLessThanOrEqual(300);
        expect(typeof r.score).toBe("number");
      }
    }
  });

  it("returns recoverable error for empty query", async () => {
    const handlers = createFrameworkToolHandlers(router);
    const handler = handlers.get("agentic.retrieval.search")!;

    const result = await handler({ query: "   " }, makeContext("agentic.retrieval.search"));

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("retrieval.unsupported-input");
      expect(result.error.severity).toBe("recoverable");
    }
  });

  it("returns recoverable error when query field is missing", async () => {
    const handlers = createFrameworkToolHandlers(router);
    const handler = handlers.get("agentic.retrieval.search")!;

    const result = await handler({}, makeContext("agentic.retrieval.search"));

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("retrieval.unsupported-input");
    }
  });

  it("respects maxChunks bound on result count", async () => {
    const handlers = createFrameworkToolHandlers(router);
    const handler = handlers.get("agentic.retrieval.search")!;

    const result = await handler(
      { query: "runtime", maxChunks: 1 },
      makeContext("agentic.retrieval.search")
    );

    expect(result.ok).toBe(true);

    if (result.ok) {
      const output = result.value.output as Record<string, unknown>;
      const results = output.results as unknown[];

      expect(results.length).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// agentic.context.build
// ---------------------------------------------------------------------------

describe("agentic.context.build live handler", () => {
  it("returns not-configured status when no router is provided", async () => {
    const handlers = createFrameworkToolHandlers();
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

  it("returns live context packet when router is configured", async () => {
    const handlers = createFrameworkToolHandlers(router);
    const handler = handlers.get("agentic.context.build")!;

    const result = await handler({ task: "runtime auth" }, makeContext("agentic.context.build"));

    expect(result.ok).toBe(true);

    if (result.ok) {
      const output = result.value.output as Record<string, unknown>;

      expect(output.status).toBe("ok");
      expect(typeof output.contextId).toBe("string");
      expect(typeof output.tokenEstimate).toBe("number");
      expect((output.tokenEstimate as number)).toBeGreaterThan(0);
      expect(typeof output.sourceCount).toBe("number");
      expect(Array.isArray(output.citations)).toBe(true);
      expect(typeof output.preview).toBe("string");
      // Preview is bounded to 500 chars
      expect((output.preview as string).length).toBeLessThanOrEqual(500);
      // Sanitization: no raw vectors, embeddings, or secrets
      expect(JSON.stringify(output)).not.toMatch(/"vector"\s*:|"embedding"\s*:/);
    }
  });

  it("returns recoverable error for empty task", async () => {
    const handlers = createFrameworkToolHandlers(router);
    const handler = handlers.get("agentic.context.build")!;

    const result = await handler({ task: "  " }, makeContext("agentic.context.build"));

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("retrieval.unsupported-input");
      expect(result.error.severity).toBe("recoverable");
    }
  });

  it("citations include 1-based index and source id", async () => {
    const handlers = createFrameworkToolHandlers(router);
    const handler = handlers.get("agentic.context.build")!;

    const result = await handler({ task: "remote runtime" }, makeContext("agentic.context.build"));

    expect(result.ok).toBe(true);

    if (result.ok) {
      const output = result.value.output as Record<string, unknown>;
      const citations = output.citations as string[];

      for (const citation of citations) {
        // Must start with a [N] prefix
        expect(citation).toMatch(/^\[\d+\]/);
      }
    }
  });

  it("token estimate reflects assembled context size", async () => {
    const handlers = createFrameworkToolHandlers(router);
    const handler = handlers.get("agentic.context.build")!;

    const result = await handler({ task: "context building" }, makeContext("agentic.context.build"));

    expect(result.ok).toBe(true);

    if (result.ok) {
      const tokenUsage = result.value.tokenUsage;

      expect(tokenUsage?.inputTokens).toBeGreaterThan(0);
      expect(tokenUsage?.outputTokens).toBeGreaterThan(0);
      expect(tokenUsage?.totalTokens).toBeGreaterThanOrEqual(2);
    }
  });
});
