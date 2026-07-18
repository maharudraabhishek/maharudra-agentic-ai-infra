import { randomUUID } from "node:crypto";
import {
  fail,
  ok,
  type AgentDefinition,
  type AgentDefinitionRegistry,
  type ContentGuard,
  type ContextPackage,
  type DeterministicAgentOutput,
  type FeedbackHook,
  type FeedbackVerdict,
  type FrameworkError,
  type FrameworkResult,
  type SafetyVerdict,
  type SupervisorPolicy,
  type TokenUsageReport,
  type ToolContract
} from "@maharudra/agentic-ai-infra-core";
import {
  classifyTask,
  type SingleAgentExecutor,
  type SingleAgentRunReport,
  type TokenEfficientMultiAgentExecutor
} from "../agents/index.js";
import { NoopContentGuard } from "../guardrails/content-guard.js";
import { NoopCritiqueLoop } from "../feedback-loops/critique-loop.js";
import { runWithRetry } from "../feedback-loops/retry-loop.js";
import { evaluateResponsePolicy, type ResponsePolicyDecision } from "../guardrails/output-guard.js";
import {
  isCanonicalErrorCode,
  isContentAction,
  isFeedbackAction,
  isRefusalReason,
  isSafeTraceId
} from "../internal/safe-runtime-values.js";
import type {
  OrchestratorRefusal,
  OrchestratorReport,
  OrchestratorSubRun
} from "./types.js";

type AgentRunAttempt = {
  readonly result: FrameworkResult<SingleAgentRunReport>;
  readonly attemptCount: number;
};

type SuccessfulAgentRun = {
  readonly agent: AgentDefinition;
  readonly subRun: OrchestratorSubRun;
  readonly report: SingleAgentRunReport;
};

type CompositionSuccess = {
  readonly subRuns: readonly OrchestratorSubRun[];
  readonly synthesis: string;
  readonly tokenUsage: TokenUsageReport;
  readonly response?: ResponsePolicyDecision;
  readonly refusals?: readonly OrchestratorRefusal[];
  readonly warnings?: readonly string[];
};

/**
 * Construction dependencies for a composed agent orchestrator.
 *
 * The options keep routing, execution, safety inspection, and feedback
 * independently replaceable. `singleAgentExecutor` is deliberately an
 * execution port rather than the full concrete surface, so callers can supply
 * a real executor or a structurally compatible implementation without exposing
 * executor internals to orchestration. `multiAgentExecutor` is stored for
 * forward-compatible container wiring; Stage 26 composition still executes one
 * single-agent sub-run per planned agent so retry visibility remains per agent.
 *
 * @example
 * ```ts
 * const orchestrator = new AgentOrchestrator({
 *   supervisorPolicy,
 *   agentRegistry,
 *   singleAgentExecutor,
 *   multiAgentExecutor
 * });
 * ```
 */
export type AgentOrchestratorOptions = {
  /** Routing policy supplied at construction so run inputs remain bounded. */
  readonly supervisorPolicy: SupervisorPolicy;
  /** Read-only agent definitions used by the supervisor to produce a route. */
  readonly agentRegistry: AgentDefinitionRegistry;
  /** Single-agent execution port used by each Stage 26 sub-run. */
  readonly singleAgentExecutor: Pick<SingleAgentExecutor, "execute">;
  /**
   * Forward-compatible deterministic multi-agent executor dependency.
   *
   * Stage 26 stores this concrete dependency for runtime container wiring but
   * deliberately does not call it; sequential and parallel plans use
   * `singleAgentExecutor.execute()` once per planned agent with per-agent retry.
   */
  readonly multiAgentExecutor: TokenEfficientMultiAgentExecutor;
  /** Optional output guard; omitted values use the safe pass-through default. */
  readonly contentGuard?: ContentGuard;
  /** Optional post-run feedback hook; omitted values accept the output. */
  readonly feedbackHook?: FeedbackHook;
};

/**
 * Bounded caller-controlled inputs for one orchestration run.
 *
 * Raw task text is forwarded only to the executor. The public report contains
 * `SafeTaskMetadata` instead, while an optional trace id lets a caller connect
 * this run to an existing request trace without controlling the run id.
 *
 * @example
 * ```ts
 * await orchestrator.run({ task: "Review the local runtime security boundary." });
 * ```
 */
