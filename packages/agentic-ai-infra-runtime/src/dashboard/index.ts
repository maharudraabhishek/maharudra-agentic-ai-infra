import type {
  EvalStore,
  QualityReport,
  ResolvedProjectConfig,
  TokenEfficiencyReport
} from "@maharudra/agentic-ai-infra-core";
import type { TokenUsageRecorder } from "../token/index.js";
import type { TrajectoryRecorder } from "../trajectory/index.js";

/**
 * Runtime dashboard provider options.
 */
export type RuntimeDashboardDataProviderOptions = {
  readonly config: ResolvedProjectConfig;
  readonly tokenRecorder?: TokenUsageRecorder;
  readonly trajectoryRecorder?: TrajectoryRecorder;
  /**
   * Pre-computed eval reports for callers that want static input.
   * Mutually exclusive with `evalStore` — when both are set, `evalStore` wins.
   */
  readonly evalReports?: readonly QualityReport[];
  /**
   * Live eval store. When set, `getSnapshot()` resolves reports lazily on each
   * call via `store.getHistory().map(r => r.report)`.
   */
  readonly evalStore?: EvalStore;
  readonly retrievalSourceCount?: number;
  readonly retrievalProviderCount?: number;
  readonly cacheEntries?: number;
  readonly securityWarnings?: readonly string[];
};

/**
 * Creates a dashboard-compatible provider from safe runtime summaries.
 *
 * The provider returns only task hashes/types, aggregate counts, token totals,
 * and sanitized warning text. Raw tasks, approval text, chunks, vectors, SQL,
 * stack traces, and command output are not part of the shape.
 */
export function createRuntimeDashboardDataProvider(
  options: RuntimeDashboardDataProviderOptions
) {
  return {
    getSnapshot() {
      const tokenReport = options.tokenRecorder?.report({
        budget: options.config.tokenEfficiency.tokenBudget ?? {
          maxTotalTokens: 1,
          maxContextTokens: 1
        }
      }) satisfies TokenEfficiencyReport | undefined;
      const trajectory = options.trajectoryRecorder?.summary();
      const evalReports =
        options.evalStore
          ? options.evalStore.getHistory().map((record) => record.report)
          : (options.evalReports ?? []);
      const evalTotals = summarizeEvals(evalReports);

      return {
        generatedAt: new Date().toISOString(),
        project: {
          name: options.config.project.name,
          slug: options.config.project.slug
        },
        tokens: tokenReport,
        trajectory,
        retrieval: {
          providerCount: options.retrievalProviderCount ?? options.config.retrieval.providers.length,
          sourceCount: options.retrievalSourceCount ?? 0,
          warningCount: 0
        },
        evals: evalTotals,
        cache: {
          hits: 0,
          misses: 0,
          entries: options.cacheEntries ?? 0
        },
        securityWarnings: options.securityWarnings ?? []
      };
    }
  };
}

/**
 * Aggregates quality reports for dashboard display.
 */
function summarizeEvals(reports: readonly QualityReport[]) {
  return reports.reduce(
    (summary, report) => ({
      total: summary.total + report.total,
      passed: summary.passed + report.passed,
      failed: summary.failed + report.failed,
      skipped: summary.skipped + report.skipped
    }),
    { total: 0, passed: 0, failed: 0, skipped: 0 }
  );
}
