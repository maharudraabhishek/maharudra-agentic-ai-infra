import type { TokenUsageReport } from "../token/types.js";

/** Agent execution mode used by generated and runtime workflows. */
export type AgentRuntimeMode =
  | "single-agent"
  | "token-efficient-multi-agent";

/** Role labels used for routing and context slicing. */
export type AgentRole =
  | "manager"
  | "architecture-reviewer"
  | "security-reviewer"
  | "implementation-planner"
  | "eval-reviewer"
  | "docs-reviewer"
  | "planner"
  | "implementer"
  | "reviewer"
  | "security"
  | "retrieval"
  | "dashboard"
  | "custom";

/** Safe task metadata that may be persisted by runtime records and dashboards. */
export type SafeTaskMetadata = {
  readonly taskHash: string;
  readonly taskType: string;
  readonly labels?: readonly string[];
  readonly riskFlags?: readonly string[];
};

/** One configured agent profile. */
export type AgentProfile = {
  readonly id: string;
  readonly role: AgentRole;
  readonly description?: string;
  readonly maxContextTokens?: number;
};

/**
 * Legacy registry interface for available agent profiles.
 *
 * @deprecated Stage 25 supersedes this with {@link AgentDefinitionRegistry},
 *   which exposes the richer `AgentDefinition` shape (policy fields included).
 *   This interface has no implementations in the framework. It is kept to
 *   avoid breaking any downstream code that may have typed against it.
 *
 *   New code should depend on `AgentDefinitionRegistry`. Existing consumers
 *   (none in this repo) should migrate when they need policy fields.
 */
export interface AgentRegistry {
  /** Lists every configured agent profile. */
  list(): readonly AgentProfile[];
  /** Finds profiles that match a role. */
  findByRole(role: AgentRole): readonly AgentProfile[];
  /** Finds one profile by stable id. */
  findById(id: string): AgentProfile | undefined;
}

/**
 * Legacy router interface for selecting an agent for a task.
 *
 * @deprecated Never implemented; the framework's actual router is
 *   `DeterministicAgentRouter` in runtime, which has a different signature
 *   (`route(task: SafeTaskMetadata) => readonly AgentRole[]`). Kept to avoid
 *   breaking any downstream consumer. Stage 26 will introduce a proper
 *   orchestration-aware router; do not extend this interface.
 */
export interface AgentRouter {
  /** Selects one agent from the available profiles for a task. */
  route(task: string, agents: readonly AgentProfile[]): AgentProfile;
}

/** Role-specific slice of a shared context packet. */
export type RoleContextSlice = {
  readonly role: AgentRole;
  readonly sourcePacketId: string;
  readonly maxTokens: number;
  readonly includedSourceIds: readonly string[];
  readonly tokenEstimate?: number;
  readonly instructions?: readonly string[];
};

/** Shared context packet used by token-efficient multi-agent workflows. */
export type SharedContextPacket = {
  readonly id: string;
  readonly taskHash: string;
  readonly taskType: string;
  readonly maxPacketTokens: number;
  readonly sourceIds: readonly string[];
  readonly warnings?: readonly string[];
  readonly roleSlices?: readonly RoleContextSlice[];
};

/** One step in an agent workflow trajectory. */
export type AgentTrajectoryStep = {
  readonly id: string;
  readonly agentId: string;
  readonly role: AgentRole;
  readonly summary: string;
  readonly tokenUsage?: TokenUsageReport;
  readonly startedAt?: string;
  readonly completedAt?: string;
};

/** Ordered record of an agent workflow. */
export type AgentTrajectory = {
  readonly id: string;
  readonly mode: AgentRuntimeMode;
  readonly task?: SafeTaskMetadata;
  readonly sharedContextPacketId?: string;
  readonly steps: readonly AgentTrajectoryStep[];
};

/** Agent runtime configuration stored in project config. */
export type AgentRuntimeConfig = {
  readonly mode: AgentRuntimeMode;
  readonly agents?: readonly AgentProfile[];
  readonly sharedContext?: {
    readonly enabled: boolean;
    readonly maxPacketTokens?: number;
    readonly roleSlices?: readonly RoleContextSlice[];
  };
};

