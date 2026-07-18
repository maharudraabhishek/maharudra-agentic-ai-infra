import type {
  AgentRole,
  FeedbackVerdict,
  RefusalReason,
  SafeTaskMetadata,
  SafetyVerdict,
  TokenUsageReport
} from "@maharudra/agentic-ai-infra-core";
import type {
  RuntimeMultiAgentRunReport,
  SingleAgentRunReport
} from "../agents/index.js";
import type { ResponsePolicyDecision } from "../guardrails/output-guard.js";

/**
 * Captures one executor invocation that contributes to an orchestrator result.
 *
 * Consumers branch on `executorReport.kind` before accessing the contained
 * executor-specific report, which prevents them from assuming a single-agent
 * `result` shape has multi-agent `synthesis` data (or the reverse). The
 * orchestrator records attempts itself because the retry primitive returns a
 * framework result, not a second report shape.
 *
 * @example
 * ```ts
 * if (subRun.executorReport.kind === "single") {
 *   return subRun.executorReport.report.result.summary;
 * }
 * ```
 */
export type OrchestratorSubRun = {
  /** Stable identifier of the registered agent that was invoked. */
  readonly agentId: string;
  /** Role used for the executor invocation and observability attribution. */
  readonly role: AgentRole;
  /** Number of invocation attempts; one means the operation did not retry. */
  readonly attemptCount: number;
  /** Discriminated executor report for safe dashboard and evaluation branching. */
  readonly executorReport:
    | { readonly kind: "single"; readonly report: SingleAgentRunReport }
    | { readonly kind: "multi"; readonly report: RuntimeMultiAgentRunReport };
};

/**
 * Describes an orchestrator-level denial without exposing implementation data.
 *
 * `agentId` and `toolId` identify the bounded target when available; a missing
 * identifier means the refusal applied to orchestration as a whole. The closed
 * `refusalReason` taxonomy lets callers aggregate safe, actionable outcomes
 * rather than inferring intent from the human-readable message.
 *
 * @example
 * ```ts
 * const refusal: OrchestratorRefusal = {
 *   agentId: "security-review",
 *   refusalReason: "agent-allowlist",
 *   message: "The selected tool is not permitted for this agent."
 * };
 * ```
 */
export type OrchestratorRefusal = {
  readonly agentId?: string;
  readonly toolId?: string;
  readonly refusalReason: RefusalReason;
  readonly message: string;
};

/**
 * Provides the canonical, aggregate outcome of a composed orchestrator run.
 *
 * This is deliberately a sibling of `RuntimeMultiAgentRunReport`: an
 * orchestrator may build context for more than one sub-run and may eventually
 * use routing services, so its broader composition cannot honestly preserve
 * the executor report's `contextBuildCount: 1` and `noNetworkCalls: true`
 * invariants. Content and feedback verdicts are always supplied, including
 * pass-through no-op results; optional output policy and refusal details are
 * omitted when their corresponding seams were not used.
 *
 * @umbrella Guardrails
 */
export type OrchestratorReport = {
  /** Distinguishes this aggregate report from executor sub-run report kinds. */
  readonly kind: "orchestrator";
  readonly runId: string;
  readonly traceId: string;
  /** Safe task metadata only; raw task text is intentionally excluded. */
  readonly task: SafeTaskMetadata;
  /** Roles selected by the supervisor, retained in planned route order. */
  readonly plannedAgents: readonly AgentRole[];
  /** Reports from each executor invocation, including retry attempt counts. */
  readonly subRuns: readonly OrchestratorSubRun[];
  /** Bounded aggregate text returned to the caller after composition. */
  readonly synthesis: string;
  /** Aggregate usage across every included sub-run. */
  readonly tokenUsage: TokenUsageReport;
  /** Per-orchestrator output-policy decision, when a response policy was configured. */
  readonly response?: ResponsePolicyDecision;
  /** Content-safety decision; a no-op guard returns a pass-through verdict. */
  readonly contentVerdict: SafetyVerdict;
  /** Post-run feedback decision; a no-op hook returns an accept verdict. */
  readonly feedback: FeedbackVerdict;
  /** Orchestrator-level denials, omitted when no denial occurred. */
  readonly refusals?: readonly OrchestratorRefusal[];
  /** Non-fatal composition and observability warnings, when present. */
  readonly warnings?: readonly string[];
};