export type OrchestratorRunInput = {
  /** Raw task text forwarded to the configured executor. */
  readonly task: string;
  /** Validated opaque trace identifier to preserve; a UUID is generated when absent. */
  readonly traceId?: string;
  /** Optional pre-built context passed unchanged to the single-agent executor. */
  readonly contextPackage?: ContextPackage;
  /** Optional tool contracts passed unchanged to the single-agent executor. */
  readonly tools?: readonly ToolContract[];
};

/**
 * Composes safe routing, deterministic sub-runs, content inspection, and feedback.
 *
 * The orchestrator owns no mutable run state. Its injected policy chooses a
 * route from the injected registry, then this layer executes a bounded
 * composition over the single-agent execution port. Stage 26 sequential and
 * parallel plans run one isolated single-agent sub-run per planned agent,
 * each wrapped in the agent's retry policy, then merge successful reports into
 * one aggregate result.
 */
export class AgentOrchestrator {
  private readonly supervisorPolicy: SupervisorPolicy;
  private readonly agentRegistry: AgentDefinitionRegistry;
  private readonly singleAgentExecutor: Pick<SingleAgentExecutor, "execute">;
  /**
   * Forward-compatible executor retained for container wiring checks.
   *
   * Stage 26 does not invoke this executor because per-agent retry requires one
   * `singleAgentExecutor.execute()` call per planned agent. Exposing the stored
   * dependency lets wiring tests prove it is available without calling it.
   */
  readonly multiAgentExecutor: TokenEfficientMultiAgentExecutor;
  private readonly contentGuard: ContentGuard;
  private readonly feedbackHook: FeedbackHook;

  /**
   * Creates an orchestrator with explicit policy, registry, and execution dependencies.
   *
   * Missing guard and feedback seams become safe no-op defaults. Construction
   * performs no routing, execution, network access, or persistence.
   *
   * @param options - Immutable dependencies used by every subsequent run.
   */
  constructor(options: AgentOrchestratorOptions) {
    this.supervisorPolicy = options.supervisorPolicy;
    this.agentRegistry = options.agentRegistry;
    this.singleAgentExecutor = options.singleAgentExecutor;
    this.multiAgentExecutor = options.multiAgentExecutor;
    this.contentGuard = options.contentGuard ?? new NoopContentGuard();
    this.feedbackHook = options.feedbackHook ?? new NoopCritiqueLoop();
  }