/**
 * One source citation attached to a `DeterministicAgentOutput`.
 *
 * Each citation corresponds to one entry in the upstream `ContextPackage.sources`
 * used to produce the output. Citations are populated by the executors at run
 * time (Stage 25.5 Phase 02) — core types do not compute them.
 *
 * @umbrella Guardrails — used by OutputGuard (Phase 03) and Stage 42 LLM judge
 *   to verify that agent claims are grounded in retrieved evidence.
 */
export type AgentOutputCitation = {
  /** Stable id of the context source. Matches `ContextSource.sourceId`. */
  readonly sourceId: string;
  /** Human-readable label (e.g. file path or document title). Optional. */
  readonly label?: string;
  /** Retrieval provider that surfaced this source. Optional. */
  readonly providerId?: string;
};

/**
 * One deterministic role output produced without provider or network calls.
 *
 * Stage 25.5 Phase 02 added four optional Guardrails-related fields:
 * `citations`, `evidenceCoverage`, `confidence`, `abstainReason`. All four
 * are optional and D23-safe: pre-Stage-25.5 callers that construct this type
 * without these fields continue to work unchanged.
 */
export type DeterministicAgentOutput = {
  readonly role: AgentRole;
  readonly summary: string;
  readonly findings: readonly string[];
  readonly tokenUsage?: TokenUsageReport;
  readonly sourceCount: number;
  /**
   * Citations to context sources used to produce this output.
   *
   * Populated by `SingleAgentExecutor` and `TokenEfficientMultiAgentExecutor`
   * from the upstream `ContextPackage.sources` (Stage 25.5 Phase 02).
   * Undefined when no context package was available.
   *
   * @guardrail
   */
  readonly citations?: readonly AgentOutputCitation[];
  /**
   * Fraction in [0, 1] of context sources that were cited in the output text.
   *
   * Populated by Phase 03's OutputGuard when a `responsePolicy` is configured.
   * Undefined in Phase 02 — the wiring exists but no caller computes it yet.
   *
   * @guardrail
   */
  readonly evidenceCoverage?: number;
  /**
   * Optional self-assessment in [0, 1] of the agent's confidence in this output.
   *
   * Populated by Stage 42's Constitutional AI judge when enabled. Undefined
   * otherwise. Deterministic executors do not compute confidence.
   *
   * @guardrail
   */
  readonly confidence?: number;
  /**
   * Free-form reason populated when the agent chose to abstain.
   *
   * Set by Phase 03's OutputGuard when `responsePolicy.onWeakEvidence === "abstain"`
   * and evidence coverage falls below `minEvidenceCoverage`. The typed
   * verdict ("abstain" | "ask" | "warn") lives on the response policy itself.
   *
   * @guardrail
   */
  readonly abstainReason?: string;
};

/** Summary returned by token-efficient multi-agent execution. */
export type MultiAgentRunReport = {
  readonly runId: string;
  readonly traceId: string;
  readonly task: SafeTaskMetadata;
  readonly routedRoles: readonly AgentRole[];
  readonly sharedContextPacketId: string;
  readonly roleSlices: readonly RoleContextSlice[];
  readonly outputs: readonly DeterministicAgentOutput[];
  readonly synthesis: string;
  readonly tokenUsage: TokenUsageReport;
  readonly naiveTokenEstimate: number;
  readonly sharedContextTokenEstimate: number;
  readonly estimatedTokenSavings: number;
  readonly warnings?: readonly string[];
};

/** Closed enum: response mode for an agent (Stage 25.5 D30). */
export type AgentResponseMode = "freeform" | "grounded" | "strict-cited" | "json-schema";

/** Closed enum: behavior when evidence is insufficient (Stage 25.5 D30). */
export type AgentOnWeakEvidence = "abstain" | "ask" | "warn";

