# Stage 24 — Phase 3: EvalHarness
## Claude Code Prompt — MahaRudra Agentic AI Infra

---

## BEFORE YOU START

**Platform:** Windows 11, PowerShell, Node >= 20, **pnpm only**
**CI command:** `pnpm run ci`
**Read first:** `AGENTS.md`, `STATUS.md`, `kb.md`
**Prerequisite:** Phase 2 complete (InMemoryEvalStore), CI green at ~370 tests
**Expected after this phase:** ~380 tests passing

---

## SCOPE — Phase 3 only

Implement `EvalHarness` — the concrete class satisfying core's `EvalHarnessContract`. Also export the `aggregateReports()` helper used by MCP eval tools (Phase 8) to normalize multi-suite results.

`EvalHarness` is the runtime counterpart of `AgentHarness`. `AgentHarness` dispatches tool execution; `EvalHarness` dispatches eval execution. They share no implementation; the parallel is conceptual.

---

## FILES TO CHANGE

```
packages/agentic-ai-infra-runtime/src/harness/eval-harness.ts      NEW
packages/agentic-ai-infra-runtime/src/harness/index.ts             MODIFY (export)
packages/agentic-ai-infra-runtime/test/harness/eval-harness.test.ts  NEW
```

---

## CHANGE 1 — `runtime/src/harness/eval-harness.ts` (NEW)

```typescript
import {
  fail,
  ok,
  type AggregateQualityReport,
  type EvalHarnessContract,
  type EvalSuiteContract,
  type EvalStatus,
  type FrameworkResult,
  type QualityReport
} from "@maharudra/agentic-ai-infra-core";

/**
 * Concrete implementation of `EvalHarnessContract`.
 *
 * Registers eval suites by name (each `EvalSuiteContract.name`) and dispatches
 * `runSuite()` or `runAll()` calls to them. Aggregates results into the
 * normalized `AggregateQualityReport` shape used by MCP eval tools.
 *
 * `EvalHarness` is the runtime counterpart of `AgentHarness` — `AgentHarness`
 * dispatches tool execution, `EvalHarness` dispatches eval execution. They
 * share no implementation; the parallel is conceptual.
 *
 * @example
 * const harness = new EvalHarness()
 *   .registerSuite(new RetrievalQualitySuite(() => retrievalInput))
 *   .registerSuite(new AgentEvaluator(store, () => agentOptions));
 *
 * const allResult = await harness.runAll();
 * if (allResult.ok) {
 *   const aggregate = aggregateReports(allResult.value);
 * }
 */
export class EvalHarness implements EvalHarnessContract {
  private readonly suites = new Map<string, EvalSuiteContract>();

  /**
   * Registers a suite. Subsequent registration with the same `suite.name`
   * replaces the previous registration. Returns `this` for fluent chaining.
   */
  registerSuite(suite: EvalSuiteContract): EvalHarnessContract {
    this.suites.set(suite.name, suite);
    return this;
  }

  /**
   * Returns the names of all currently registered suites.
   *
   * Not part of the core contract — added for diagnostics and the dashboard.
   */
  listSuiteNames(): readonly string[] {
    return [...this.suites.keys()];
  }

  /**
   * Runs one named suite. Returns a recoverable error when the named suite is
   * not registered. Otherwise delegates to the suite's own `run()`.
   */
  async runSuite(name: string): Promise<FrameworkResult<QualityReport>> {
    const suite = this.suites.get(name);

    if (!suite) {
      return fail({
        code: "evals.suite-not-registered",
        message: `Eval suite "${name}" is not registered.`,
        severity: "recoverable"
      });
    }

    return suite.run();
  }

  /**
   * Runs all registered suites in registration order.
   *
   * Returns an array of `QualityReport` — one per suite. Individual suite
   * failures are NOT propagated to a top-level fail: each failure becomes a
   * `QualityReport` with `status: "failed"` in the result array, so callers
   * always get back a uniform list rather than a partial array with a
   * top-level error.
   *
   * Callers that need the normalized `AggregateQualityReport` shape (MCP
   * tools) should pass the result through `aggregateReports()`.
   */
  async runAll(): Promise<FrameworkResult<readonly QualityReport[]>> {
    const reports: QualityReport[] = [];

    for (const suite of this.suites.values()) {
      const result = await suite.run();

      if (result.ok) {
        reports.push(result.value);
      } else {
        reports.push({
          suiteName: suite.name,
          status: "failed",
          total: 1,
          passed: 0,
          failed: 1,
          skipped: 0,
          results: [
            {
              id: `${suite.name}.run-error`,
              name: `${suite.name} run error`,
              status: "failed",
              message: result.error.message
            }
          ]
        });
      }
    }

    return ok(reports);
  }
}

/**
 * Aggregates an array of `QualityReport` into one `AggregateQualityReport`.
 *
 * `status` is the worst-of across child reports:
 *   - any "failed" → "failed"
 *   - else any "passed" → "passed"
 *   - else "skipped"
 *
 * Numeric fields are summed across all reports. Used by MCP eval tool handlers
 * to normalize their output.
 */
export function aggregateReports(
  reports: readonly QualityReport[]
): AggregateQualityReport {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let total = 0;

  for (const r of reports) {
    total += r.total;
    passed += r.passed;
    failed += r.failed;
    skipped += r.skipped;
  }

  const status: EvalStatus =
    reports.some((r) => r.status === "failed")
      ? "failed"
      : reports.some((r) => r.status === "passed")
        ? "passed"
        : "skipped";

  return { status, suites: reports, total, passed, failed, skipped };
}
```