  /**
   * Runs one orchestrated agent route and returns a bounded aggregate report.
   *
   * The result contains the safe classified task, a fresh run id, the supplied
   * or generated trace id, and every successful executor sub-run. Single routes
   * preserve the Phase 03 direct executor behavior. Sequential and parallel
   * routes run one retried single-agent sub-run per planned agent, aggregate
   * token usage, and apply one per-orchestrator response-policy decision to the
   * merged output when the first planned agent defines a non-per-agent policy.
   * Routing, executor, guard, and feedback failures stay within
   * `FrameworkResult` where expected so callers are not forced to catch normal
   * operational failures.
   *
   * @param input - Task plus optional trace, context, and tool contracts.
   * @returns An aggregate single-agent report or a typed failure.
   *
   * @example
   * ```ts
   * const result = await orchestrator.run({ task: "Create a secure implementation plan." });
   * if (result.ok) console.log(result.value.synthesis);
   * ```
   */
  async run(input: OrchestratorRunInput): Promise<FrameworkResult<OrchestratorReport>> {
    if (input.traceId !== undefined && !isSafeTraceId(input.traceId)) {
      return fail({
        code: "agent.invalid-route",
        message: "Supplied trace identifier is invalid.",
        severity: "recoverable"
      });
    }

    // Create fresh orchestration identifiers before routing. The caller may
    // continue an existing trace, but cannot control this run's identity.
    const runId = randomUUID();
    const traceId = input.traceId ?? randomUUID();
    const task = classifyTask(input.task);
    let plan: ReturnType<SupervisorPolicy["route"]>;

    try {
      plan = this.supervisorPolicy.route({ task, registry: this.agentRegistry });
    } catch {
      return fail(this.boundaryFailure("Supervisor routing failed."));
    }

    if (!plan.ok) {
      return fail(this.normalizeInjectedError(plan.error, "Supervisor routing returned a failure."));
    }

    const canonicalPlan = this.canonicalizeRoute(plan.value.agents, plan.value.composition);
    if (!canonicalPlan.ok) {
      return canonicalPlan;
    }

    const executionInput: OrchestratorRunInput = { ...input, traceId };
    const composition = await this.runComposition(
      canonicalPlan.value.agents,
      canonicalPlan.value.composition,
      executionInput
    );

    if (!composition.ok) {
      return fail(composition.error);
    }

    try {
      // These seams are asynchronous to permit future policy implementations
      // without coupling the composition layer to a particular guard provider.
      const contentResult = this.normalizeContentVerdict(await this.contentGuard.inspect({
        direction: "output",
        text: composition.value.synthesis
      }));
      if (!contentResult.ok) {
        return contentResult;
      }
      const contentVerdict = contentResult.value;

      if (contentVerdict.action === "block") {
        return fail({
          code: "output.unsafe",
          message: "Orchestrator output was blocked by content policy.",
          severity: "recoverable"
        });
      }

      if (contentVerdict.action === "rewrite" && contentVerdict.rewrittenText === undefined) {
        return fail({
          code: "output.unsafe",
          message: "Content policy requested a rewrite without safe replacement text.",
          severity: "recoverable"
        });
      }

      const synthesis = contentVerdict.action === "rewrite"
        ? contentVerdict.rewrittenText ?? composition.value.synthesis
        : composition.value.synthesis;

      if (composition.value.response?.action === "abstain" || composition.value.response?.action === "ask") {
        return fail({
          code: "agent.weak-evidence",
          message: composition.value.response.reason ?? "Agent output requires additional evidence.",
          severity: "recoverable"
        });
      }

      const feedbackResult = this.normalizeFeedbackVerdict(await this.feedbackHook.evaluate({
        runId,
        traceId,
        outputText: synthesis
      }));
      if (!feedbackResult.ok) {
        return feedbackResult;
      }
      const feedback = feedbackResult.value;

      const report: OrchestratorReport = {
        kind: "orchestrator",
        runId,
        traceId,
        task,
        // Retain the full supervisor plan for diagnostics alongside the
        // successfully executed sub-runs.
        plannedAgents: canonicalPlan.value.agents.map((agent) => agent.role),
        subRuns: composition.value.subRuns,
        synthesis,
        tokenUsage: composition.value.tokenUsage,
        contentVerdict,
        feedback,
        ...(composition.value.response ? { response: composition.value.response } : {}),
        ...(composition.value.refusals ? { refusals: composition.value.refusals } : {}),
        ...(composition.value.warnings ? { warnings: composition.value.warnings } : {})
      };

      return ok(report);
    } catch {
      // Third-party guard/feedback implementations are outside this layer's
      // control. Convert unexpected throws into the framework result boundary.
      return fail(this.boundaryFailure("Orchestrator guard or feedback evaluation failed."));
    }
  }

  /**
   * Replaces supervisor-supplied objects with canonical registry definitions.
   *
   * Custom policies may return stale or forged policy fields. Only stable ids
   * cross this boundary; roles, budgets, allowlists, and retry policies always
   * come from the injected registry.
   *
   * @param agents - Agent references returned by the supervisor.
   * @param composition - Requested composition strategy.
   * @returns A canonical non-empty route or a typed fail-closed error.
   */
  private canonicalizeRoute(
    agents: readonly AgentDefinition[],
    composition: "single" | "sequential" | "parallel"
  ): FrameworkResult<{
    readonly agents: readonly AgentDefinition[];
    readonly composition: "single" | "sequential" | "parallel";
  }> {
    if (agents.length === 0 || (composition === "single" && agents.length !== 1)) {
      return fail({
        code: "agent.invalid-route",
        message: "Supervisor returned an invalid route shape.",
        severity: "recoverable"
      });
    }

    const canonical: AgentDefinition[] = [];
    const seen = new Set<string>();

    for (const requested of agents) {
      if (seen.has(requested.id)) {
        return fail({
          code: "agent.invalid-route",
          message: `Supervisor route contains duplicate agent "${requested.id}".`,
          severity: "recoverable"
        });
      }

      const registered = this.agentRegistry.findById(requested.id);
      if (!registered) {
        return fail({
          code: "agent.definition-not-found",
          message: `Agent definition "${requested.id}" was not found.`,
          severity: "recoverable"
        });
      }

      seen.add(registered.id);
      canonical.push(registered);
    }

    return ok({ agents: canonical, composition });
  }