/**
 * Closed enum: when the Output Guard runs (Stage 25.5 D32).
 *
 * `per-tool` is intentionally not in this taxonomy — Stage 21 D1 forbids
 * Layer 9 (Harness) from calling Layer 11 (SmartRouter), which would be
 * required for LLM-judge guards. Heuristic-only per-tool checking lives in
 * the Input Guard (Stage 25.5 Phase 01).
 */
export type AgentGuardTiming = "per-orchestrator" | "per-agent";

/**
 * Per-agent response (output guard) policy.
 *
 * @umbrella Guardrails — output-side
 *
 * Stage 25.5 Phase 03 wires `requireCitations`, `minEvidenceCoverage`, and
 * `onWeakEvidence` against the heuristic OutputGuard. `mode = "json-schema"`
 * is reserved for Stage 26 (depends on `outputSchema`).
 *
 * @example
 * const def: AgentDefinition = {
 *   id: "security-strict",
 *   role: "security-reviewer",
 *   responsePolicy: {
 *     mode: "strict-cited",
 *     requireCitations: true,
 *     minEvidenceCoverage: 0.75,
 *     onWeakEvidence: "abstain",
 *     guardTiming: "per-agent"
 *   }
 * };
 */
export type AgentResponsePolicy = {
  readonly mode?: AgentResponseMode;
  readonly requireCitations?: boolean;
  readonly minEvidenceCoverage?: number;
  readonly onWeakEvidence?: AgentOnWeakEvidence;
  readonly guardTiming?: AgentGuardTiming;
};

/**
 * Per-agent token budget policy.
 *
 * When set on an `AgentDefinition`, the executor enforces this ceiling on
 * top of the project-level token budget. The agent-specific ceiling never
 * widens the project budget — only narrows it.
 *
 * `maxTokens` covers the total of input + output for one agent execution
 * within a multi-agent run, or one full single-agent execution.
 *
 * @example
 * const def: AgentDefinition = {
 *   id: "security-strict",
 *   role: "security-reviewer",
 *   budgetPolicy: { maxTokens: 2000 }
 * };
 */
export type AgentBudgetPolicy = {
  /** Hard ceiling on input + output tokens. Must be a positive integer. */
  readonly maxTokens: number;
  /**
   * Maximum number of tool calls per agent execution. Default 8 when
   * `budgetPolicy` is set on an `AgentDefinition`. Stage 25.5 Phase 03.
   *
   * @guardrail
   */
  readonly maxToolCalls?: number;
  /**
   * Wall-clock ceiling in milliseconds. Default 120000 (2 minutes) when
   * `budgetPolicy` is set on an `AgentDefinition`. Stage 25.5 Phase 03 wires
   * the `AbortController` race; orphaned handlers continue to completion
   * and their results are discarded (D34).
   *
   * @guardrail
   */
  readonly maxRuntimeMs?: number;
  /**
   * Maximum critique iterations (SelfCritiqueLoop, Stage 48). No default
   * today; the field is declared so Stage 48 implementations can read it
   * without further core changes. Stage 25.5 Phase 03 only types the field.
   *
   * @feedback-loop
   */
  readonly maxIterations?: number;
};

/**
 * Per-agent eval rules used by `runSingleAgentEvals()` (added Stage 25 Phase 05).
 *
 * When an `AgentDefinition` carries `evalRules` AND the executor has an
 * `EvalStore` wired, `SingleAgentExecutor.execute()` pushes one
 * `EvalRunRecord` after a successful run.
 *
 * All three fields are optional. Each absent field skips the corresponding
 * check (eval result status = "skipped"). Empty arrays are treated as
 * present but vacuous (e.g. `forbiddenTools: []` skips the forbidden-tool
 * check).
 */
export type AgentEvalRules = {
  /**
   * Tool ids that must appear in the agent's selected tool set.
   * Empty array or undefined skips the check.
   */
  readonly requiredTools?: readonly string[];
  /**
   * Tool ids that must NOT appear in the agent's selected tool set.
   * Empty array or undefined skips the check.
   */
  readonly forbiddenTools?: readonly string[];
  /**
   * Hard ceiling on total tokens used. Distinct from `AgentBudgetPolicy.maxTokens`:
   * budget is enforced at planning time (changes behavior), eval `hardBudget`
   * is observed at eval time (records a pass/fail result without changing
   * behavior).
   */
  readonly hardBudget?: number;
};

