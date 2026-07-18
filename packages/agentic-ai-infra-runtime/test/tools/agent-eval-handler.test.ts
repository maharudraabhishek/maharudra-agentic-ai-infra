/**
 * Stage 24 — agentic.evals.agent-eval tool handler tests.
 *
 * Verifies the handler exists, returns the AggregateQualityReport shape, and
 * routes correctly through an EvalHarness when wired.
 */
import { describe, expect, it } from "vitest";
import type { ToolContract, ToolExecutionContext, EvalRunRecord, QualityReport } from "@maharudra/agentic-ai-infra-core";
import { createFrameworkToolHandlers } from "../../src/index.js";
import { EvalHarness } from "../../src/harness/eval-harness.js";
import { InMemoryEvalStore } from "../../src/evals/eval-store.js";
import { AgentEvaluator } from "../../src/evals/agent-evaluator.js";

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
    approvalMatched: true
  } as ToolExecutionContext;
}

function pushOneRecord(store: InMemoryEvalStore): void {
  const report: QualityReport = {
    suiteName: "agent-runtime-safety",
    status: "passed",
    total: 1,
    passed: 1,
    failed: 0,
    skipped: 0,
    results: [{ id: "x", name: "x", status: "passed" }]
  };
  const record: EvalRunRecord = {
    runId: "run-1",
    traceId: "trace-1",
    recordedAt: new Date().toISOString(),
    report
  };
  store.push(record);
}

describe("agentic.evals.agent-eval handler", () => {
  it("exists in the tool map", () => {
    const handlers = createFrameworkToolHandlers();
    expect(handlers.get("agentic.evals.agent-eval")).toBeDefined();
  });

  it("returns skipped aggregate when no EvalHarness is wired", async () => {
    const handlers = createFrameworkToolHandlers();
    const handler = handlers.get("agentic.evals.agent-eval")!;
    const result = await handler({}, makeContext("agentic.evals.agent-eval"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const output = result.value.output as Record<string, unknown>;
      expect(output.status).toBe("skipped");
      expect(Array.isArray(output.suites)).toBe(true);
      expect((output.suites as unknown[]).length).toBe(0);
    }
  });

  it("returns skipped aggregate when harness has no agent-evaluator suite", async () => {
    const harness = new EvalHarness();
    const handlers = createFrameworkToolHandlers(undefined, undefined, undefined, harness);
    const handler = handlers.get("agentic.evals.agent-eval")!;
    const result = await handler({}, makeContext("agentic.evals.agent-eval"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const output = result.value.output as Record<string, unknown>;
      expect(output.status).toBe("skipped");
    }
  });

  it("returns aggregated report when agent-evaluator suite is registered", async () => {
    const store = new InMemoryEvalStore();
    pushOneRecord(store);

    const harness = new EvalHarness();
    harness.registerSuite(new AgentEvaluator(store, () => ({})));

    const handlers = createFrameworkToolHandlers(undefined, undefined, undefined, harness);
    const handler = handlers.get("agentic.evals.agent-eval")!;
    const result = await handler({}, makeContext("agentic.evals.agent-eval"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const output = result.value.output as Record<string, unknown>;
      expect(output.status).toBe("passed");
      expect(Array.isArray(output.suites)).toBe(true);
      const suites = output.suites as Array<{ suiteName: string }>;
      expect(suites.length).toBe(1);
      expect(suites[0].suiteName).toBe("agent-evaluator");
    }
  });

  it("returns the AggregateQualityReport shape — top-level totals + suites array", async () => {
    const handlers = createFrameworkToolHandlers();
    const handler = handlers.get("agentic.evals.agent-eval")!;
    const result = await handler({}, makeContext("agentic.evals.agent-eval"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const output = result.value.output as Record<string, unknown>;
      expect(typeof output.total).toBe("number");
      expect(typeof output.passed).toBe("number");
      expect(typeof output.failed).toBe("number");
      expect(typeof output.skipped).toBe("number");
      expect(Array.isArray(output.suites)).toBe(true);
    }
  });
});