  /**
   * Creates a sanitized error for an injected dependency that threw.
   *
   * @param message - Stable boundary description safe for remote callers.
   * @returns A recoverable error without cause, stack, or thrown text.
   */
  private boundaryFailure(message: string): FrameworkError {
    return {
      code: "framework.internal-error",
      message,
      severity: "recoverable"
    };
  }

  /**
   * Normalizes an injected failure to stable, bounded framework-owned fields.
   *
   * @param error - Untrusted error-shaped value returned by a dependency.
   * @param message - Framework-owned boundary description.
   * @returns An error without dependency messages, causes, or issue payloads.
   */
  private normalizeInjectedError(error: unknown, message: string): FrameworkError {
    const candidate = typeof error === "object" && error !== null
      ? error as Readonly<Record<string, unknown>>
      : {};
    const rawCode = candidate.code;
    const code = isCanonicalErrorCode(rawCode)
      ? rawCode
      : "framework.internal-error";
    const rawRefusalReason = candidate.refusalReason;
    const refusalReason = isRefusalReason(rawRefusalReason)
      ? rawRefusalReason
      : undefined;

    return {
      code,
      message,
      severity: candidate.severity === "fatal" ? "fatal" : "recoverable",
      ...(refusalReason ? { refusalReason } : {})
    };
  }

  /**
   * Validates and strips free-form data from a content-guard verdict.
   *
   * @param value - Verdict returned by an injected guard.
   * @returns A normalized verdict or a sanitized internal failure.
   */
  private normalizeContentVerdict(value: unknown): FrameworkResult<SafetyVerdict> {
    if (typeof value !== "object" || value === null) {
      return fail(this.boundaryFailure("Content guard returned an invalid verdict."));
    }

    const candidate = value as Readonly<Record<string, unknown>>;
    const action = candidate.action;
    const safe = candidate.safe;
    if (!isContentAction(action) || typeof safe !== "boolean") {
      return fail(this.boundaryFailure("Content guard returned an invalid verdict."));
    }
    if ((action === "pass" && !safe) || (action === "block" && safe)) {
      return fail(this.boundaryFailure("Content guard returned an inconsistent verdict."));
    }

    if (action === "rewrite") {
      const rewrittenText = candidate.rewrittenText;
      if (typeof rewrittenText !== "string" || rewrittenText.length === 0 || rewrittenText.length > 1200) {
        return fail(this.boundaryFailure("Content guard returned an invalid rewrite verdict."));
      }
      return ok({ safe, action, rewrittenText });
    }

    return ok({ safe, action });
  }

  /**
   * Validates and strips free-form data from a feedback-hook verdict.
   *
   * @param value - Verdict returned by an injected feedback hook.
   * @returns A normalized verdict or a sanitized internal failure.
   */
  private normalizeFeedbackVerdict(value: unknown): FrameworkResult<FeedbackVerdict> {
    if (typeof value !== "object" || value === null) {
      return fail(this.boundaryFailure("Feedback hook returned an invalid verdict."));
    }

    const action = (value as Readonly<Record<string, unknown>>).action;
    if (!isFeedbackAction(action)) {
      return fail(this.boundaryFailure("Feedback hook returned an invalid verdict."));
    }

    return ok({ action });
  }

  /**
   * Dispatches a supervisor route to the matching deterministic composition.
   *
   * @param agents - Non-empty route returned by the supervisor policy.
   * @param composition - Supervisor-selected strategy for the route.
   * @param input - Original caller input forwarded to executor sub-runs.
   * @returns A merged composition result or the first typed failure that makes
   *   the composition unusable.
   */
  private async runComposition(
    agents: readonly AgentDefinition[],
    composition: "single" | "sequential" | "parallel",
    input: OrchestratorRunInput
  ): Promise<FrameworkResult<CompositionSuccess>> {
    const firstAgent = agents[0];

    if (!firstAgent) {
      return fail({
        code: "framework.internal-error",
        message: "Supervisor policy returned a successful route without an agent.",
        severity: "fatal"
      });
    }

    if (composition === "single") {
      return this.runSingle(firstAgent, input);
    }

    if (composition === "sequential") {
      return this.runSequential(agents, input);
    }

    return this.runParallel(agents, input);
  }

