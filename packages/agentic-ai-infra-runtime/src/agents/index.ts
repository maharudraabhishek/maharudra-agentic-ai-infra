import { createHash, randomUUID } from "node:crypto";
import {
  DefaultConfigValidator,
  fail,
  ok,
  type AgentDefinition,
  type AgentDefinitionRegistry,
  type AgentRole,
  type AgenticInfraProjectConfig,
  type AgentProfile,
  type ContextPackage,
  type DeterministicAgentOutput,
  type EvalStore,
  type FrameworkResult,
  type MultiAgentRunReport,
  type ResolvedProjectConfig,
  type RoleContextSlice,
  type RuntimeMode,
  type SafeTaskMetadata,
  type SessionManager,
  type SharedContextPacket,
  type ToolContract
} from "@maharudra/agentic-ai-infra-core";
import { runAgentRuntimeEvals, runSingleAgentEvals } from "../evals/index.js";
import {
  evaluateResponsePolicy,
  type ResponsePolicyDecision
} from "../guardrails/output-guard.js";
import { ContextBuilder } from "../context/index.js";
import { filterToolsForMode } from "../tools/index.js";
import { type TrajectoryRecorder } from "../trajectory/index.js";
import {
  HeuristicTokenCounterProvider,
  TokenBudgetManager,
  TokenUsageRecorder
} from "../token/index.js";
import { type RuntimeObservabilitySink, silentObservabilitySink } from "../observability/index.js";
import { sha256 } from "../session/index.js";
import { isSafeTraceId } from "../internal/safe-runtime-values.js";

/** Default role set for token-efficient multi-agent execution. */
export const DEFAULT_AGENT_ROLES: readonly AgentRole[] = [
  "manager",
  "architecture-reviewer",
  "security-reviewer",
  "implementation-planner",
  "eval-reviewer",
  "docs-reviewer"
];

/** Deterministic single-agent execution result. */
export type SingleAgentRunReport = {
  readonly runId: string;
  readonly traceId: string;
  /** Canonical registry identifier used for policy and audit attribution. */
  readonly agentId: string;
  /** Canonical role from the same definition as `agentId`. */
  readonly role: AgentRole;
  readonly task: SafeTaskMetadata;
  readonly mode: "single-agent";
  readonly selectedToolIds: readonly string[];
  readonly contextSourceCount: number;
  readonly tokenUsage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
  };
  readonly result: {
    readonly summary: string;
    readonly steps: readonly string[];
    readonly warnings: readonly string[];
  };
  /** Thread id from the active session. Undefined if no session manager is wired. */
  readonly threadId?: string;
  /**
   * Output-guard verdict (Stage 25.5 Phase 03).
   *
   * Populated when the resolved canonical `AgentDefinition` has a
   * `responsePolicy`. Undefined otherwise. D23 backwards-compat.
   *
   * @guardrail
   */
  readonly response?: ResponsePolicyDecision;
};

/**
 * Role output extended with the tool ids selected after per-agent allowlist enforcement.
 *
 * Extends `DeterministicAgentOutput` so dashboard consumers can compare planned tool
 * ids against what the base executor selected without calling enforcement themselves.
 */
export type RuntimeRoleOutput = DeterministicAgentOutput & {
  readonly selectedToolIds: readonly string[];
  /** Output-guard verdict when `responsePolicy.guardTiming === "per-agent"`. */
  readonly response?: ResponsePolicyDecision;
};

/** Runtime multi-agent report with extra deterministic execution metadata. */
export type RuntimeMultiAgentRunReport = MultiAgentRunReport & {
  readonly contextBuildCount: 1;
  readonly noNetworkCalls: true;
  /** Per-role outputs with per-agent tool enforcement applied (Stage 25 Phase 04). */
  readonly roleOutputs: readonly RuntimeRoleOutput[];
};

/**
 * Input accepted by the deterministic single-agent executor.
 *
 * `agentId` selects one canonical registry definition. Supplying an id without
 * a matching definition fails closed; omitting it preserves the manager
 * default. `traceId` must be a bounded, non-sensitive opaque identifier and
 * lets an orchestrator correlate the executor report.
 */
export type SingleAgentExecutorInput = {
  readonly task: string;
  readonly agentId?: string;
  readonly traceId?: string;
  readonly includeContext?: boolean;
  readonly contextPackage?: ContextPackage;
  readonly tools?: readonly ToolContract[];
};

/** Input accepted by the deterministic multi-agent executor. */
export type MultiAgentExecutorInput = {
  readonly task: string;
  readonly contextPackage?: ContextPackage;
  readonly tools?: readonly ToolContract[];
};

/**
 * Construction options shared by both agent executors.
 *
 * Both `SingleAgentExecutor` and `TokenEfficientMultiAgentExecutor` accept
 * this single options object instead of 6 positional parameters. All fields
 * except `config` are optional.
 *
 * `evalStore` is accepted by both executors but only `TokenEfficientMultiAgentExecutor`
 * pushes records — single-agent runs cannot satisfy `runAgentRuntimeEvals`'s
 * input shape (Stage 25 adds single-agent eval via `AgentDefinition.evalRules`).
 */