/**
 * Per-agent model routing policy.
 *
 * @remarks Declared in Stage 25 to lock the shape. Enforcement deferred to
 *   Stage 26, when `AgentOrchestrator` routes per-agent LLM calls through
 *   `SmartRouter` honoring this policy.
 *
 *   In Stage 25 the field is accepted on `AgentDefinition` but the executor
 *   does not call it — the deterministic executors do not invoke LLMs.
 */
export type AgentModelPolicy = {
  /** Preferred LLM provider id from `LlmConfig.providers[*].id`. */
  readonly preferredProviderId?: string;
};

/**
 * Per-agent retrieval strategy policy.
 *
 * @remarks Declared in Stage 25 to lock the shape. Enforcement deferred to
 *   Stage 26 when the orchestrator builds per-agent context packets.
 *
 *   `strategy` is a free-form string today; Stage 26 will narrow it to a
 *   union of supported strategies (e.g. "full-text-only", "semantic-only",
 *   "hybrid").
 */
export type AgentRetrievalPolicy = {
  /** Strategy hint for retrieval; honored by Stage 26 orchestrator. */
  readonly strategy?: string;
};

/**
 * Per-agent memory access policy.
 *
 * Declared in Stage 25; enforcement deferred to Stage 27 (`MemoryStore`).
 * Stage 25.5 Phase 05 added the `episodic` field (D44) — same access-mode
 * union as `semantic`, same Stage 27 enforcement deferral.
 *
 * @umbrella (not under either umbrella — memory is its own concern)
 */
export type AgentMemoryPolicy = {
  /** Access mode for the semantic memory layer (vector/embedding-backed). */
  readonly semantic?: "read" | "read-write" | "none";
  /**
   * Access mode for the episodic memory layer (run/trajectory history).
   * Stage 25.5 D44 — declared, enforcement deferred to Stage 27.
   */
  readonly episodic?: "read" | "read-write" | "none";
};

/**
 * Per-agent approval policy.
 *
 * @remarks Declared in Stage 25 to lock the shape. Enforcement deferred to
 *   Stage 27 when the controlled-write workflow is built end-to-end.
 *
 *   Today the framework's approval gate is at the tool level (via
 *   `ToolContract.runtimePolicy.requiresApproval`). Stage 27 extends it to
 *   agent-level approval gating.
 */
export type AgentApprovalPolicy = {
  /** When true, the agent's mutating operations require explicit approval. */
  readonly requiresApproval?: boolean;
};

/**
 * Per-agent retry policy (Stage 25.5 D36).
 *
 * Reserved error codes are NEVER retried regardless of `retryableErrorCodes`
 * inclusion — the framework's safety floor is not opt-out (D39). See
 * `runtime/src/feedback-loops/retry-loop.ts` for the hard-coded set.
 *
 * @umbrella Feedback Loops — in-run retry
 *
 * @example
 * const def: AgentDefinition = {
 *   id: "retrieval-resilient",
 *   role: "retrieval",
 *   retryPolicy: {
 *     maxAttempts: 3,
 *     backoffMs: 100,
 *     retryableErrorCodes: ["retrieval.embedding-failed", "llm.provider-unavailable"]
 *   }
 * };
 */
export type AgentRetryPolicy = {
  /** Total attempts. Default 1 (no retry) when policy is set. */
  readonly maxAttempts?: number;
  /** Backoff between attempts in milliseconds. Default 0 (no delay). */
  readonly backoffMs?: number;
  /**
   * Error codes that ARE retryable. ALLOWLIST — codes not listed are never
   * retried. Policy denials, budget refusals, and security gates are NEVER
   * retried regardless of inclusion (D39).
   */
  readonly retryableErrorCodes?: readonly string[];
};