  /**
   * Runs the Phase 03 direct single-agent path.
   *
   * @param agent - First planned agent from the supervisor route.
   * @param input - Original caller input.
   * @returns A one-sub-run composition result, or the executor failure
   *   unchanged. The single path intentionally does not add orchestrator retry
   *   or response-policy evaluation so existing behavior remains stable.
   */
  private async runSingle(
    agent: AgentDefinition,
    input: OrchestratorRunInput
  ): Promise<FrameworkResult<CompositionSuccess>> {
    let sub: FrameworkResult<SingleAgentRunReport>;

    try {
      sub = await this.singleAgentExecutor.execute({
        task: input.task,
        agentId: agent.id,
        traceId: input.traceId,
        includeContext: input.contextPackage !== undefined,
        contextPackage: input.contextPackage,
        tools: input.tools
      });
    } catch {
      return fail(this.boundaryFailure("Single-agent execution failed before returning a result."));
    }

    if (!sub.ok) {
      return fail(this.normalizeInjectedError(sub.error, "Agent execution returned a failure."));
    }

    const successful = this.createSuccessfulRun(agent, sub.value, 1, input.traceId);
    if (!successful.ok) {
      return successful;
    }

    return ok({
      subRuns: [successful.value.subRun],
      synthesis: sub.value.result.summary,
      tokenUsage: sub.value.tokenUsage
    });
  }

  /**
   * Runs planned agents in order and pipes earlier summaries into later tasks.
   *
   * @param agents - Supervisor-selected route in execution order.
   * @param input - Original caller input.
   * @returns A merged composition result. A failed step aborts the sequence
   *   because downstream tasks depend on prior summaries.
   */
  private async runSequential(
    agents: readonly AgentDefinition[],
    input: OrchestratorRunInput
  ): Promise<FrameworkResult<CompositionSuccess>> {
    const successfulRuns: SuccessfulAgentRun[] = [];
    const priorSummaries: string[] = [];

    for (const agent of agents) {
      const task = this.taskWithPriorSummaries(input.task, priorSummaries);
      let attempt: AgentRunAttempt;

      try {
        attempt = await this.runOneAgentWithRetry(
          agent,
          task,
          input.traceId,
          input.contextPackage,
          input.tools
        );
      } catch {
        return fail(this.errorFromRejected());
      }

      if (!attempt.result.ok) {
        return fail(attempt.result.error);
      }

      const successful = this.createSuccessfulRun(
        agent,
        attempt.result.value,
        attempt.attemptCount,
        input.traceId
      );
      if (!successful.ok) {
        return successful;
      }
      successfulRuns.push(successful.value);
      priorSummaries.push(`${agent.role}: ${attempt.result.value.result.summary}`);
    }

    return ok(this.mergeSuccessfulRuns(agents, successfulRuns, input));
  }

  /**
   * Runs planned agents concurrently while preserving failure visibility.
   *
   * @param agents - Supervisor-selected route to execute in parallel.
   * @param input - Original caller input.
   * @returns A merged result when at least one agent succeeds; when every
   *   sub-run fails, returns the first typed failure or an internal rejection
   *   wrapper.
   */
  private async runParallel(
    agents: readonly AgentDefinition[],
    input: OrchestratorRunInput
  ): Promise<FrameworkResult<CompositionSuccess>> {
    const settled = await Promise.allSettled(
      agents.map(async (agent) => ({
        agent,
        attempt: await this.runOneAgentWithRetry(
          agent,
          input.task,
          input.traceId,
          input.contextPackage,
          input.tools
        )
      }))
    );
    const successfulRuns: SuccessfulAgentRun[] = [];
    const failures: FrameworkError[] = [];
    const refusals: OrchestratorRefusal[] = [];
    const warnings: string[] = [];

    for (const result of settled) {
      if (result.status === "rejected") {
        const error = this.errorFromRejected();
        failures.push(error);
        warnings.push(`parallel sub-run rejected: ${error.code}`);
        continue;
      }

      const { agent, attempt } = result.value;
      if (!attempt.result.ok) {
        failures.push(attempt.result.error);
        if (attempt.result.error.refusalReason) {
          refusals.push({
            agentId: agent.id,
            refusalReason: attempt.result.error.refusalReason,
            message: "Agent execution was refused by policy."
          });
        }
        warnings.push(this.warningForFailure(agent, attempt.result.error, attempt.attemptCount));
        continue;
      }

      const successful = this.createSuccessfulRun(
        agent,
        attempt.result.value,
        attempt.attemptCount,
        input.traceId
      );
      if (!successful.ok) {
        failures.push(successful.error);
        warnings.push(this.warningForFailure(agent, successful.error, attempt.attemptCount));
        continue;
      }
      successfulRuns.push(successful.value);
    }

    if (successfulRuns.length === 0) {
      return fail(failures[0] ?? {
        code: "framework.internal-error",
        message: "Parallel composition completed without a successful sub-run.",
        severity: "recoverable"
      });
    }

    return ok(this.mergeSuccessfulRuns(agents, successfulRuns, input, warnings, refusals));
  }