export type ExecutorOptions = {
  readonly config: AgenticInfraProjectConfig | ResolvedProjectConfig;
  readonly trajectoryRecorder?: TrajectoryRecorder;
  readonly tokenRecorder?: TokenUsageRecorder;
  readonly sessionManager?: SessionManager;
  readonly sessionId?: string;
  readonly observability?: RuntimeObservabilitySink;
  /**
   * Optional eval store. When provided, `TokenEfficientMultiAgentExecutor`
   * pushes one `EvalRunRecord` per successful run after constructing the
   * report and before returning.
   *
   * `SingleAgentExecutor` accepts this option for forward compatibility but
   * does not push — Stage 25 adds single-agent eval via `AgentDefinition.evalRules`.
   */
  readonly evalStore?: EvalStore;
  /**
   * Agent definition registry for planning-time policy enforcement
   * (Stage 25 Phase 04). When provided, the executor applies per-agent
   * `allowedTools` and `budgetPolicy` from the registered `AgentDefinition`.
   *
   * When absent, behavior matches Stage 24 — no per-agent restrictions are
   * applied (D23 backwards-compat). Typically wired from
   * `container.agentRegistry`.
   */
  readonly agentRegistry?: AgentDefinitionRegistry;
};

/**
 * Creates non-reversible safe task metadata for records and dashboard data.
 */
export function classifyTask(task: string): SafeTaskMetadata {
  const normalized = task.toLowerCase();
  const labels: string[] = [];
  const riskFlags: string[] = [];

  if (/\b(security|permission|approval|migration|tool|remote|filesystem|shell)\b/.test(normalized)) {
    labels.push("security");
    riskFlags.push("trust-boundary");
  }

  if (/\b(architecture|design|runtime|provider|process|contract)\b/.test(normalized)) {
    labels.push("architecture");
  }

  if (/\b(implement|code|generate|template|package)\b/.test(normalized)) {
    labels.push("implementation");
  }

  if (/\b(test|eval|quality|verify|check)\b/.test(normalized)) {
    labels.push("quality");
  }

  if (/\b(doc|readme|runbook|learning|diagram)\b/.test(normalized)) {
    labels.push("documentation");
  }

  return {
    taskHash: createHash("sha256").update(task).digest("hex"),
    taskType: labels[0] ?? "general",
    labels: labels.length ? labels : ["general"],
    riskFlags
  };
}

/**
 * Builds deterministic ids from safe task metadata.
 */
function runIds(task: SafeTaskMetadata): { readonly traceId: string; readonly runId: string } {
  const suffix = task.taskHash.slice(0, 12);

  return {
    traceId: `trace-${suffix}`,
    runId: `run-${suffix}`
  };
}

/**
 * Builds the only task representation permitted in session persistence.
 *
 * @param task - Non-reversible metadata produced by `classifyTask`.
 * @returns A bounded label containing no raw task or prior-agent synthesis.
 */
function safeSessionGoal(task: SafeTaskMetadata): string {
  return `taskType=${task.taskType};taskHash=${task.taskHash}`;
}

/**
 * Resolves either user config or already-resolved config for executors.
 */
function resolveConfig(
  config: AgenticInfraProjectConfig | ResolvedProjectConfig
): FrameworkResult<ResolvedProjectConfig> {
  if ("security" in config && "tokenEfficiency" in config && "observability" in config) {
    return ok(config as ResolvedProjectConfig);
  }

  return new DefaultConfigValidator().validate(config);
}

/**
 * Builds a default runtime agent profile for one role.
 */
function defaultProfile(role: AgentRole): AgentProfile {
  return {
    id: role,
    role,
    description: `Deterministic ${role} agent profile.`
  };
}

/**
 * Routes only the roles required by safe task classification.
 */
export class DeterministicAgentRouter {
  /**
   * Selects roles from task metadata without calling external providers.
   */
  route(task: SafeTaskMetadata): readonly AgentRole[] {
    const roles: AgentRole[] = ["manager"];
    const labels = new Set(task.labels ?? []);

    if (labels.has("security")) {
      roles.push("security-reviewer");
    }

    if (labels.has("architecture")) {
      roles.push("architecture-reviewer");
    }

    if (labels.has("implementation")) {
      roles.push("implementation-planner");
    }

    if (labels.has("quality")) {
      roles.push("eval-reviewer");
    }

    if (labels.has("documentation")) {
      roles.push("docs-reviewer");
    }

    return [...new Set(roles)];
  }
}

/**
 * Builds shared context packets without persisting raw task text.
 */
export class SharedContextPacketBuilder {
  /**
   * Creates one shared packet from an optional context package.
   */
  build(params: {
    readonly task: SafeTaskMetadata;
    readonly contextPackage?: ContextPackage;
    readonly maxPacketTokens: number;
  }): SharedContextPacket {
    return {
      id: `shared-${params.task.taskHash.slice(0, 12)}`,
      taskHash: params.task.taskHash,
      taskType: params.task.taskType,
      maxPacketTokens: params.maxPacketTokens,
      sourceIds: params.contextPackage?.sources.map((source) => source.sourceId) ?? [],
      warnings: params.contextPackage?.warnings
    };
  }
}

/**
 * Creates role-specific context slices from one shared packet.
 */
