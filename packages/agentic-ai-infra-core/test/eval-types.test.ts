import { describe, expect, it } from "vitest";
import type {
  AggregateQualityReport,
  EvalRunRecord,
  EvalStore,
  EvalDataset,
  EvalDatasetItem,
  EvalAnswerMatchMode,
  QualityReport
} from "../src/index.js";

describe("Stage 24 eval types", () => {
  it("AggregateQualityReport has the expected shape", () => {
    const report: AggregateQualityReport = {
      status: "passed",
      suites: [],
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0
    };
    expect(report.suites).toEqual([]);
  });

  it("EvalRunRecord includes correlation IDs", () => {
    const inner: QualityReport = {
      suiteName: "test",
      status: "passed",
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      results: []
    };
    const record: EvalRunRecord = {
      runId: "run-1",
      traceId: "trace-1",
      recordedAt: new Date().toISOString(),
      report: inner
    };
    expect(record.runId).toBe("run-1");
    expect(record.traceId).toBe("trace-1");
  });

  it("EvalDataset v1 with minimum fields", () => {
    const dataset: EvalDataset = { version: 1, name: "test", items: [] };
    expect(dataset.version).toBe(1);
  });

  it("EvalDatasetItem required fields", () => {
    const item: EvalDatasetItem = {
      id: "item-1",
      question: "What?",
      expectedChunks: [],
      expectedAnswer: "ok",
      expectedToolCalls: []
    };
    expect(item.id).toBe("item-1");
  });

  it("EvalAnswerMatchMode union values", () => {
    const modes: readonly EvalAnswerMatchMode[] = ["substring", "exact", "semantic"];
    expect(modes).toContain("substring");
  });

  it("EvalStore interface can be implemented", () => {
    class TestStore implements EvalStore {
      private readonly records: EvalRunRecord[] = [];
      push(r: EvalRunRecord): void { this.records.push(r); }
      getLatest(): EvalRunRecord | undefined { return this.records[this.records.length - 1]; }
      getHistory(limit?: number): readonly EvalRunRecord[] {
        return limit === undefined ? [...this.records] : this.records.slice(-limit);
      }
      size(): number { return this.records.length; }
      clear(): void { this.records.length = 0; }
    }
    expect(new TestStore().size()).toBe(0);
  });
});
