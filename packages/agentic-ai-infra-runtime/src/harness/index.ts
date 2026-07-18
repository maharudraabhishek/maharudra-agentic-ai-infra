import {
  DefaultRemoteSafeToolFilter,
  fail,
  ok,
  type AgentDefinitionRegistry,
  type AgentRole,
  type FrameworkResult,
  type PermissionDecision,
  type PermissionGate,
  type PermissionGateInput,
  type RefusalReason,
  type RuntimeMode,
  type SafeTaskMetadata,
  type SafeTrajectoryEvent,
  type ToolContract,
  type ToolExecutionContext,
  type ToolExecutionHandler,
  type ToolExecutionResult,
  type TokenUsageReport
} from "@maharudra/agentic-ai-infra-core";
import { RUN_AGENTIC_AI_INFRA_MIGRATIONS } from "../storage/migrations.js";

const SECRET_PATTERN = /(BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY|api[_-]?key|secret|password\s*[=:]|bearer\s+[a-z0-9._-]+)/i;
const REMOTE_ABSOLUTE_PATH_PATTERN = /[A-Za-z]:\\|(?:^|["'\s])\/(?:Users|home|var|etc|tmp)\//;
const UNSAFE_FIELD_NAMES = new Set([
  "approvalText",
  "rawApprovalText",
  "secret",
  "apiKey",
  "password",
  "privateKey",
  "token",
  "vector",
  "embedding",
  "rawSql",
  "sql",
  "stack",
  "stackTrace",
  "commandOutput",
  "rawFile",
  "rawFiles",
  "fullChunk",
  "fullChunks",
  "rawTaskText",
  "taskText",
  "task"
]);

/**
 * Safe token recorder interface used by the harness without depending on one
 * concrete storage implementation.
 */
export interface HarnessTokenRecorder {
  /** Records token usage with safe task metadata only. */
  recordUsage(record: {
    readonly traceId: string;
    readonly runId: string;
    readonly scope: "tool" | "agent" | "shared-context" | "synthesis";
    readonly task?: SafeTaskMetadata;
    readonly toolName?: string;
    readonly agentRole?: AgentRole;
    readonly usage: TokenUsageReport;
  }): void;
}

/**
 * Safe trajectory recorder interface consumed by the harness.
 */
export interface HarnessTrajectoryRecorder {
  /** Persists one sanitized trajectory step. */
  recordStep(event: SafeTrajectoryEvent): void;
}

/**
 * Input accepted by `AgentHarness.executeTool`.
 */
export type AgentHarnessToolInput = {
  readonly toolId: string;
  readonly input?: unknown;
  readonly runtimeMode: RuntimeMode;
  readonly traceId?: string;
  readonly runId?: string;
  readonly agentRole?: AgentRole;
  /**
   * Stable id of the calling agent. When present and the default gate has a
   * matching registry entry, agent-level approval and allowed-tool policies are
   * enforced at execution time. When absent, Stage 25.5 permission behavior is
   * preserved.
   */
  readonly agentId?: string;
  readonly task?: SafeTaskMetadata;
  /**
   * Exact approval text is accepted only as transient input for policy checks.
   * It is never passed to recorders, logs, token reports, or dashboard data.
   */
  readonly approvalText?: string;
};

/**
 * Sanitizes tool output before any value reaches recorders or runtime callers.
 */
export class SafeOutputSanitizer {
  /**
   * Removes unsafe fields and redacts unsafe string values recursively.
   */
  sanitize(params: {
    readonly output: unknown;
    readonly runtimeMode: RuntimeMode;
    readonly maxBytes?: number;
  }): FrameworkResult<unknown> {
    const sanitized = this.redact(params.output, params.runtimeMode);
    const serialized = JSON.stringify(sanitized);

    if (serialized.length > (params.maxBytes ?? 65536)) {
      return fail({
        code: "output.unsafe",
        message: "Tool output exceeded the configured output size.",
        severity: "recoverable"
      });
    }

    return ok(sanitized);
  }

  /**
   * Recursively redacts unsafe fields and values.
   */
  private redact(value: unknown, runtimeMode: RuntimeMode): unknown {
    if (typeof value === "string") {
      if (SECRET_PATTERN.test(value)) {
        return "[redacted]";
      }

      if (
        (runtimeMode === "remote-http-mcp" || runtimeMode === "api-service") &&
        REMOTE_ABSOLUTE_PATH_PATTERN.test(value)
      ) {
        return "[redacted-local-path]";
      }

      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.redact(item, runtimeMode));
    }

    if (typeof value !== "object" || value === null) {
      return value;
    }

    const safe: Record<string, unknown> = {};

    for (const [key, nested] of Object.entries(value)) {
      if (UNSAFE_FIELD_NAMES.has(key)) {
        continue;
      }

      safe[key] = this.redact(nested, runtimeMode);
    }

    return safe;
  }
}

/**
 * Runtime permission gate that enforces mode, remote-safety, and tool-risk
 * metadata before a handler can run.
 */
export class DefaultPermissionGate implements PermissionGate {
  /**
   * Creates a permission gate with optional access to agent definitions.
   *
   * Without a registry, agent-level approval and allowlist checks are inert so
   * legacy callers keep the Stage 25.5 behavior.
   */
  constructor(private readonly agentRegistry?: AgentDefinitionRegistry) {}

  /**
   * Decides whether one tool can execute in the selected runtime mode.
   */
  decide(input: PermissionGateInput): PermissionDecision {
    const { runtimeMode, tool } = input;
    const agentDefinition =
      input.agentId && this.agentRegistry
        ? this.agentRegistry.findById(input.agentId)
        : undefined;

    if (!tool.runtimePolicy.allowedModes?.includes(runtimeMode)) {
      return {
        allowed: false,
        reason: `Tool "${tool.id}" is not allowed in ${runtimeMode}.`,
        refusalReason: "mode-not-allowed" satisfies RefusalReason
      };
    }

    if (tool.runtimePolicy.networkAccess) {
      return {
        allowed: false,
        reason: "Network-capable tools are disabled for deterministic runtime execution.",
        refusalReason: "network-blocked" satisfies RefusalReason
      };
    }

    if (tool.runtimePolicy.shellAccess || tool.category === "command") {
      return {
        allowed: false,
        reason: "Shell and command tools are not available in this runtime.",
        refusalReason: "shell-blocked" satisfies RefusalReason
      };
    }

    if (tool.runtimePolicy.arbitrarySqlAccess) {
      return {
        allowed: false,
        reason: "Arbitrary SQL tools are not available in this runtime.",
        refusalReason: "arbitrary-sql-blocked" satisfies RefusalReason
      };
    }

    if (input.agentRole && !roleAllowsTool(input.agentRole, tool)) {
      return {
        allowed: false,
        reason: `Agent role "${input.agentRole}" cannot use tool "${tool.id}".`,
        refusalReason: "role-floor" satisfies RefusalReason
      };
    }

    if (runtimeMode === "remote-http-mcp" || runtimeMode === "api-service") {
      if (!new DefaultRemoteSafeToolFilter().isRemoteSafe(tool)) {
        return {
          allowed: false,
          reason: `Tool "${tool.id}" is not remote-safe.`,
          refusalReason: "remote-safe" satisfies RefusalReason
        };
      }
    }
    // Execution-time allowlist enforcement is the safety net beneath the
    // executor's planning-time filter. It only narrows access when a concrete
    // agent definition is available.
    if (
      input.agentId &&
      agentDefinition?.allowedTools &&
      !agentDefinition.allowedTools.includes(tool.id)
    ) {
      return {
        allowed: false,
        reason: `Tool "${tool.id}" is not in agent "${input.agentId}" allowedTools.`,
        refusalReason: "agent-allowlist" satisfies RefusalReason
      };
    }

    // Preserve agent-level approval intent without denying before the caller
    // can present exact transient approval. The harness consumes this marker
    // only after every mode, capability, role, and allowlist denial has passed.
    if (
      agentDefinition?.approvalPolicy?.requiresApproval === true &&
      new DefaultApprovalPolicy().requiresApproval(tool)
    ) {
      return {
        allowed: true,
        reason: "Tool is allowed by runtime policy and requires exact agent approval.",
        requiredApproval: {
          mode: "explicit-approval",
          exactApprovalRequired: true
        }
      };
    }

    return {
      allowed: true,
      reason: "Tool is allowed by runtime policy."
    };
  }
}

/**
 * Applies role-specific tool permissions before central tool execution.
 */
function roleAllowsTool(role: AgentRole, tool: ToolContract): boolean {
  const category = tool.category;

  if (category === "command" || category === "admin") {
    return false;
  }

  // The manager is the sole role that may reach the exact-approval gate for
  // controlled writes. All other roles remain fail-closed at the role floor.
  if (category === "write") {
    return role === "manager";
  }

  switch (role) {
    case "security-reviewer":
      return ["business-safe", "context", "eval", "observability", "retrieval"].includes(category);
    case "architecture-reviewer":
      return ["business-safe", "context", "observability", "retrieval", "read"].includes(category);
    case "implementation-planner":
      return ["business-safe", "context", "retrieval", "read"].includes(category);
    case "eval-reviewer":
      return ["business-safe", "context", "eval", "observability"].includes(category);
    case "docs-reviewer":
      return ["business-safe", "context", "retrieval", "read"].includes(category);
    default:
      return true;
  }
}

/**
 * Result of exact approval policy evaluation.
 */
export type ApprovalCheckResult = {
  readonly required: boolean;
  readonly approvalMatched: boolean;
  readonly policyId: string;
};

/**
 * Exact approval policy for mutating or sensitive tools.
 */
export class DefaultApprovalPolicy {
  /**
   * Checks transient approval text without storing or logging the text.
   *
   * `forceRequired` carries an already-authorized agent-level approval policy
   * into the same exact-match check used by tool policy. It never bypasses the
   * permission gate and never changes the expected approval text.
   *
   * @param tool - Canonical tool contract used to derive the safe policy id and exact text.
   * @param approvalText - Ephemeral caller text; never persisted or returned.
   * @param forceRequired - Whether an agent policy requires exact approval in addition to tool policy.
   * @returns Approval metadata or `runtime.approval-required` without exposing the supplied text.
   */
  check(
    tool: ToolContract,
    approvalText?: string,
    forceRequired = false
  ): FrameworkResult<ApprovalCheckResult> {
    const required = forceRequired || this.requiresApproval(tool);
    const policyId = this.policyId(tool);

    if (!required) {
      return ok({ required, approvalMatched: true, policyId });
    }

    const expected = this.expectedApprovalText(tool);
    const approvalMatched = approvalText === expected;

    if (!approvalMatched) {
      return fail({
        code: "runtime.approval-required",
        message: "Tool execution requires exact approval.",
        severity: "recoverable"
      });
    }

    return ok({ required, approvalMatched, policyId });
  }

  /**
   * Determines whether a tool needs explicit approval.
   */
  requiresApproval(tool: ToolContract): boolean {
    return Boolean(
      tool.runtimePolicy.requiresApproval ||
        tool.runtimePolicy.mutatesState ||
        tool.runtimePolicy.migrationAccess ||
        tool.category === "write" ||
        tool.category === "admin" ||
        tool.riskLevel === "high" ||
        tool.riskLevel === "critical"
    );
  }

  /**
   * Selects the exact approval text expected by the policy.
   */
  private expectedApprovalText(tool: ToolContract): string {
    if (tool.runtimePolicy.migrationAccess || tool.id.includes("migration")) {
      return RUN_AGENTIC_AI_INFRA_MIGRATIONS;
    }

    return `APPROVE_${tool.id}`;
  }

  /**
   * Builds a safe policy id for records and dashboard summaries.
   */
  private defaultPolicyId(tool: ToolContract): string {
    return tool.runtimePolicy.migrationAccess || tool.id.includes("migration")
      ? "framework-migration-approval"
      : "tool-exact-approval";
  }

  /**
   * Returns a bounded, non-sensitive identifier for approval observability.
   *
   * @param tool - Tool whose configured policy id may cross a record boundary.
   * @returns The configured lowercase identifier when safe, otherwise a framework fallback.
   */
  policyId(tool: ToolContract): string {
    const configured = tool.runtimePolicy.approvalPolicyId;

    if (
      !configured ||
      !/^[a-z][a-z0-9.-]{0,63}$/.test(configured) ||
      /(?:approve|secret|password|credential|private|api[-.]?key|token)/i.test(configured)
    ) {
      return this.defaultPolicyId(tool);
    }

    return configured;
  }
}

/**
 * Central runtime harness that sits between adapters and tool handlers.
 */
export class AgentHarness {
  private readonly handlers = new Map<string, ToolExecutionHandler>();
  private readonly toolsById = new Map<string, ToolContract>();

  /**
   * Creates a harness with immutable tool contracts and injected handlers.
   */
  constructor(
    params: {
      readonly tools: readonly ToolContract[];
      readonly handlers?: ReadonlyMap<string, ToolExecutionHandler> | Record<string, ToolExecutionHandler>;
      readonly permissionGate?: PermissionGate;
      readonly approvalPolicy?: DefaultApprovalPolicy;
      /**
       * Optional agent registry used only by the default permission gate.
       * Custom gates receive `AgentHarnessToolInput.agentId` through
       * `PermissionGateInput` and remain responsible for their own lookups.
       */
      readonly agentRegistry?: AgentDefinitionRegistry;
      readonly sanitizer?: SafeOutputSanitizer;
      readonly trajectoryRecorder?: HarnessTrajectoryRecorder;
      readonly tokenRecorder?: HarnessTokenRecorder;
    }
  ) {
    for (const tool of params.tools) {
      this.toolsById.set(tool.id, tool);
    }

    if (params.handlers instanceof Map) {
      for (const [id, handler] of params.handlers.entries()) {
        this.handlers.set(id, handler);
      }
    } else {
      for (const [id, handler] of Object.entries(params.handlers ?? {})) {
        this.handlers.set(id, handler);
      }
    }

    this.permissionGate = params.permissionGate ?? new DefaultPermissionGate(params.agentRegistry);
    this.approvalPolicy = params.approvalPolicy ?? new DefaultApprovalPolicy();
    this.sanitizer = params.sanitizer ?? new SafeOutputSanitizer();
    this.trajectoryRecorder = params.trajectoryRecorder;
    this.tokenRecorder = params.tokenRecorder;
  }

  private readonly permissionGate: PermissionGate;
  private readonly approvalPolicy: DefaultApprovalPolicy;
  private readonly sanitizer: SafeOutputSanitizer;
  private readonly trajectoryRecorder?: HarnessTrajectoryRecorder;
  private readonly tokenRecorder?: HarnessTokenRecorder;

  /**
   * Executes one tool through runtime, approval, output, token, and trajectory
   * controls.
   */
  async executeTool(input: AgentHarnessToolInput): Promise<FrameworkResult<ToolExecutionResult>> {
    const traceId = input.traceId ?? `trace-${Date.now()}`;
    const runId = input.runId ?? `run-${Date.now()}`;
    const startedAt = Date.now();
    const tool = this.toolsById.get(input.toolId);

    if (!tool) {
      this.record({
        traceId,
        runId,
        agentRole: input.agentRole,
        stepType: "tool",
        toolName: input.toolId,
        status: "error",
        durationMs: 0,
        taskHash: input.task?.taskHash,
        taskType: input.task?.taskType,
        errorCode: "runtime.tool-not-found"
      });

      return fail({
        code: "runtime.tool-not-found",
        message: `Tool "${input.toolId}" is not registered.`,
        severity: "recoverable"
      });
    }

    const permission = this.permissionGate.decide({
      runtimeMode: input.runtimeMode,
      tool,
      requestedCapability: tool.category,
      agentRole: input.agentRole,
      agentId: input.agentId
    });

    if (!permission.allowed) {
      this.record({
        traceId,
        runId,
        agentRole: input.agentRole,
        stepType: "permission",
        toolName: tool.id,
        status: "denied",
        durationMs: Date.now() - startedAt,
        taskHash: input.task?.taskHash,
        taskType: input.task?.taskType,
        errorCode: "runtime.permission-denied"
      });

      return fail({
        code: "runtime.permission-denied",
        message: permission.reason,
        severity: "recoverable",
        ...(permission.refusalReason
          ? { refusalReason: permission.refusalReason }
          : {})
      });
    }

    const approval = this.approvalPolicy.check(
      tool,
      input.approvalText,
      permission.requiredApproval !== undefined
    );

    if (!approval.ok) {
      this.record({
        traceId,
        runId,
        agentRole: input.agentRole,
        stepType: "approval",
        toolName: tool.id,
        status: "denied",
        durationMs: Date.now() - startedAt,
        taskHash: input.task?.taskHash,
        taskType: input.task?.taskType,
        errorCode: approval.error.code,
        metadata: {
          approvalMatched: false,
          policyId: this.approvalPolicy.policyId(tool)
        }
      });

      return fail({
        ...approval.error,
        refusalReason: "approval-required"
      });
    }

    const handler = this.handlers.get(tool.id);

    if (!handler) {
      return fail({
        code: "runtime.tool-not-found",
        message: `Tool "${tool.id}" has no execution handler.`,
        severity: "recoverable"
      });
    }

    try {
      const result = await handler(input.input, {
        runtimeMode: input.runtimeMode,
        traceId,
        runId,
        tool,
        agentRole: input.agentRole,
        task: input.task,
        approvalMatched: approval.value.approvalMatched,
        startedAt: new Date(startedAt).toISOString()
      } satisfies ToolExecutionContext);

      if (!result.ok) {
        this.record({
          traceId,
          runId,
          agentRole: input.agentRole,
          stepType: "tool",
          toolName: tool.id,
          status: "error",
          durationMs: Date.now() - startedAt,
          taskHash: input.task?.taskHash,
          taskType: input.task?.taskType,
          errorCode: result.error.code
        });

        return result;
      }

      const sanitized = this.sanitizer.sanitize({
        output: result.value.output,
        runtimeMode: input.runtimeMode,
        maxBytes: tool.outputPolicy.maxBytes
      });

      if (!sanitized.ok) {
        this.record({
          traceId,
          runId,
          agentRole: input.agentRole,
          stepType: "sanitize",
          toolName: tool.id,
          status: "error",
          durationMs: Date.now() - startedAt,
          taskHash: input.task?.taskHash,
          taskType: input.task?.taskType,
          errorCode: sanitized.error.code
        });

        return sanitized;
      }

      const safeResult: ToolExecutionResult = {
        ...result.value,
        output: sanitized.value
      };

      this.record({
        traceId,
        runId,
        agentRole: input.agentRole,
        stepType: "tool",
        toolName: tool.id,
        status: "completed",
        durationMs: Date.now() - startedAt,
        taskHash: input.task?.taskHash,
        taskType: input.task?.taskType,
        tokenEstimate: safeResult.tokenUsage?.totalTokens,
        metadata: {
          approvalMatched: approval.value.approvalMatched,
          policyId: approval.value.policyId
        }
      });

      if (safeResult.tokenUsage) {
        this.tokenRecorder?.recordUsage({
          traceId,
          runId,
          scope: "tool",
          task: input.task,
          toolName: tool.id,
          agentRole: input.agentRole,
          usage: safeResult.tokenUsage
        });
      }

      return ok(safeResult);
    } catch {
      this.record({
        traceId,
        runId,
        agentRole: input.agentRole,
        stepType: "tool",
        toolName: tool.id,
        status: "error",
        durationMs: Date.now() - startedAt,
        taskHash: input.task?.taskHash,
        taskType: input.task?.taskType,
        errorCode: "runtime.tool-execution-failed"
      });

      return fail({
        code: "runtime.tool-execution-failed",
        message: `Tool "${tool.id}" failed without exposing raw error details.`,
        severity: "recoverable"
      });
    }
  }

  /**
   * Records safe trajectory metadata when a recorder is configured.
   */
  private record(event: SafeTrajectoryEvent): void {
    this.trajectoryRecorder?.recordStep(event);
  }
}

export * from "./eval-harness.js";