  /**
   * Executes one planned agent through the shared retry primitive.
   *
   * @param agent - Agent whose retry policy controls this sub-run.
   * @param task - Task text for this attempt; sequential composition may add
   *   prior summaries before forwarding it.
   * @param traceId - Outer trace identifier shared by every sub-run.
   * @param contextPackage - Optional bounded context package.
   * @param tools - Optional tool contracts to pass unchanged.
   * @returns The framework result plus the highest retry callback attempt.
   */
  private async runOneAgentWithRetry(
    agent: AgentDefinition,
    task: string,
    traceId: string | undefined,
    contextPackage?: ContextPackage,
    tools?: readonly ToolContract[]
  ): Promise<AgentRunAttempt> {
    let attemptCount = 0;
    const result = await runWithRetry(
      (attempt) => {
        attemptCount = attempt;
        return this.singleAgentExecutor.execute({
          task,
          agentId: agent.id,
          traceId,
          includeContext: contextPackage !== undefined,
          contextPackage,
          tools
        }).then((result) => result.ok
          ? result
          : fail(this.normalizeInjectedError(result.error, "Agent execution returned a failure.")));
      },
      agent.retryPolicy
    );

    return { result, attemptCount };
  }

  /**
   * Converts a successful executor report into the orchestrator sub-run shape.
   *
   * @param agent - Registered agent attributed to the executor invocation.
   * @param report - Successful single-agent executor report.
   * @param attemptCount - Number of retry-loop attempts used for this report.
   * @param traceId - Expected outer trace identifier.
   * @returns A truthful run record or a typed identity-correlation failure.
   */
  private createSuccessfulRun(
    agent: AgentDefinition,
    report: SingleAgentRunReport,
    attemptCount: number,
    traceId: string | undefined
  ): FrameworkResult<SuccessfulAgentRun> {
    if (
      report.agentId !== agent.id ||
      report.role !== agent.role ||
      (traceId !== undefined && report.traceId !== traceId)
    ) {
      return fail({
        code: "agent.invalid-route",
        message: "Executor report identity or trace did not match the canonical route.",
        severity: "recoverable"
      });
    }

    return ok({
      agent,
      report,
      subRun: {
        agentId: agent.id,
        role: agent.role,
        attemptCount,
        executorReport: { kind: "single", report }
      }
    });
  }

  /**
   * Merges successful sub-runs into the aggregate orchestrator result fields.
   *
   * @param agents - Full planned route, used to choose the response policy.
   * @param successfulRuns - Successful sub-runs to include in the report.
   * @param input - Original caller input for context source metadata.
   * @param warnings - Optional non-fatal failure or composition warnings.
   * @param refusals - Typed policy denials from failed parallel branches.
   * @returns Aggregated sub-runs, synthesis, usage, and optional response verdict.
   */
  private mergeSuccessfulRuns(
    agents: readonly AgentDefinition[],
    successfulRuns: readonly SuccessfulAgentRun[],
    input: OrchestratorRunInput,
    warnings: readonly string[] = [],
    refusals: readonly OrchestratorRefusal[] = []
  ): CompositionSuccess {
    const synthesis = this.synthesizeReports(successfulRuns);
    const tokenUsage = this.aggregateTokenUsage(successfulRuns.map((run) => run.report));

    const response = this.evaluateMergedResponse(agents, synthesis, tokenUsage, input);

    return {
      subRuns: successfulRuns.map((run) => run.subRun),
      synthesis,
      tokenUsage,
      ...(response ? { response } : {}),
      ...(refusals.length > 0 ? { refusals } : {}),
      ...(warnings.length > 0 ? { warnings } : {})
    };
  }

