import { describe, expect, it } from "vitest";
import type { EvalRunRecord, QualityReport } from "@maharudra/agentic-ai-infra-core";
import { InMemoryEvalStore, DEFAULT_EVAL_STORE_CAPACITY } from "../../src/evals/eval-store.js";

function makeRecord(id: string): EvalRunRecord {
  const report: QualityReport = {
    suiteName: "test",
    status: "passed",
    total: 1,
    passed: 1,
    failed: 0,
    skipped: 0,
    results: []
  };
  return {
    runId: `run-${id}`,
    traceId: `trace-${id}`,
    recordedAt: new Date().toISOString(),
    report
  };
}

describe("InMemoryEvalStore", () => {
  it("returns undefined from getLatest when empty", () => {
    const store = new InMemoryEvalStore();
    expect(store.getLatest()).toBeUndefined();
    expect(store.size()).toBe(0);
  });

  it("returns the pushed record after a single push", () => {
    const store = new InMemoryEvalStore();
    const r = makeRecord("a");
    store.push(r);
    expect(store.getLatest()).toEqual(r);
    expect(store.size()).toBe(1);
  });

  it("returns records in chronological order from getHistory", () => {
    const store = new InMemoryEvalStore();
    const r1 = makeRecord("1");
    const r2 = makeRecord("2");
    const r3 = makeRecord("3");
    store.push(r1);
    store.push(r2);
    store.push(r3);

    const history = store.getHistory();
    expect(history).toHaveLength(3);
    expect(history[0]).toEqual(r1);
    expect(history[2]).toEqual(r3);
  });

  it("respects the limit parameter and returns the most recent", () => {
    const store = new InMemoryEvalStore();
    store.push(makeRecord("1"));
    store.push(makeRecord("2"));
    store.push(makeRecord("3"));

    const lastOne = store.getHistory(1);
    expect(lastOne).toHaveLength(1);
    expect(lastOne[0].runId).toBe("run-3");
  });

  it("getHistory(0) returns empty array", () => {
    const store = new InMemoryEvalStore();
    store.push(makeRecord("1"));
    expect(store.getHistory(0)).toEqual([]);
  });

  it("getHistory with limit larger than size returns all", () => {
    const store = new InMemoryEvalStore();
    store.push(makeRecord("1"));
    expect(store.getHistory(100)).toHaveLength(1);
  });

  it("drops oldest records when capacity is exceeded", () => {
    const store = new InMemoryEvalStore({ capacity: 3 });
    for (let i = 1; i <= 5; i += 1) {
      store.push(makeRecord(String(i)));
    }
    expect(store.size()).toBe(3);
    const history = store.getHistory();
    expect(history[0].runId).toBe("run-3");
    expect(history[2].runId).toBe("run-5");
  });

  it("clear() empties the store", () => {
    const store = new InMemoryEvalStore();
    store.push(makeRecord("1"));
    store.push(makeRecord("2"));
    store.clear();
    expect(store.size()).toBe(0);
    expect(store.getLatest()).toBeUndefined();
  });

  it("default capacity is DEFAULT_EVAL_STORE_CAPACITY", () => {
    expect(DEFAULT_EVAL_STORE_CAPACITY).toBe(100);
    const store = new InMemoryEvalStore();
    // Fill past default capacity
    for (let i = 0; i < 120; i += 1) {
      store.push(makeRecord(String(i)));
    }
    expect(store.size()).toBe(100);
  });

  it("invalid capacity values fall back to default", () => {
    const cases: ReadonlyArray<number | undefined> = [0, -1, 1.5, NaN];
    for (const cap of cases) {
      const store = new InMemoryEvalStore({ capacity: cap as number });
      // Push 105 and confirm we kept exactly 100
      for (let i = 0; i < 105; i += 1) {
        store.push(makeRecord(String(i)));
      }
      expect(store.size()).toBe(100);
    }
  });

  it("getHistory returns a shallow copy that does not mutate the store", () => {
    const store = new InMemoryEvalStore();
    store.push(makeRecord("1"));
    const history = store.getHistory() as EvalRunRecord[];
    history.length = 0; // mutate copy
    expect(store.size()).toBe(1);
  });
});
