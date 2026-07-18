import type { RuntimeMode } from "../runtime/types.js";
import type { AgentRole } from "../agents/types.js";
import type { ToolContract } from "../tools/types.js";

/** Approval policy for write-like or sensitive operations. */
export type ApprovalPolicy = {
  readonly mode: "none" | "proposal" | "explicit-approval";
  readonly exactApprovalRequired?: boolean;
  readonly approvalTokenPattern?: string;
};

/**
 * Closed taxonomy of refusal reasons emitted by `PermissionGate`
 * implementations (Stage 25.5 D35).
 *
 * Distinct from the free-form `reason: string` — this is the typed code
 * suitable for metrics, retry decisions, and over/under-refusal monitoring.
 *
 * @umbrella Guardrails
 */
export type RefusalReason =
  | "role-floor"            // roleAllowsTool denied
  | "remote-safe"           // tool not remote-safe in remote modes
  | "shell-blocked"         // shell/command tool blocked
  | "network-blocked"       // network-capable tool blocked
  | "arbitrary-sql-blocked" // arbitrary SQL blocked
  | "mode-not-allowed"      // tool not in allowedModes
  | "approval-required"     // approval missing (ApprovalPolicy)
  | "agent-allowlist";      // Stage 25 allowedTools filter (planning-time)

/** Decision returned by a permission gate. */
export type PermissionDecision = {
  readonly allowed: boolean;
  readonly reason: string;
  readonly requiredApproval?: ApprovalPolicy;
  /**
   * Typed refusal code (Stage 25.5 D35). Populated when `allowed: false`.
   * Undefined when `allowed: true` or when a custom gate hasn't migrated
   * to the taxonomy yet.
   *
   * @guardrail
   */
  readonly refusalReason?: RefusalReason;
};

/** Input used to evaluate whether a tool capability is allowed. */
export type PermissionGateInput = {
  readonly runtimeMode: RuntimeMode;
  readonly tool: ToolContract;
  readonly requestedCapability: string;
  readonly agentRole?: AgentRole;
  /**
   * Stable id of the calling agent.
   *
   * Permission gates use this only when they have access to an agent-definition
   * registry. When absent, or when the gate has no registry, decisions remain
   * scoped to runtime mode, tool policy, and role floors.
   */
  readonly agentId?: string;
};

/** Interface for runtime permission gates. */
export interface PermissionGate {
  /** Decides whether the requested capability is allowed. */
  decide(input: PermissionGateInput): PermissionDecision;
}

/** Prompt-injection defense settings for retrieved context. */
export type PromptInjectionDefenseConfig = {
  readonly enabled: boolean;
  readonly retrievedContentIsEvidence?: boolean;
  readonly precedence?: readonly string[];
  readonly warnOnUntrustedContent?: boolean;
};

/** Project security configuration. */
export type SecurityConfig = {
  readonly minimumPolicy?: "strict" | "standard" | "relaxed";
  readonly allowedPaths?: readonly string[];
  readonly blockedPaths?: readonly string[];
  readonly allowPathTraversal?: boolean;
  readonly allowSecretPaths?: boolean;
  readonly allowLocalFilesystemInRemote?: boolean;
  readonly allowShellInRemote?: boolean;
  readonly approvalPolicy?: ApprovalPolicy;
  readonly promptInjectionDefense?: PromptInjectionDefenseConfig;
};

/** Interface for filtering tools before remote registration. */
export interface RemoteSafeToolFilter {
  /** Returns true when a tool is safe for remote exposure. */
  isRemoteSafe(tool: ToolContract): boolean;
  /** Filters a list of tools to the remote-safe subset. */
  filter(tools: readonly ToolContract[]): readonly ToolContract[];
}