  /**
   * Builds the deterministic synthesis string used for composed sub-runs.
   *
   * @param runs - Successful sub-runs in the order they should appear.
   * @returns Role-prefixed summaries matching the existing synthesis engine's
   *   `role: summary | role: summary` format.
   */
  private synthesizeReports(runs: readonly SuccessfulAgentRun[]): string {
    return runs
      .map((run) => `${run.agent.role}: ${run.report.result.summary}`)
      .join(" | ")
      .slice(0, 1200);
  }

  /**
   * Sums token usage across successful single-agent reports.
   *
   * @param reports - Reports to aggregate.
   * @returns Aggregate input, output, and total token counts.
   */
  private aggregateTokenUsage(reports: readonly SingleAgentRunReport[]): TokenUsageReport {
    return reports.reduce<TokenUsageReport>(
      (total, report) => ({
        inputTokens: total.inputTokens + report.tokenUsage.inputTokens,
        outputTokens: total.outputTokens + report.tokenUsage.outputTokens,
        totalTokens: total.totalTokens + report.tokenUsage.totalTokens
      }),
      { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    );
  }

  /**
   * Evaluates the merged output against the first agent's response policy.
   *
   * @param agents - Full route; the first agent is the manager-equivalent for
   *   aggregate policy selection.
   * @param synthesis - Merged output text.
   * @param tokenUsage - Aggregate token usage attached to the guard input.
   * @param input - Original caller input for context source metadata.
   * @returns A response decision only when a non-per-agent policy is present.
   */
  private evaluateMergedResponse(
    agents: readonly AgentDefinition[],
    synthesis: string,
    tokenUsage: TokenUsageReport,
    input: OrchestratorRunInput
  ): ResponsePolicyDecision | undefined {
    const firstAgent = agents[0];
    const policy = firstAgent?.responsePolicy;

    if (!policy || policy.guardTiming === "per-agent") {
      return undefined;
    }

    const baseOutput: DeterministicAgentOutput = {
      role: firstAgent.role,
      summary: synthesis,
      findings: [],
      tokenUsage,
      sourceCount: input.contextPackage?.sources.length ?? 0
    };

    // Context availability is not proof that synthesis used a source. Leave
    // citations absent until an executor supplies claim-level provenance.
    return evaluateResponsePolicy(baseOutput, input.contextPackage, policy);
  }

  /**
   * Adds prior sequential outputs to the next agent task deterministically.
   *
   * @param task - Original caller task.
   * @param priorSummaries - Role-prefixed summaries from completed prior agents.
   * @returns The original task, optionally prefixed with bounded prior context.
   */
  private taskWithPriorSummaries(task: string, priorSummaries: readonly string[]): string {
    if (priorSummaries.length === 0) {
      return task;
    }

    return [
      "Prior agent summaries:",
      ...priorSummaries.map((summary, index) => `${index + 1}. ${summary}`),
      "",
      "Task:",
      task
    ].join("\n");
  }

  /**
   * Converts a thrown parallel branch into the framework result boundary.
   *
   * @returns A recoverable framework error suitable for warnings or total fail.
   *   The thrown reason is intentionally not copied into the result because
   *   reports may be surfaced by remote-safe callers.
   */
  private errorFromRejected(): FrameworkError {
    return {
      code: "framework.internal-error",
      message: "Agent sub-run failed before returning a framework result.",
      severity: "recoverable"
    };
  }

  /**
   * Builds a deterministic warning for a failed parallel sub-run.
   *
   * @param agent - Agent attributed to the failed sub-run.
   * @param error - Typed framework error returned by the retry loop.
   * @param attemptCount - Number of attempts made before failure.
   * @returns Human-readable warning for the aggregate report.
   */
  private warningForFailure(
    agent: AgentDefinition,
    error: FrameworkError,
    attemptCount: number
  ): string {
    return `agent=${agent.id} role=${agent.role} failed after ${attemptCount} attempt(s): ${error.code}`;
  }
}