/**
 * Full runtime configuration for one agent.
 *
 * Built at container construction time by `createAgentDefinitionRegistry()`
 * (Phase 02) from `AgentRuntimeConfig.agents` plus the framework's default
 * roles. Definitions are runtime-only — they are NOT part of the user-facing
 * `AgenticInfraProjectConfig` shape.
 *
 * Structurally an intersection of `AgentProfile` (identity) and seven policy
 * fields. Stage 25 enforces three of them at planning time:
 * `allowedTools`, `budgetPolicy`, `evalRules`. The remaining four
 * (`modelPolicy`, `retrievalPolicy`, `memoryPolicy`, `approvalPolicy`) are
 * declared but reserved for Stages 26/27.
 *
 * @example
 * // A security reviewer restricted to read-only retrieval tools, with a
 * // tight token budget and forbidden write/admin tools.
 * const def: AgentDefinition = {
 *   id: "security-strict",
 *   role: "security-reviewer",
 *   allowedTools: ["agentic.retrieval.search", "agentic.context.build"],
 *   budgetPolicy: { maxTokens: 2000 },
 *   evalRules: { forbiddenTools: ["agentic.write.propose"] }
 * };
 */
export type AgentDefinition = AgentProfile & {
  /**
   * Allowlist of tool ids the agent may select at planning time.
   *
   * Stage 25 semantics:
   *   - `undefined` → no per-agent restriction (existing role × category
   *     floor in `roleAllowsTool()` still applies)
   *   - `[]`        → empty allowlist — agent selects no tools
   *   - `[...]`     → intersect selected tools with this list
   *
   * Layered AFTER `roleAllowsTool()` in the harness, so an `allowedTools`
   * entry listing a write tool is still blocked by the role × category
   * floor. Defense in depth.
   */
  readonly allowedTools?: readonly string[];
  /** Per-agent token budget. See {@link AgentBudgetPolicy}. */
  readonly budgetPolicy?: AgentBudgetPolicy;
  /** Eval rules. See {@link AgentEvalRules}. */
  readonly evalRules?: AgentEvalRules;
  /** Model policy. Declared, enforcement deferred to Stage 26. */
  readonly modelPolicy?: AgentModelPolicy;
  /** Retrieval policy. Declared, enforcement deferred to Stage 26. */
  readonly retrievalPolicy?: AgentRetrievalPolicy;
  /** Response (output guard) policy. Stage 25.5 Phase 03. See {@link AgentResponsePolicy}. */
  readonly responsePolicy?: AgentResponsePolicy;
  /** Retry policy. Stage 25.5 Phase 04. See {@link AgentRetryPolicy}. */
  readonly retryPolicy?: AgentRetryPolicy;
  /** Memory policy. Declared, enforcement deferred to Stage 27. */
  readonly memoryPolicy?: AgentMemoryPolicy;
  /** Approval policy. Declared, enforcement deferred to Stage 27. */
  readonly approvalPolicy?: AgentApprovalPolicy;
};

/**
 * Read-only registry interface for `AgentDefinition` lookup.
 *
 * Consumers (executors, dashboard, future orchestrator) depend on this
 * interface. Mutation (`register`) lives only on the concrete
 * `InMemoryAgentDefinitionRegistry` class in runtime.
 *
 * Supersedes the legacy {@link AgentRegistry} interface, which returns
 * `AgentProfile` rather than `AgentDefinition` and has no implementations.
 *
 * `findByRole()` returns a LIST (not a single definition) because Stage 26
 * supports multiple specialists per role (e.g. two `security-reviewer`
 * agents with different scopes). The first match is a Stage 25 convention;
 * Stage 26's `SupervisorPolicy` picks among matches.
 */
export interface AgentDefinitionRegistry {
  /** Returns all registered definitions in insertion order. */
  list(): readonly AgentDefinition[];
  /** Looks up one definition by stable id. */
  findById(id: string): AgentDefinition | undefined;
  /** Returns all definitions matching a role, in insertion order. */
  findByRole(role: AgentRole): readonly AgentDefinition[];
  /** Returns the count of registered definitions. */
  count(): number;
}
