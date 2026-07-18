import type { RuntimeMode } from "../runtime/types.js";

/** Tool category used for safety and routing decisions. */
export type ToolCategory =
  | "read"
  | "write"
  | "command"
  | "retrieval"
  | "context"
  | "observability"
  | "eval"
  | "admin"
  | "business-safe";

/** Risk level assigned to a tool contract. */
export type ToolRiskLevel = "low" | "medium" | "high" | "critical";

/**
 * Output policy that describes whether a tool can be safely exposed remotely.
 */
export type ToolOutputPolicy = {
  readonly remoteSafe: boolean;
  readonly maxBytes?: number;
  readonly returnsSecrets?: false;
  readonly returnsRawFiles?: boolean;
  readonly returnsVectors?: boolean;
  readonly returnsRawSql?: boolean;
  readonly returnsStackTraces?: boolean;
  readonly returnsCommandOutput?: boolean;
  readonly returnsLocalPaths?: boolean;
};

/**
 * Runtime policy that describes where and how a tool may execute.
 */
export type ToolRuntimePolicy = {
  readonly allowedModes: readonly RuntimeMode[];
  readonly remoteSafe?: boolean;
  readonly requiresApproval?: boolean;
  readonly approvalPolicyId?: string;
  readonly mutatesState?: boolean;
  readonly localFilesystem?: boolean;
  readonly shellAccess?: boolean;
  readonly networkAccess?: boolean;
  readonly migrationAccess?: boolean;
  readonly arbitrarySqlAccess?: boolean;
};

/**
 * Metadata contract for one framework or project tool.
 */
export type ToolContract = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: ToolCategory;
  readonly riskLevel: ToolRiskLevel;
  readonly inputSchema?: unknown;
  readonly outputPolicy: ToolOutputPolicy;
  readonly runtimePolicy: ToolRuntimePolicy;
};

/**
 * Registry interface for immutable tool contracts.
 */
export interface ToolContractRegistry {
  /** Lists all registered tools. */
  list(): readonly ToolContract[];
  /** Finds a tool by stable id. */
  findById(id: string): ToolContract | undefined;
  /** Returns a registry containing the additional tool contract. */
  register(tool: ToolContract): ToolContractRegistry;
}
