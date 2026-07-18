/**
 * Stage 21 — agentic.evals.run tool handler tests.
 *
 * Verifies the handler exists, returns the correct QualityReport shape,
 * produces all-skipped output for empty input, and routes the "agent-runtime"
 * suite name correctly.
 */
import { describe, expect, it } from "vitest";
import type { ToolContract, ToolExecutionContext } from "@maharudra/agentic-ai-infra-core";
import { createFrameworkToolHandlers } from "../src/index.js";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeContext(toolId: string): ToolExecutionContext {
  const contract: ToolContract = {
    id: toolId,
    name: toolId,
    description: "Test tool",
    category: "eval",
    riskLevel: "low",
    outputPolicy: { remoteSafe: true, maxBytes: 16384 },
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

describe("agentic.evals.run handler (Stage 21)", () => {

  it("handler exists in the tool map", () => {
    const handlers = createFrameworkToolHandlers();
    const handler = handlers.get("agentic.evals.run");
    expect(handler).toBeDefined();
  });

  it("returns QualityReport shape with correct total for retrieval-quality suite", async () => {
    const handlers = createFrameworkToolHandlers();
    const handler = handlers.get("agentic.evals.run")!;

    const result = await handler({ suite: "retrieval-quality" }, makeContext("agentic.evals.run"));

    expect(result.ok).toBe(true);
    if (result.ok) {
      const output = result.value.output as Record<string, unknown>;
      expect(typeof output.status).toBe("string");
      expect(output.total).toBe(6);
      expect(Array.isArray(output.suites)).toBe(true);
      const suites = output.suites as Array<{ suiteName: string; results: unknown[] }>;
      expect(suites.length).toBe(1);
      expect(suites[0].suiteName).toBe("retrieval-quality");
      expect(suites[0].results.length).toBe(6);
    }
  });

  it("retrieval-quality suite with empty input: all 6 checks are skipped", async () => {
    const handlers = createFrameworkToolHandlers();
    const handler = handlers.get("agentic.evals.run")!;

    const result = await handler({}, makeContext("agentic.evals.run"));

    expect(result.ok).toBe(true);
    if (result.ok) {
      const output = result.value.output as Record<string, unknown>;
      expect(output.status).toBe("skipped");
      expect(output.skipped).toBe(6);
      expect(output.passed).toBe(0);
      expect(output.failed).toBe(0);
      expect(Array.isArray(output.suites)).toBe(true);
    }
  });

  it("agent-runtime suite: returns AggregateQualityReport with suiteName 'agent-runtime-safety'", async () => {
    const handlers = createFrameworkToolHandlers();
    const handler = handlers.get("agentic.evals.run")!;

    const result = await handler({ suite: "agent-runtime" }, makeContext("agentic.evals.run"));

    expect(result.ok).toBe(true);
    if (result.ok) {
      const output = result.value.output as Record<string, unknown>;
      expect(Array.isArray(output.suites)).toBe(true);
      const suites = output.suites as Array<{ suiteName: string }>;
      expect(suites.length).toBe(1);
      expect(suites[0].suiteName).toBe("agent-runtime-safety");
    }
  });
});
