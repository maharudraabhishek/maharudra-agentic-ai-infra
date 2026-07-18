import { describe, expect, it } from "vitest";
import {
  fail,
  ok,
  type EvalSuiteContract,
  type FrameworkResult,
  type QualityReport
} from "@maharudra/agentic-ai-infra-core";
import { EvalHarness, aggregateReports } from "../../src/harness/eval-harness.js";

class FakeSuite implements EvalSuiteContract {
  constructor(
    readonly name: string,
    private readonly outcome:
      | { kind: "ok"; report: QualityReport }
      | { kind: "fail"; message: string }
  ) {}

  async run(): Promise<FrameworkResult<QualityReport>> {
    if (this.outcome.kind === "ok") {
      return ok(this.outcome.report);
    }
    return fail({
      code: "framework.internal-error",
      message: this.outcome.message,
      severity: "recoverable"
    });
  }
}

function passedReport(name: string): QualityReport {
  return {
    suiteName: name,
    status: "passed",
    total: 1,
    passed: 1,
    failed: 0,
    skipped: 0,
    results: [{ id: `${name}.x`, name: `${name} x`, status: "passed" }]
  };
}

function failedReport(name: string): QualityReport {
  return {
    suiteName: name,
    status: "failed",
    total: 1,
    passed: 0,
    failed: 1,
    skipped: 0,
    results: [{ id: `${name}.x`, name: `${name} x`, status: "failed" }]
  };
}

describe("EvalHarness", () => {
  it("runAll on empty harness returns ok with empty array", async () => {
    const h = new EvalHarness();
    const r = await h.runAll();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([]);
  });

  it("runSuite for unknown name returns evals.suite-not-registered", async () => {
    const h = new EvalHarness();
    const r = await h.runSuite("missing");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("evals.suite-not-registered");
  });

  it("listSuiteNames returns registered names", () => {
    const h = new EvalHarness();
    h.registerSuite(new FakeSuite("a", { kind: "ok", report: passedReport("a") }));
    h.registerSuite(new FakeSuite("b", { kind: "ok", report: passedReport("b") }));
    expect(h.listSuiteNames()).toEqual(["a", "b"]);
  });

  it("runSuite returns the suite's report", async () => {
    const h = new EvalHarness();
    h.registerSuite(new FakeSuite("a", { kind: "ok", report: passedReport("a") }));
    const r = await h.runSuite("a");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.suiteName).toBe("a");
  });

  it("runAll returns reports in registration order", async () => {
    const h = new EvalHarness();
    h.registerSuite(new FakeSuite("a", { kind: "ok", report: passedReport("a") }));
    h.registerSuite(new FakeSuite("b", { kind: "ok", report: passedReport("b") }));
    const r = await h.runAll();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.map((x) => x.suiteName)).toEqual(["a", "b"]);
    }
  });

  it("registering same name twice replaces the previous suite", async () => {
    const h = new EvalHarness();
    h.registerSuite(new FakeSuite("a", { kind: "ok", report: passedReport("a") }));
    h.registerSuite(new FakeSuite("a", { kind: "ok", report: failedReport("a") }));
    const r = await h.runSuite("a");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe("failed");
  });

  it("suite returning fail becomes a failed QualityReport in runAll", async () => {
    const h = new EvalHarness();
    h.registerSuite(new FakeSuite("a", { kind: "fail", message: "boom" }));
    const r = await h.runAll();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toHaveLength(1);
      expect(r.value[0].status).toBe("failed");
      expect(r.value[0].suiteName).toBe("a");
    }
  });
});

describe("aggregateReports", () => {
  it("status is failed when any report is failed", () => {
    const agg = aggregateReports([passedReport("a"), failedReport("b")]);
    expect(agg.status).toBe("failed");
  });

  it("status is passed when no failures and at least one passed", () => {
    const skippedR: QualityReport = {
      suiteName: "s",
      status: "skipped",
      total: 1,
      passed: 0,
      failed: 0,
      skipped: 1,
      results: []
    };
    const agg = aggregateReports([passedReport("a"), skippedR]);
    expect(agg.status).toBe("passed");
  });

  it("status is skipped when all reports are skipped", () => {
    const s: QualityReport = {
      suiteName: "s",
      status: "skipped",
      total: 1,
      passed: 0,
      failed: 0,
      skipped: 1,
      results: []
    };
    const agg = aggregateReports([s, s]);
    expect(agg.status).toBe("skipped");
  });

  it("status is skipped on empty input", () => {
    const agg = aggregateReports([]);
    expect(agg.status).toBe("skipped");
    expect(agg.total).toBe(0);
  });

  it("totals are summed across reports", () => {
    const a: QualityReport = {
      suiteName: "a",
      status: "passed",
      total: 3,
      passed: 2,
      failed: 0,
      skipped: 1,
      results: []
    };
    const b: QualityReport = {
      suiteName: "b",
      status: "failed",
      total: 4,
      passed: 1,
      failed: 2,
      skipped: 1,
      results: []
    };
    const agg = aggregateReports([a, b]);
    expect(agg.total).toBe(7);
    expect(agg.passed).toBe(3);
    expect(agg.failed).toBe(2);
    expect(agg.skipped).toBe(2);
    expect(agg.suites).toHaveLength(2);
  });
});
