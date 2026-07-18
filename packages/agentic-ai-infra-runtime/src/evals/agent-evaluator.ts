import type {
  AgentRole,
  EvalResult,
  EvalStore,
  EvalSuiteContract,
  EvalStatus,
  FrameworkResult,
  QualityReport,
  SafeTrajectoryEvent
} from "@maharudra/agentic-ai-infra-core";
import { ok } from "@maharudra/agentic-ai-infra-core";
import { runAgentRuntimeEvals } from "./index.js";
import type { RuntimeMultiAgentRunReport } from "../agents/index.js";

/**
 * Options consumed by `AgentEvaluator` to drive `runAgentRuntimeEvals`.
 *
 * Stage 24 wires these from the suite-level options provider.
 * Stage 25 will derive them from `AgentDefinition.evalRules` per-agent.
 */
export type AgentEvalSuiteOptions = {
  /** Maximum runs to evaluate per invocation. Default: 10. */
  readonly limit?: number;
  /** Roles that must appear in a run's routed roles for it to pass. */
  readonly requiredRoles?: readonly AgentRole[];
  /** Tool ids that must NOT appear in the trajectory. */
  readonly forbiddenTools?: readonly string[];
  /** Hard token budget for the entire multi-agent run. */
  readonly hardBudget?: number;
  /**
   * Optional trajectory pull function. When provided, the evaluator passes the
   * resulting events into `runAgentRuntimeEvals`. When absent, trajectory-based
   * checks (forbidden tools, safe trajectory) return "skipped".
   */
  readonly trajectoryProvider?: () => readonly SafeTrajectoryEvent[];
  /**
   * Optional report provider. When provided, the evaluator re-runs role and
   * budget checks against this report. When absent, those checks return "skipped".
   *
   * Stage 24 note: `EvalStore` holds `QualityReport`s, not the raw
   * `RuntimeMultiAgentRunReport`. This provider lets callers re-evaluate the
   * most recent run with different rules without re-running the agent.
   */
  readonly reportProvider?: () => RuntimeMultiAgentRunReport | undefined;
};

/**
 * Lazy provider for agent-evaluator options.
 */
export type AgentEvalOptionsProvider = () => AgentEvalSuiteOptions;

/**
 * `EvalSuiteContract` that surfaces the stored eval history alongside re-run
 * checks against the configured rules.
 *
 * The aggregated suite report uses `suiteName = "agent-evaluator"`. It
 * combines:
 *   - the historic per-run reports from `EvalStore` (already evaluated at
 *     run time by the multi-agent executor)
 *   - a fresh `runAgentRuntimeEvals` against the report provider's output
 *     using the current options (so callers can sharpen rules without
 *     re-running the agent)
 *
 * Empty store → single "skipped" result.
 *
 * @example
 * const suite = new AgentEvaluator(store, () => ({
 *   limit: 5,
 *   requiredRoles: ["security-reviewer"],
 *   forbiddenTools: ["agentic.write.file"],
 *   hardBudget: 8000
 * }));
 * harness.registerSuite(suite);
 */
export class AgentEvaluator implements EvalSuiteContract {
  readonly name = "agent-evaluator";

  constructor(
    private readonly store: EvalStore,
    private readonly optionsProvider: AgentEvalOptionsProvider
  ) {}

  async run(): Promise<FrameworkResult<QualityReport>> {
    const options = this.optionsProvider();
    const limit = options.limit ?? 10;
    const history = this.store.getHistory(limit);

    if (history.length === 0) {
      return ok({
        suiteName: this.name,
        status: "skipped",
        total: 1,
        passed: 0,
        failed: 0,
        skipped: 1,
        results: [
          {
            id: "agent-evaluator.no-records",
            name: "agent evaluator no records",
            status: "skipped",
            message: "Eval store is empty — nothing to evaluate."
          }
        ]
      });
    }

    // 1) Surface historic per-run results.
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    const results: EvalResult[] = [];

    for (const record of history) {
      passed += record.report.passed;
      failed += record.report.failed;
      skipped += record.report.skipped;
      for (const r of record.report.results) {
        results.push({
          id: `${record.runId}.${r.id}`,
          name: `${record.runId}: ${r.name}`,
          status: r.status,
          message: r.message,
          metrics: r.metrics
        });
      }
    }

    // 2) Fresh re-eval against current rules using the report provider.
    const currentReport = options.reportProvider?.();
    const currentTrajectory = options.trajectoryProvider?.();

    if (currentReport || currentTrajectory) {
      const freshReport = runAgentRuntimeEvals({
        report: currentReport,
        trajectory: currentTrajectory,
        requiredRoles: options.requiredRoles,
        forbiddenTools: options.forbiddenTools,
        hardBudget: options.hardBudget
      });

      passed += freshReport.passed;
      failed += freshReport.failed;
      skipped += freshReport.skipped;
      for (const r of freshReport.results) {
        results.push({
          id: `current.${r.id}`,
          name: `current: ${r.name}`,
          status: r.status,
          message: r.message,
          metrics: r.metrics
        });
      }
    }

    const status: EvalStatus =
      failed > 0 ? "failed" : passed > 0 ? "passed" : "skipped";

    return ok({
      suiteName: this.name,
      status,
      total: results.length,
      passed,
      failed,
      skipped,
      results
    });
  }
}
