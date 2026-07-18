import { describe, expect, it } from "vitest";
import type { EvalRunRecord, QualityReport } from "@maharudra/agentic-ai-infra-core";
import { InMemoryEvalStore } from "../../src/evals/eval-store.js";
import { AgentEvaluator } from "../../src/evals/agent-evaluator.js";

function makeRecord(id: string): EvalRunRecord {
  const report: QualityReport = {
    suiteName: "agent-runtime-safety",
    status: "passed",
    total: 1,
    passed: 1,
    failed: 0,
    skipped: 0,
    results: [{ id: "x", name: "x", status: "passed" }]
  };
  return {
    runId: `run-${id}`,
    traceId: `trace-${id}`,
    recordedAt: new Date().toISOString(),
    report
  };
}

describe("AgentEvaluator", () => {
  it("returns skipped when store is empty", async () => {
    const store = new InMemoryEvalStore();
    const suite = new AgentEvaluator(store, () => ({}));
    const r = await suite.run();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe("skipped");
      expect(r.value.skipped).toBe(1);
    }
  });

  it("aggregates historic per-run reports", async () => {
    const store = new InMemoryEvalStore();
    store.push(makeRecord("1"));
    store.push(makeRecord("2"));
    const suite = new AgentEvaluator(store, () => ({}));
    const r = await suite.run();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.passed).toBe(2);
      expect(r.value.status).toBe("passed");
    }
  });

  it("respects the limit option", async () => {
    const store = new InMemoryEvalStore();
    for (let i = 0; i < 5; i += 1) store.push(makeRecord(String(i)));
    const suite = new AgentEvaluator(store, () => ({ limit: 2 }));
    const r = await suite.run();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.passed).toBe(2);
  });

  it("calls the options provider on each run", async () => {
    const store = new InMemoryEvalStore();
    store.push(makeRecord("1"));
    let calls = 0;
    const suite = new AgentEvaluator(store, () => {
      calls += 1;
      return {};
    });
    await suite.run();
    await suite.run();
    expect(calls).toBe(2);
  });

  it("includes fresh re-eval results when reportProvider is supplied", async () => {
    const store = new InMemoryEvalStore();
    store.push(makeRecord("1"));
    const suite = new AgentEvaluator(store, () => ({
      reportProvider: () => undefined,
      trajectoryProvider: () => []
    }));
    const r = await suite.run();
    expect(r.ok).toBe(true);
  });
});
