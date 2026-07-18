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