export class RoleContextSlicer {
  /**
   * Slices source ids and budgets by role without duplicating the full context.
   */
  slice(params: {
    readonly packet: SharedContextPacket;
    readonly roles: readonly AgentRole[];
    readonly contextText: string;
    readonly budgetManager: TokenBudgetManager;
  }): readonly RoleContextSlice[] {
    const totalRoles = Math.max(1, params.roles.length);
    const sourceIds = params.packet.sourceIds;

    return params.roles.map((role, index) => {
      const maxTokens = Math.min(params.budgetManager.roleBudget(role), params.packet.maxPacketTokens);
      const charBudget = Math.max(120, Math.floor(params.contextText.length / Math.max(2, totalRoles)));
      const sliceText = params.contextText.slice(0, Math.min(charBudget, maxTokens * 4));
      const tokenEstimate = new HeuristicTokenCounterProvider().countTokens(sliceText);
      const includedSourceIds = sourceIds.filter((_, sourceIndex) =>
        sourceIndex % totalRoles === index % totalRoles
      );

      return {
        role,
        sourcePacketId: params.packet.id,
        maxTokens,
        tokenEstimate,
        includedSourceIds: includedSourceIds.length ? includedSourceIds : sourceIds.slice(0, 1),
        instructions: roleInstructions(role)
      };
    });
  }
}

/**
 * Compresses deterministic role output to a bounded shape.
 */
export class AgentOutputCompressor {
  /**
   * Limits findings so synthesis remains bounded and predictable.
   */
  compress(output: DeterministicAgentOutput): DeterministicAgentOutput {
    return {
      ...output,
      findings: output.findings.slice(0, 4),
      summary: output.summary.slice(0, 360)
    };
  }
}

/**
 * Synthesizes a final deterministic result from role outputs.
 */
export class SynthesisEngine {
  /**
   * Builds a bounded synthesis string from role summaries.
   */
  synthesize(outputs: readonly DeterministicAgentOutput[]): string {
    const parts = outputs.map((output) => `${output.role}: ${output.summary}`);

    return parts.join(" | ").slice(0, 1200);
  }
}

/**
 * Deterministic single-agent runtime executor.
 */
export class SingleAgentExecutor {
  /**
   * Creates a single-agent executor from an options object.
   *
   * Stage 24 refactored this from 6 positional params (D17). The `evalStore`
   * option is accepted for forward compatibility but is not used in Stage 24 —
   * `runAgentRuntimeEvals` requires `RuntimeMultiAgentRunReport`, which
   * single-agent runs do not produce. Stage 25 adds single-agent eval via
   * `AgentDefinition.evalRules`.
   *
   * @param options - Construction options. `config` is required; all other
   *   fields are optional. `tokenRecorder` defaults to a fresh
   *   `TokenUsageRecorder`. `observability` defaults to `silentObservabilitySink`.
   */
  constructor(private readonly options: ExecutorOptions) {}

  private get config(): AgenticInfraProjectConfig | ResolvedProjectConfig {
    return this.options.config;
  }

  private get trajectoryRecorder(): TrajectoryRecorder | undefined {
    return this.options.trajectoryRecorder;
  }

  private get tokenRecorder(): TokenUsageRecorder {
    return this.options.tokenRecorder ?? this.defaultTokenRecorder;
  }

  private readonly defaultTokenRecorder = new TokenUsageRecorder();

  private get sessionManager(): SessionManager | undefined {
    return this.options.sessionManager;
  }

  private get sessionId(): string | undefined {
    return this.options.sessionId;
  }

  private get observability(): RuntimeObservabilitySink {
    return this.options.observability ?? silentObservabilitySink;
  }

