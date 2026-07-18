/** Runtime modes supported by the framework contracts. */
export const RUNTIME_MODES = [
  "local-stdio-mcp",
  "remote-http-mcp",
  "api-service"
] as const;

/** Runtime mode string literal. */
export type RuntimeMode = (typeof RUNTIME_MODES)[number];

/** Authentication policy required by remote-safe runtime surfaces. */
export type AuthPolicyConfig = {
  readonly required: boolean;
  readonly provider?: "project" | "external" | "custom";
  readonly policyRef?: string;
};

/** Authorization policy required by remote-safe runtime surfaces. */
export type AuthorizationPolicyConfig = {
  readonly required: boolean;
  readonly policyRef?: string;
};

/** Rate-limit policy required by remote-safe runtime surfaces. */
export type RateLimitPolicyConfig = {
  readonly required: boolean;
  readonly policyRef?: string;
  readonly maxRequestsPerMinute?: number;
};

/** Audit policy required by remote-safe runtime surfaces. */
export type RuntimeAuditPolicyConfig = {
  readonly enabled: boolean;
  readonly sink?: "safe-log" | "external" | "custom";
  readonly policyRef?: string;
};

/**
 * Local STDIO MCP runtime config.
 *
 * STDIO mode is intended for local tools and must not be exposed as a public
 * connector.
 */
export type LocalStdioMcpRuntimeConfig = {
  readonly enabled: boolean;
  readonly transport: "stdio";
  readonly allowLocalFilesystem?: boolean;
  readonly allowControlledWrites?: boolean;
  readonly allowShell?: boolean;
  readonly toolProfile?: string;
};

/**
 * Remote HTTPS MCP runtime config.
 *
 * Remote startup implementations must fail closed without auth, audit, and
 * rate-limit policies.
 */
export type RemoteHttpMcpRuntimeConfig = {
  readonly enabled: boolean;
  readonly transport: "https";
  readonly host?: string;
  readonly port?: number;
  readonly auth?: AuthPolicyConfig;
  readonly authorization?: AuthorizationPolicyConfig;
  readonly rateLimit?: RateLimitPolicyConfig;
  readonly audit?: RuntimeAuditPolicyConfig;
  readonly exposeLocalFilesystem?: boolean;
  readonly allowShell?: boolean;
  readonly toolProfile?: string;
};

/**
 * HTTP API service runtime config.
 */
export type ApiServiceRuntimeConfig = {
  readonly enabled: boolean;
  readonly transport: "https";
  readonly host?: string;
  readonly port?: number;
  readonly auth?: AuthPolicyConfig;
  readonly authorization?: AuthorizationPolicyConfig;
  readonly rateLimit?: RateLimitPolicyConfig;
  readonly audit?: RuntimeAuditPolicyConfig;
};

/**
 * Policy that constrains which runtime modes may be active.
 */
export type RuntimeModePolicy = {
  readonly defaultMode?: RuntimeMode;
  readonly allowedModes?: readonly RuntimeMode[];
  readonly remoteSafeRequired?: boolean;
};

/**
 * Complete runtime configuration for a project.
 */
export type RuntimeConfig = {
  readonly modes: readonly RuntimeMode[];
  readonly localStdioMcp?: LocalStdioMcpRuntimeConfig;
  readonly remoteHttpMcp?: RemoteHttpMcpRuntimeConfig;
  readonly apiService?: ApiServiceRuntimeConfig;
  readonly modePolicy?: RuntimeModePolicy;
};
