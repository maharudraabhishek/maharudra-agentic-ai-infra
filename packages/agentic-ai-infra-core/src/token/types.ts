import type { AgentRole } from "../agents/types.js";

/** Token budget policy used by retrieval, context, and agent workflows. */
export type TokenBudgetPolicy = {
  readonly maxTotalTokens: number;
  readonly maxContextTokens: number;
  readonly maxResponseTokens?: number;
  readonly reserveTokens?: number;
  readonly roleBudgets?: Partial<Record<AgentRole, number>>;
};

/** Token usage summary for a model or workflow step. */
export type TokenUsageReport = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly estimatedCostUsd?: number;
};

/** Token usage attributed to one agent. */
export type AgentTokenUsageBreakdown = {
  readonly agentId: string;
  readonly role: AgentRole;
  readonly usage: TokenUsageReport;
};

/** Token usage attributed to one tool execution. */
export type ToolTokenUsageBreakdown = {
  readonly toolName: string;
  readonly usage: TokenUsageReport;
};

/** Token efficiency report for a workflow or context build. */
export type TokenEfficiencyReport = {
  readonly budget: TokenBudgetPolicy;
  readonly totalUsage: TokenUsageReport;
  readonly agentBreakdown?: readonly AgentTokenUsageBreakdown[];
  readonly toolBreakdown?: readonly ToolTokenUsageBreakdown[];
  readonly naiveMultiAgentEstimate?: number;
  readonly sharedContextTokenEstimate?: number;
  readonly estimatedTokenSavings?: number;
  readonly withinBudget: boolean;
  readonly notes?: readonly string[];
};

/** Interface for token-count providers. */
export interface TokenCounterProvider {
  /** Counts tokens for an input string. */
  countTokens(input: string): Promise<number> | number;
}

/** Project token efficiency configuration. */
export type TokenEfficiencyConfig = {
  readonly enabled: boolean;
  readonly tokenBudget?: TokenBudgetPolicy;
  readonly tokenCounterProviderId?: string;
};