  /**
   * Executes a provider-free single-agent planning pass.
   *
   * If a `sessionManager` is provided, opens or resumes a session and opens a
   * thread before executing. Session/thread failures are non-fatal: the agent
   * emits a warning via the observability sink and continues.
   * The active `threadId` is included in the returned report and in trajectory
   * events so `PostgresTrajectoryRecorder` can link them to the correct thread.
   */
  async execute(input: SingleAgentExecutorInput): Promise<FrameworkResult<SingleAgentRunReport>> {
    if (input.traceId !== undefined && !isSafeTraceId(input.traceId)) {
      return fail({
        code: "agent.invalid-route",
        message: "Supplied trace identifier is invalid.",
        severity: "recoverable"
      });
    }

    const resolved = resolveConfig(this.config);

    if (!resolved.ok) {
      return resolved;
    }

    if (resolved.value.agents.mode !== "single-agent") {
      return fail({
        code: "agent.invalid-mode",
        message: "SingleAgentExecutor requires single-agent mode.",
        severity: "recoverable"
      });
    }

    const task = classifyTask(input.task);
    const requestedAgentId = input.agentId ?? "manager";
    const agentDefinition = this.options.agentRegistry?.findById(requestedAgentId);

    // An explicit id is a trust-boundary selector, not display metadata. Never
    // fall back to manager policy when the caller requested another identity.
    if ((input.agentId !== undefined || this.options.agentRegistry !== undefined) && !agentDefinition) {
      return fail({
        code: "agent.definition-not-found",
        message: `Agent definition "${requestedAgentId}" was not found.`,
        severity: "recoverable"
      });
    }

    const agentId = agentDefinition?.id ?? "manager";
    const agentRole = agentDefinition?.role ?? "manager";
    const generatedIds = runIds(task);
    const ids = {
      runId: generatedIds.runId,
      traceId: input.traceId ?? generatedIds.traceId
    };
    const budget = resolved.value.tokenEfficiency.tokenBudget;

    if (!budget) {
      return fail({
        code: "config.invalid-token-budget",
        message: "Single-agent execution requires a token budget.",
        severity: "recoverable"
      });
    }

    // Open or resume session and thread. All session operations are non-fatal:
    // failures are logged to the observability sink and the agent run continues.
    let activeSessionId: string | undefined;
    let activeThreadId: string | undefined;

    if (this.sessionManager) {
      try {
        const projectId = resolved.value.project.slug ?? resolved.value.project.name;
        const runtimeMode: RuntimeMode =
          resolved.value.runtime.modePolicy?.defaultMode ??
          resolved.value.runtime.modes[0] ??
          "local-stdio-mcp";
        const sessionResult = await this.sessionManager.resumeOrCreateSession(
          this.sessionId ?? randomUUID(),
          { projectId, client: "framework", runtimeMode, metadata: {} }
        );

        if (sessionResult.ok) {
          activeSessionId = sessionResult.value.sessionId;
          const threadResult = await this.sessionManager.openThread(
            activeSessionId,
            safeSessionGoal(task)
          );

          if (threadResult.ok) {
            activeThreadId = threadResult.value.threadId;
          } else {
            void this.observability.log({
              level: "warn",
              message: "Thread open failed; session tracking continues without thread.",
              metadata: { code: threadResult.error.code }
            });
          }
        } else {
          void this.observability.log({
            level: "warn",
            message: "Session tracking unavailable; agent run continues.",
            metadata: { code: sessionResult.error.code }
          });
        }
      } catch {
        void this.observability.log({
          level: "warn",
          message: "Session tracking threw unexpectedly; agent run continues.",
          metadata: {}
        });
      }
    }

    const effectiveBudgetTokens = effectiveBudgetCeiling(budget.maxTotalTokens, agentDefinition);
    const budgetManager = new TokenBudgetManager({
      ...budget,
      maxTotalTokens: effectiveBudgetTokens
    });
    const contextText = input.includeContext ? input.contextPackage?.contextText ?? "" : "";
    const allowedTools = filterToolsForMode(input.tools ?? resolved.value.tools, resolved.value.runtime.modePolicy?.defaultMode ?? resolved.value.runtime.modes[0] ?? "local-stdio-mcp");
    const selectedToolIds = enforceAllowedTools(selectToolIds(task, allowedTools), agentDefinition);

    // Stage 25.5 P03 — maxToolCalls enforcement (D31).
    const maxToolCalls = agentDefinition?.budgetPolicy?.maxToolCalls
      ?? (agentDefinition?.budgetPolicy ? 8 : Infinity);
    if (selectedToolIds.length > maxToolCalls) {
      return fail({
        code: "agent.tool-call-exceeded",
        message: `Agent ${agentId} selected ${selectedToolIds.length} tools; budgetPolicy.maxToolCalls=${maxToolCalls}.`,
        severity: "recoverable"
      });
    }

    // Stage 25.5 P03 — AbortController wall-clock race (D34). Signal is not
    // threaded into tool handlers this phase — Stage 26/27 may extend that.
    const maxRuntimeMs = agentDefinition?.budgetPolicy?.maxRuntimeMs
      ?? (agentDefinition?.budgetPolicy ? 120000 : undefined);
    const controller = maxRuntimeMs !== undefined ? new AbortController() : undefined;
    const timer = controller !== undefined && maxRuntimeMs !== undefined
      ? setTimeout(() => controller.abort(), maxRuntimeMs)
      : undefined;

    try {

    const usage = budgetManager.estimate(
      `${task.taskHash}:${task.taskType}:${contextText}`,
      selectedToolIds.join(",")
    );
    const checked = budgetManager.ensureWithinBudget(usage);

    if (!checked.ok) {
      // Mark thread as failed before returning the budget error.
      if (this.sessionManager && activeThreadId) {
        try { await this.sessionManager.updateThread(activeThreadId, { status: "failed" }); } catch {}
      }

      return checked;
    }

    this.tokenRecorder.recordUsage({
      traceId: ids.traceId,
      runId: ids.runId,
      scope: "agent",
      task,
      agentRole,
      usage
    });
    // record() is the async persistence path (Postgres or in-memory).
    // threadId is included so PostgresTrajectoryRecorder can link to the thread.
    await this.trajectoryRecorder?.record({
      traceId: ids.traceId,
      runId: ids.runId,
      agentRole,
      stepType: "single-agent-plan",
      status: "completed",
      durationMs: 0,
      taskHash: task.taskHash,
      taskType: task.taskType,
      tokenEstimate: usage.totalTokens,
      sourceCount: input.contextPackage?.sources.length ?? 0,
      threadId: activeThreadId
    });

    // Record the tool plan as a single pending→success tool call entry.
    if (this.sessionManager && activeThreadId) {
      try {
        await this.sessionManager.recordToolCall({
          threadId: activeThreadId,
          toolName: "agent.single-agent-plan",
          inputHash: sha256({ taskHash: task.taskHash, selectedToolIds }),
          outputHash: sha256({ runId: ids.runId, totalTokens: usage.totalTokens }),
          status: "success",
          startedAt: new Date(),
          completedAt: new Date(),
          errorCode: undefined,
          tokenEstimate: usage.totalTokens
        });
      } catch {}
    }

    const summary = `Deterministic ${task.taskType} plan created from safe metadata and bounded context.`;

    // Update thread as completed and touch the session.
    if (this.sessionManager && activeThreadId) {
      try { await this.sessionManager.updateThread(activeThreadId, { status: "completed", stateSummary: summary }); } catch {}
    }

    if (this.sessionManager && activeSessionId) {
      try { await this.sessionManager.touchSession(activeSessionId); } catch {}
    }

    // Stage 25 — single-agent eval push. Only when (a) caller wired an
    // evalStore, and (b) the resolved canonical definition declares
    // evalRules. Otherwise no record is pushed (D24 — avoids junk).
    if (this.options.evalStore && agentDefinition?.evalRules) {
      try {
        const qualityReport = runSingleAgentEvals(
          {
            selectedToolIds,
            tokenUsage: { totalTokens: usage.totalTokens }
          },
          agentDefinition
        );

        this.options.evalStore.push({
          runId: ids.runId,
          traceId: ids.traceId,
          threadId: activeThreadId,
          recordedAt: new Date().toISOString(),
          report: qualityReport
        });
      } catch (error) {
        // Eval push is non-fatal — log via observability if available,
        // otherwise swallow. Never abort the agent run because of an
        // eval store failure.
        void this.observability.log({
          level: "warn",
          message: "[SingleAgentExecutor] Eval push failed; continuing.",
          metadata: { error: error instanceof Error ? error.message : String(error) }
        });
      }
    }

    // Stage 25.5 P03 — wall-clock timeout check (D34). When the AbortController
    // fired before we reached this point, return agent.timeout and discard the run.
    if (controller?.signal.aborted) {
      return fail({
        code: "agent.timeout",
        message: `Agent ${agentId} exceeded maxRuntimeMs=${maxRuntimeMs ?? 0}.`,
        severity: "recoverable"
      });
    }

    // Stage 25.5 P03 — output guard (D32). Evaluated per-orchestrator for
    // single-agent runs (there is no orchestrator above SingleAgentExecutor).
    const responseDecision = agentDefinition?.responsePolicy
      ? evaluateResponsePolicy(
          {
            role: agentRole,
            summary,
            findings: [],
            sourceCount: input.contextPackage?.sources.length ?? 0
          },
          input.contextPackage,
          agentDefinition.responsePolicy
        )
      : undefined;

    if (responseDecision?.action === "abstain") {
      return fail({
        code: "agent.weak-evidence",
        message: responseDecision.reason ?? "Agent abstained due to weak evidence.",
        severity: "recoverable"
      });
    }

    return ok({
      runId: ids.runId,
      traceId: ids.traceId,
      agentId,
      role: agentRole,
      task,
      mode: "single-agent",
      selectedToolIds,
      contextSourceCount: input.contextPackage?.sources.length ?? 0,
      tokenUsage: usage,
      result: {
        summary,
        steps: [
          "Validate config and runtime mode.",
          "Use bounded context evidence when available.",
          "Execute only tools that pass runtime policy and approval gates."
        ],
        warnings: input.includeContext && !input.contextPackage
          ? ["Context was requested but no context package was available."]
          : []
      },
      threadId: activeThreadId,
      response: responseDecision
    });

    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

/**
 * Deterministic token-efficient multi-agent executor.
 */
export class TokenEfficientMultiAgentExecutor {
  /**
   * Creates a multi-agent executor from an options object.
   *
   * Stage 24 refactored this from 6 positional params (D17). The `evalStore`
   * option, when set, causes `execute()` to push one `EvalRunRecord` per
   * successful run after the report is built and before returning.
   */
  constructor(private readonly options: ExecutorOptions) {}

  private get config(): AgenticInfraProjectConfig | ResolvedProjectConfig {
    return this.options.config;
  }

  private get trajectoryRecorder(): TrajectoryRecorder | undefined {
    return this.options.trajectoryRecorder;
  }

  private get tokenRecorder(): TokenUsageRecorder {
    return this.options.tokenRecorder ?? this.defaultTokenRecorder;
  }

  private readonly defaultTokenRecorder = new TokenUsageRecorder();

  private get sessionManager(): SessionManager | undefined {
    return this.options.sessionManager;
  }

  private get sessionId(): string | undefined {
    return this.options.sessionId;
  }

  private get observability(): RuntimeObservabilitySink {
    return this.options.observability ?? silentObservabilitySink;
  }

  /**
   * Executes routed deterministic agents over one shared context packet.
   *
   * Opens one session and one thread for the entire multi-agent run. Sub-agents
   * share the parent session via the same `sessionId` so the dashboard groups
   * their activity under one timeline entry.
   */
  async execute(input: MultiAgentExecutorInput): Promise<FrameworkResult<RuntimeMultiAgentRunReport>> {
    const resolved = resolveConfig(this.config);

    if (!resolved.ok) {
      return resolved;
    }

    if (resolved.value.agents.mode !== "token-efficient-multi-agent") {
      return fail({
        code: "agent.invalid-mode",
        message: "TokenEfficientMultiAgentExecutor requires token-efficient multi-agent mode.",
        severity: "recoverable"
      });
    }

    const budget = resolved.value.tokenEfficiency.tokenBudget;

    if (!budget) {
      return fail({
        code: "config.multi-agent-token-budget-required",
        message: "Token-efficient multi-agent execution requires token budget config.",
        severity: "recoverable"
      });
    }

    const task = classifyTask(input.task);
    const ids = runIds(task);

    // Open session and one shared thread for the entire multi-agent run.
    // Sub-agents share this session via the same sessionId — they do NOT open
    // their own threads. Failures are non-fatal.
    let activeSessionId: string | undefined;
    let activeThreadId: string | undefined;

    if (this.sessionManager) {
      try {
        const projectId = resolved.value.project.slug ?? resolved.value.project.name;
        const runtimeMode: RuntimeMode =
          resolved.value.runtime.modePolicy?.defaultMode ??
          resolved.value.runtime.modes[0] ??
          "local-stdio-mcp";
        const sessionResult = await this.sessionManager.resumeOrCreateSession(
          this.sessionId ?? randomUUID(),
          { projectId, client: "framework", runtimeMode, metadata: {} }
        );

        if (sessionResult.ok) {
          activeSessionId = sessionResult.value.sessionId;
          const threadResult = await this.sessionManager.openThread(
            activeSessionId,
            safeSessionGoal(task)
          );

          if (threadResult.ok) {
            activeThreadId = threadResult.value.threadId;
          }
        }
      } catch {
        void this.observability.log({
          level: "warn",
          message: "Multi-agent session tracking failed; run continues.",
          metadata: {}
        });
      }
    }

    const builtContext = input.contextPackage
      ? ok(input.contextPackage)
      : await new ContextBuilder().build({
          task: input.task,
          retrievalResults: [],
          tokenBudget: budget
        });

    if (!builtContext.ok) {
      if (this.sessionManager && activeThreadId) {
        try { await this.sessionManager.updateThread(activeThreadId, { status: "failed" }); } catch {}
      }

      return fail({
        code: "agent.context-unavailable",
        message: "Shared context package could not be built.",
        severity: "recoverable"
      });
    }

    const contextPackage = builtContext.value;
    const packet = new SharedContextPacketBuilder().build({
      task,
      contextPackage,
      maxPacketTokens: resolved.value.agents.sharedContext?.maxPacketTokens ?? budget.maxContextTokens
    });
    const routedRoles = new DeterministicAgentRouter().route(task);
    const roleCheck = ensureRolesEnabled(routedRoles, resolved.value.agents.agents);

    if (!roleCheck.ok) {
      if (this.sessionManager && activeThreadId) {
        try { await this.sessionManager.updateThread(activeThreadId, { status: "failed" }); } catch {}
      }

      return roleCheck;
    }

    const budgetManager = new TokenBudgetManager(budget);
    const roleSlices = new RoleContextSlicer().slice({
      packet,
      roles: routedRoles,
      contextText: contextPackage.contextText,
      budgetManager
    });
    const sharedUsage = budgetManager.estimate(contextPackage.contextText);

    this.tokenRecorder.recordUsage({
      traceId: ids.traceId,
      runId: ids.runId,
      scope: "shared-context",
      task,
      usage: sharedUsage
    });

    const compressor = new AgentOutputCompressor();
    const executorAllowedTools = filterToolsForMode(
      input.tools ?? resolved.value.tools,
      resolved.value.runtime.modePolicy?.defaultMode ?? resolved.value.runtime.modes[0] ?? "local-stdio-mcp"
    );
    const baseOutputs = roleSlices.map((slice) =>
      compressor.compress(createRoleOutput(slice, task))
    );
    const outputs: DeterministicAgentOutput[] = baseOutputs;
    // Stage 25.5 P03 — collect per-role budget warnings (soft; does not fail the run).
    const roleWarnings: string[] = [];
    const roleOutputs: RuntimeRoleOutput[] = roleSlices.map((slice, i) => {
      const baseOutput = baseOutputs[i]!;
      const roleDefinition = this.options.agentRegistry?.findByRole(slice.role)[0];
      const rawToolIds = selectToolIds(task, executorAllowedTools);
      const selectedToolIds = enforceAllowedTools(rawToolIds, roleDefinition);

      // Stage 25.5 P03 — soft maxToolCalls check per role (D31). Records a warning;
      // does NOT fail the whole run. Stage 26 orchestrator adds per-role isolation.
      const maxToolCalls = roleDefinition?.budgetPolicy?.maxToolCalls
        ?? (roleDefinition?.budgetPolicy ? 8 : Infinity);
      if (selectedToolIds.length > maxToolCalls) {
        roleWarnings.push(`role=${slice.role} exceeded maxToolCalls=${maxToolCalls}`);
      }

      const effectiveRoleBudget = effectiveBudgetCeiling(
        budgetManager.roleBudget(slice.role),
        roleDefinition
      );
      const baseUsage = baseOutput.tokenUsage;
      const tokenUsage = baseUsage
        ? {
            inputTokens: Math.min(baseUsage.inputTokens, effectiveRoleBudget),
            outputTokens: baseUsage.outputTokens,
            totalTokens: Math.min(baseUsage.totalTokens, effectiveRoleBudget)
          }
        : baseUsage;

      // Stage 25.5 P03 — per-agent guard timing (D32). Runs the output guard when
      // `guardTiming === "per-agent"`; per-orchestrator timing defers to Stage 26.
      const responseDecision =
        roleDefinition?.responsePolicy?.guardTiming === "per-agent"
          ? evaluateResponsePolicy(baseOutput, contextPackage, roleDefinition.responsePolicy)
          : undefined;

      return { ...baseOutput, selectedToolIds, tokenUsage, response: responseDecision };
    });
    const synthesis = new SynthesisEngine().synthesize(outputs);
    const outputUsage = budgetManager.estimate("", JSON.stringify(outputs));
    const synthesisUsage = budgetManager.estimate("", synthesis);
    const actualUsage = {
      inputTokens:
        sharedUsage.inputTokens +
        roleSlices.reduce((total, slice) => total + (slice.tokenEstimate ?? 0), 0),
      outputTokens: outputUsage.outputTokens + synthesisUsage.outputTokens,
      totalTokens:
        sharedUsage.totalTokens +
        roleSlices.reduce((total, slice) => total + (slice.tokenEstimate ?? 0), 0) +
        outputUsage.outputTokens +
        synthesisUsage.outputTokens
    };
    const checked = budgetManager.ensureWithinBudget(actualUsage);

    if (!checked.ok) {
      if (this.sessionManager && activeThreadId) {
        try { await this.sessionManager.updateThread(activeThreadId, { status: "failed" }); } catch {}
      }

      return checked;
    }

    for (const output of outputs) {
      this.tokenRecorder.recordUsage({
        traceId: ids.traceId,
        runId: ids.runId,
        scope: "agent",
        task,
        agentRole: output.role,
        usage: output.tokenUsage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
      });
      // Async record for persistence; threadId links to the shared thread.
      await this.trajectoryRecorder?.record({
        traceId: ids.traceId,
        runId: ids.runId,
        agentRole: output.role,
        stepType: "deterministic-agent",
        status: "completed",
        durationMs: 0,
        taskHash: task.taskHash,
        taskType: task.taskType,
        tokenEstimate: output.tokenUsage?.totalTokens,
        sourceCount: output.sourceCount,
        threadId: activeThreadId
      });
    }

    const naiveTokenEstimate =
      (contextPackage.tokenEstimate || sharedUsage.inputTokens) * routedRoles.length +
      outputUsage.outputTokens +
      synthesisUsage.outputTokens;

    const synthesis_summary = `Token-efficient multi-agent ${task.taskType} run: ${routedRoles.length} roles, ${outputs.length} outputs.`;

    // Update thread as completed and touch session.
    if (this.sessionManager && activeThreadId) {
      try { await this.sessionManager.updateThread(activeThreadId, { status: "completed", stateSummary: synthesis_summary }); } catch {}
    }

    if (this.sessionManager && activeSessionId) {
      try { await this.sessionManager.touchSession(activeSessionId); } catch {}
    }

    const runReport: RuntimeMultiAgentRunReport = {
      runId: ids.runId,
      traceId: ids.traceId,
      task,
      routedRoles,
      sharedContextPacketId: packet.id,
      roleSlices,
      outputs,
      synthesis,
      tokenUsage: actualUsage,
      naiveTokenEstimate,
      sharedContextTokenEstimate: sharedUsage.inputTokens,
      estimatedTokenSavings: Math.max(0, naiveTokenEstimate - actualUsage.totalTokens),
      warnings: roleWarnings.length > 0
        ? [...(contextPackage.warnings ?? []), ...roleWarnings]
        : contextPackage.warnings,
      contextBuildCount: 1,
      noNetworkCalls: true,
      roleOutputs
    };

    // Stage 24: push one EvalRunRecord per successful run. Non-fatal —
    // EvalStore.push does not throw, and runAgentRuntimeEvals is synchronous
    // and never throws. Suite-level rules (AgentEvaluator) re-evaluate with
    // configured `requiredRoles`, `forbiddenTools`, and `hardBudget`.
    if (this.options.evalStore) {
      const evalReport = runAgentRuntimeEvals({ report: runReport });
      this.options.evalStore.push({
        runId: ids.runId,
        traceId: ids.traceId,
        threadId: activeThreadId,
        recordedAt: new Date().toISOString(),
        report: evalReport
      });
    }

    return ok(runReport);
  }
}

/**
 * Selects safe tool ids for a task classification.
 */
function selectToolIds(task: SafeTaskMetadata, tools: readonly ToolContract[]): readonly string[] {
  const labels = new Set(task.labels ?? []);

  return tools
    .filter((tool) => {
      if (labels.has("quality")) {
        return tool.category === "eval" || tool.category === "observability" || tool.category === "business-safe";
      }

      if (labels.has("security")) {
        return tool.category === "context" || tool.category === "eval" || tool.category === "business-safe";
      }

      return tool.category !== "write" && tool.category !== "admin" && tool.category !== "command";
    })
    .slice(0, 4)
    .map((tool) => tool.id);
}

/**
 * Tightens the tool id list to those explicitly permitted by the agent definition.
 *
 * The allowedTools filter is applied AFTER `selectToolIds()` so it can only narrow
 * the selection, never broaden it. When the definition has no `allowedTools` field
 * the full selected list is returned unchanged (D20).
 */
function enforceAllowedTools(
  selectedIds: readonly string[],
  definition?: AgentDefinition
): readonly string[] {
  if (!definition?.allowedTools) {
    return selectedIds;
  }
  const allowed = new Set(definition.allowedTools);
  return selectedIds.filter((id) => allowed.has(id));
}

/**
 * Returns the effective token ceiling for a single agent as the minimum of
 * the project-level budget and the agent's `budgetPolicy.maxTokens` cap.
 *
 * Never widens — returns `projectBudgetTokens` unchanged when the definition
 * has no explicit cap (D20). Uses Math.min so an agent definition cannot grant
 * itself more tokens than the project allows.
 */
function effectiveBudgetCeiling(
  projectBudgetTokens: number,
  definition?: AgentDefinition
): number {
  const agentMax = definition?.budgetPolicy?.maxTokens;
  if (agentMax === undefined) {
    return projectBudgetTokens;
  }
  return Math.min(projectBudgetTokens, agentMax);
}

/**
 * Verifies required routed roles are enabled when a config lists explicit
 * profiles.
 */
function ensureRolesEnabled(
  roles: readonly AgentRole[],
  profiles: readonly AgentProfile[] | undefined
): FrameworkResult<void> {
  if (!profiles?.length) {
    return ok(undefined);
  }

  const enabled = new Set(profiles.map((profile) => profile.role));
  const missing = roles.filter((role) => !enabled.has(role));

  if (missing.length > 0) {
    return fail({
      code: "agent.role-disabled",
      message: `Required agent role is disabled: ${missing.join(", ")}.`,
      severity: "recoverable"
    });
  }

  return ok(undefined);
}

/**
 * Creates deterministic role-specific guidance from safe slice metadata.
 */
function createRoleOutput(slice: RoleContextSlice, task: SafeTaskMetadata): DeterministicAgentOutput {
  const findings = [
    `Task type: ${task.taskType}.`,
    `Slice sources: ${slice.includedSourceIds.length}.`,
    `Slice budget: ${slice.maxTokens} tokens.`
  ];

  if (slice.role === "security-reviewer") {
    findings.push("Verify remote-safe policy, exact approval, and sanitized outputs.");
  }

  if (slice.role === "architecture-reviewer") {
    findings.push("Check package boundaries and dependency inversion.");
  }

  if (slice.role === "implementation-planner") {
    findings.push("Plan scoped TypeScript changes without unsafe mutation.");
  }

  if (slice.role === "eval-reviewer") {
    findings.push("Confirm deterministic tests and public docs wording checks.");
  }

  if (slice.role === "docs-reviewer") {
    findings.push("Keep public docs professional and internal learning notes tutorial-style.");
  }

  const outputText = findings.join(" ");
  const counter = new HeuristicTokenCounterProvider();

  const citations = slice.includedSourceIds.map((sourceId) => ({
    sourceId
  }));

  return {
    role: slice.role,
    summary: `${slice.role} produced deterministic ${task.taskType} guidance.`,
    findings,
    sourceCount: slice.includedSourceIds.length,
    tokenUsage: {
      inputTokens: slice.tokenEstimate ?? 0,
      outputTokens: counter.countTokens(outputText),
      totalTokens: (slice.tokenEstimate ?? 0) + counter.countTokens(outputText)
    },
    citations
  };
}

/**
 * Returns role-specific slice instructions.
 */
function roleInstructions(role: AgentRole): readonly string[] {
  switch (role) {
    case "security-reviewer":
      return ["Review permission gates, approvals, remote safety, and sanitization."];
    case "architecture-reviewer":
      return ["Review package boundaries, runtime contracts, and dependency direction."];
    case "implementation-planner":
      return ["Plan implementation steps without applying patches or bypassing policy."];
    case "eval-reviewer":
      return ["Review deterministic eval and test coverage."];
    case "docs-reviewer":
      return ["Review public docs and internal learning notes for clarity and boundaries."];
    default:
      return ["Coordinate deterministic execution and synthesis."];
  }
}

/**
 * Returns default deterministic agent profiles.
 */
export function createDefaultAgentProfiles(): readonly AgentProfile[] {
  return DEFAULT_AGENT_ROLES.map(defaultProfile);
}

// -------------------------------------------------------------------------
// Stage 25 — Agent definition registry (Phase 02)
// -------------------------------------------------------------------------

export {
  DEFAULT_AGENT_DEFINITIONS,
  InMemoryAgentDefinitionRegistry,
  createAgentDefinitionRegistry
} from "./registry.js";