---

## CHANGE 2 — `runtime/src/harness/index.ts`

The existing file contains `AgentHarness`, `SafeOutputSanitizer`, `DefaultPermissionGate`, `DefaultApprovalPolicy`, and supporting types. Do not refactor. Add ONE line at the bottom:

```typescript
export * from "./eval-harness.js";
```

---

## CHANGE 3 — `runtime/test/harness/eval-harness.test.ts` (NEW)

Create the directory `runtime/test/harness/` if it does not exist.

```typescript
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
```

---

## SELF-REVIEW CHECKLIST

- [ ] `runtime/src/harness/eval-harness.ts` exports `EvalHarness` and `aggregateReports`
- [ ] `EvalHarness implements EvalHarnessContract` from core — no type errors
- [ ] `runSuite()` returns `evals.suite-not-registered` for unknown names
- [ ] `runAll()` does not propagate per-suite failures — they become failed `QualityReport` entries
- [ ] `aggregateReports` status follows worst-of rule
- [ ] `runtime/src/harness/index.ts` adds `export * from "./eval-harness.js";` at the end
- [ ] No modification to `AgentHarness` or other existing exports in `harness/index.ts`
- [ ] ≥10 new tests pass
- [ ] Previous ~370 tests still pass
- [ ] `pnpm run ci` passes
- [ ] JSDoc on `EvalHarness`, all public methods, and `aggregateReports`

---

## WHAT NOT TO DO

- Do NOT modify `AgentHarness` — keep it as the tool execution security layer
- Do NOT thread `EvalStore` into `EvalHarness` constructor — the store is the suites' concern, not the harness's
- Do NOT make `EvalHarness.runAll()` parallel — sequential preserves registration order
- Do NOT add a `clear()` method — registration is monotonic in Stage 24
- Do NOT throw — every error path returns `FrameworkResult.fail`

---

## DONE SIGNAL

```
Stage 24 Phase 3 complete.
Test count: [N]/[N] passing (target ~380).
CI: build ✓ typecheck ✓ test ✓ lint ✓
Files changed: 3
Next: Phase 4 — Built-in suites (Retrieval + Agent + Dataset)
```
