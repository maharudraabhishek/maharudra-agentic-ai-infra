import {
  fail,
  ok,
  type AgentRole,
  type FrameworkResult,
  type SafeTaskMetadata,
  type TokenBudgetPolicy,
  type TokenCounterProvider,
  type TokenEfficiencyReport,
  type TokenUsageReport,
  type ToolTokenUsageBreakdown
} from "@maharudra/agentic-ai-infra-core";

/**
 * Deterministic token counter used until callers provide a model-specific
 * counter behind the same interface.
 */
export class HeuristicTokenCounterProvider implements TokenCounterProvider {
  /**
   * Counts tokens with a stable character heuristic.
   */
  countTokens(input: string): number {
    return Math.max(1, Math.ceil(input.length / 4));
  }
}

/**
 * Safe token usage record persisted by runtime tests and dashboard providers.
 */
export type SafeTokenUsageRecord = {
  readonly traceId: string;
  readonly runId: string;
  readonly scope: "tool" | "agent" | "shared-context" | "synthesis";
  readonly task?: SafeTaskMetadata;
  readonly toolName?: string;
  readonly agentRole?: AgentRole;
  readonly usage: TokenUsageReport;
};

/**
 * Manages token estimates and hard budget checks.
 */
export class TokenBudgetManager {
  /**
   * Stores the budget and deterministic counter used for local enforcement.
   */
  constructor(
    readonly budget: TokenBudgetPolicy,
    private readonly counter: TokenCounterProvider = new HeuristicTokenCounterProvider()
  ) {}

  /**
   * Estimates token usage for one input and optional output.
   */
  estimate(input: string, output = ""): TokenUsageReport {
    const inputCount = this.counter.countTokens(input);
    const outputCount = output ? this.counter.countTokens(output) : 0;
    const inputTokens = typeof inputCount === "number" ? inputCount : 0;
    const outputTokens = typeof outputCount === "number" ? outputCount : 0;

    return {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens
    };
  }

  /**
   * Checks a usage report against the configured hard total budget.
   */
  ensureWithinBudget(usage: TokenUsageReport): FrameworkResult<TokenUsageReport> {
    if (usage.totalTokens > this.budget.maxTotalTokens) {
      return fail({
        code: "token.budget-exceeded",
        message: "Token usage exceeded the configured hard budget.",
        severity: "recoverable"
      });
    }

    return ok(usage);
  }

  /**
   * Returns the role-specific budget or the default context budget.
   */
  roleBudget(role: AgentRole): number {
    return this.budget.roleBudgets?.[role] ?? this.budget.maxContextTokens;
  }
}

/**
 * In-memory recorder that stores safe token summaries only.
 */
export class TokenUsageRecorder {
  private readonly records: SafeTokenUsageRecord[] = [];

  /**
   * Records usage without task text, approval text, chunks, vectors, or output.
   */
  recordUsage(record: SafeTokenUsageRecord): void {
    this.records.push(record);
  }

  /**
   * Returns all safe token usage records.
   */
  list(): readonly SafeTokenUsageRecord[] {
    return [...this.records];
  }

  /**
   * Builds a token efficiency report from the stored records.
   */
  report(params: {
    readonly budget: TokenBudgetPolicy;
    readonly naiveMultiAgentEstimate?: number;
    readonly sharedContextTokenEstimate?: number;
    readonly notes?: readonly string[];
  }): TokenEfficiencyReport {
    const total = this.records.reduce<TokenUsageReport>(
      (usage, record) => ({
        inputTokens: usage.inputTokens + record.usage.inputTokens,
        outputTokens: usage.outputTokens + record.usage.outputTokens,
        totalTokens: usage.totalTokens + record.usage.totalTokens
      }),
      { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    );
    const toolBreakdown = this.toolBreakdown();
    const estimatedTokenSavings =
      params.naiveMultiAgentEstimate === undefined
        ? undefined
        : Math.max(0, params.naiveMultiAgentEstimate - total.totalTokens);

    return {
      budget: params.budget,
      totalUsage: total,
      toolBreakdown,
      naiveMultiAgentEstimate: params.naiveMultiAgentEstimate,
      sharedContextTokenEstimate: params.sharedContextTokenEstimate,
      estimatedTokenSavings,
      withinBudget: total.totalTokens <= params.budget.maxTotalTokens,
      notes: params.notes
    };
  }

  /**
   * Aggregates token usage by tool name.
   */
  private toolBreakdown(): readonly ToolTokenUsageBreakdown[] {
    const usageByTool = new Map<string, TokenUsageReport>();

    for (const record of this.records) {
      if (!record.toolName) {
        continue;
      }

      const current = usageByTool.get(record.toolName) ?? {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0
      };

      usageByTool.set(record.toolName, {
        inputTokens: current.inputTokens + record.usage.inputTokens,
        outputTokens: current.outputTokens + record.usage.outputTokens,
        totalTokens: current.totalTokens + record.usage.totalTokens
      });
    }

    return [...usageByTool.entries()].map(([toolName, usage]) => ({
      toolName,
      usage
    }));
  }
}
