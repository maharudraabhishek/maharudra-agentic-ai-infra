import type {
  AgenticInfraProjectConfig,
  ExtensionProviderConfig,
  ResolvedProjectConfig
} from "./types.js";
import {
  type FrameworkResult,
  type ValidationIssue,
  fail,
  ok,
  validationFailure,
  validationIssue
} from "../errors/index.js";
import { RETRIEVAL_PROVIDER_TYPES } from "../retrieval/types.js";
import { RUNTIME_MODES, type RuntimeMode } from "../runtime/types.js";
import { isRemoteSafeTool } from "../security/remote-safe.js";
import type { StorageProviderConfig } from "../storage/types.js";
import type { TokenBudgetPolicy } from "../token/types.js";
import type { ToolContract } from "../tools/types.js";
import { DefaultProfileResolver } from "../profiles/resolver.js";
import type { ProfileResolver } from "../profiles/types.js";

export interface ConfigValidator {
  validate(config: AgenticInfraProjectConfig): FrameworkResult<ResolvedProjectConfig>;
}

const PROJECT_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-zA-Z]:[\\/]/;
const SECRET_PATH_PATTERNS = [
  /^\.env(?:\.|$)/,
  /^\.npmrc$/,
  /(?:^|\/)(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)$/,
  /(?:^|\/).*private.*key/i,
  /(?:^|\/).*credential.*/i,
  /(?:^|\/).*token.*/i
];

/**
 * Checks whether a resolved config enables a runtime mode.
 */
function hasMode(config: ResolvedProjectConfig, mode: RuntimeMode): boolean {
  return config.runtime.modes.includes(mode);
}

/**
 * Adds a normalized validation issue to the mutable collection used during a
 * validation pass.
 */
function addIssue(
  issues: ValidationIssue[],
  params: Parameters<typeof validationIssue>[0]
): void {
  issues.push(validationIssue(params));
}

/**
 * Validates TCP port ranges used by runtime and dashboard surfaces.
 */
function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port > 0 && port <= 65535;
}

/**
 * Normalizes policy path separators so Windows and POSIX user input share the
 * same validation rules.
 */
function normalizePolicyPath(pathValue: string): string {
  return pathValue.replaceAll("\\", "/").trim();
}

/**
 * Detects path patterns that are likely to expose secrets or credentials.
 */
function isSecretPath(pathValue: string): boolean {
  return SECRET_PATH_PATTERNS.some((pattern) => pattern.test(pathValue));
}

/**
 * Validates one path policy entry.
 */
function validatePolicyPath(params: {
  pathValue: unknown;
  configPath: string;
  allowsSecretPattern: boolean;
  issues: ValidationIssue[];
}): void {
  const { pathValue, configPath, allowsSecretPattern, issues } = params;

  // Trust-boundary config must be typed before any string rules are applied.
  if (typeof pathValue !== "string") {
    addIssue(issues, {
      path: configPath,
      code: "config.invalid-path",
      message: "Path policy entries must be strings."
    });
    return;
  }

  const normalized = normalizePolicyPath(pathValue);

  // Empty allow/block entries usually mean a mistaken config edit.
  if (!normalized) {
    addIssue(issues, {
      path: configPath,
      code: "config.invalid-path",
      message: "Path policy entries cannot be empty."
    });
    return;
  }

  // Generated project contracts use project-relative paths only.
  if (
    normalized.startsWith("/") ||
    normalized.startsWith("//") ||
    WINDOWS_ABSOLUTE_PATH_PATTERN.test(pathValue)
  ) {
    addIssue(issues, {
      path: configPath,
      code: "config.invalid-path",
      message: `Path "${pathValue}" must be project-relative.`
    });
  }

  const pathParts = normalized.split("/").filter(Boolean);

  // Path traversal is blocked before runtime code ever sees the path.
  if (pathParts.includes("..")) {
    addIssue(issues, {
      path: configPath,
      code: "config.invalid-path",
      message: `Path "${pathValue}" cannot contain traversal segments.`
    });
  }

  // Allow lists cannot include secret-looking paths. Block lists may include
  // those patterns because blocking secrets is expected.
  if (!allowsSecretPattern && isSecretPath(normalized)) {
    addIssue(issues, {
      path: configPath,
      code: "config.invalid-path",
      message: `Path "${pathValue}" cannot allow secret or credential files.`,
      severity: "fatal"
    });
  }
}

/**
 * Validates global and role-specific token budgets.
 */
function validateTokenBudget(
  tokenBudget: TokenBudgetPolicy | undefined,
  issues: ValidationIssue[],
  path = "tokenEfficiency.tokenBudget"
): void {
  if (!tokenBudget) {
    return;
  }

  const numericEntries: readonly [keyof TokenBudgetPolicy, number | undefined][] = [
    ["maxTotalTokens", tokenBudget.maxTotalTokens],
    ["maxContextTokens", tokenBudget.maxContextTokens],
    ["maxResponseTokens", tokenBudget.maxResponseTokens],
    ["reserveTokens", tokenBudget.reserveTokens]
  ];

  for (const [key, value] of numericEntries) {
    // Budgets must be positive integers so downstream context builders can make
    // deterministic comparisons.
    if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
      addIssue(issues, {
        path: `${path}.${String(key)}`,
        code: "config.invalid-token-budget",
        message: `${String(key)} must be a positive integer.`
      });
    }
  }

  if (tokenBudget.maxContextTokens > tokenBudget.maxTotalTokens) {
    addIssue(issues, {
      path: `${path}.maxContextTokens`,
      code: "config.invalid-token-budget",
      message: "maxContextTokens cannot exceed maxTotalTokens."
    });
  }

  if (
    tokenBudget.maxResponseTokens !== undefined &&
    tokenBudget.maxResponseTokens > tokenBudget.maxTotalTokens
  ) {
    addIssue(issues, {
      path: `${path}.maxResponseTokens`,
      code: "config.invalid-token-budget",
      message: "maxResponseTokens cannot exceed maxTotalTokens."
    });
  }

  for (const [role, budget] of Object.entries(tokenBudget.roleBudgets ?? {})) {
    if (!Number.isInteger(budget) || budget <= 0) {
      addIssue(issues, {
        path: `${path}.roleBudgets.${role}`,
        code: "config.invalid-token-budget",
        message: "Role token budgets must be positive integers."
      });
    }
  }
}

/**
 * Collects and checks ports while detecting duplicates across surfaces.
 */
function collectPort(
  ports: Map<number, string>,
  issues: ValidationIssue[],
  port: number | undefined,
  path: string
): void {
  if (port === undefined) {
    return;
  }

  // Validate range before duplicate checks so invalid values receive the more
  // useful error message.
  if (!isValidPort(port)) {
    addIssue(issues, {
      path,
      code: "config.invalid-port",
      message: `${path} must be an integer between 1 and 65535.`
    });
    return;
  }

  const existingPath = ports.get(port);

  if (existingPath) {
    addIssue(issues, {
      path,
      code: "config.duplicate-port",
      message: `${path} conflicts with ${existingPath} on port ${port}.`
    });
    return;
  }

  ports.set(port, path);
}

/**
 * Validates extension provider metadata required for custom implementations.
 */
function validateExtensionProvider(
  extension: ExtensionProviderConfig,
  issues: ValidationIssue[],
  path: string
): void {
  if (!extension.id || !extension.kind || extension.capabilities.length === 0) {
    addIssue(issues, {
      path,
      code: "config.invalid-extension-provider",
      message: "Extension providers require an id, kind, and at least one capability."
    });
  }

  if (!extension.safetyPolicyRef) {
    addIssue(issues, {
      path,
      code: "config.invalid-extension-provider",
      message: "Extension providers must reference a safety policy."
    });
  }
}

/**
 * Adds validation issues when ids repeat inside a config list.
 */
function validateDuplicateIds(
  ids: readonly string[],
  issues: ValidationIssue[],
  path: string
): void {
  const seen = new Set<string>();

  for (const id of ids) {
    // Duplicate ids make provider/tool routing ambiguous, so detect them during
    // config validation rather than later runtime composition.
    if (seen.has(id)) {
      addIssue(issues, {
        path,
        code: "config.duplicate-id",
        message: `Duplicate id "${id}" is not allowed.`
      });
    }

    seen.add(id);
  }
}

/**
 * Ensures any tool allowed on remote HTTP MCP satisfies remote-safe policy.
 */
function validateRemoteToolSafety(
  tools: readonly ToolContract[],
  issues: ValidationIssue[]
): void {
  for (const [index, tool] of tools.entries()) {
    const allowedRemote = tool.runtimePolicy.allowedModes.includes("remote-http-mcp");

    // A tool can mention remote mode only when the full remote-safe predicate
    // accepts its risk, runtime, and output policies.
    if (allowedRemote && !isRemoteSafeTool(tool)) {
      addIssue(issues, {
        path: `tools.${index}`,
        code: "config.unsafe-remote-tool",
        message: `Tool "${tool.id}" is not safe for the remote HTTPS MCP surface.`,
        severity: "fatal"
      });
    }
  }
}

/**
 * Validates storage and retrieval provider relationships.
 */
function validateStorageReferences(
  config: ResolvedProjectConfig,
  issues: ValidationIssue[]
): void {
  const storageProviders = new Map<string, StorageProviderConfig>();

  for (const [index, provider] of config.storage.providers.entries()) {
    // Build an id lookup before validating retrieval references.
    storageProviders.set(provider.id, provider);

    // FilesystemStorageProvider is not yet implemented. Reject it early so
    // runtime composition never silently falls back to an absent implementation.
    if (provider.type === "filesystem") {
      addIssue(issues, {
        path: `storage.providers.${index}.type`,
        code: "config.filesystem-storage-not-implemented",
        message:
          `Storage provider "${provider.id}" uses type "filesystem", which is not yet implemented. ` +
          `Use "postgres" for knowledge storage or "memory" for ephemeral in-process storage.`,
        severity: "fatal"
      });
    }
  }

  validateDuplicateIds(
    config.storage.providers.map((provider) => provider.id),
    issues,
    "storage.providers"
  );

  if (config.retrieval.enabled && config.storage.providers.length === 0) {
    addIssue(issues, {
      path: "storage.providers",
      code: "config.retrieval-storage-required",
      message: "Retrieval requires at least one storage provider."
    });
  }

  validateDuplicateIds(
    config.retrieval.providers.map((provider) => provider.id),
    issues,
    "retrieval.providers"
  );

  const builtInTypes = new Set<string>(RETRIEVAL_PROVIDER_TYPES);

  for (const [index, provider] of config.retrieval.providers.entries()) {
    if (!provider.enabled) {
      continue;
    }

    // Custom providers must carry explicit extension metadata because core does
    // not know their concrete safety behavior.
    if (!builtInTypes.has(provider.type)) {
      if (
        provider.extension !== true ||
        !provider.id ||
        !provider.capabilities?.length ||
        !provider.safetyPolicy
      ) {
        addIssue(issues, {
          path: `retrieval.providers.${index}`,
          code: "config.invalid-extension-provider",
          message: "Custom retrieval providers must declare extension metadata and a safety policy."
        });
      }
    }

    // Provider-to-storage references are checked here so runtime composition can
    // assume resolved configs are internally consistent.
    if (provider.storageProviderId && !storageProviders.has(provider.storageProviderId)) {
      addIssue(issues, {
        path: `retrieval.providers.${index}.storageProviderId`,
        code: "config.retrieval-storage-required",
        message: `Storage provider "${provider.storageProviderId}" is not configured.`
      });
    }

    if (provider.type === "pgvector") {
      const storageProvider = provider.storageProviderId
        ? storageProviders.get(provider.storageProviderId)
        : undefined;

      // Pgvector requires Postgres because vector columns are a Postgres
      // extension surface, not filesystem storage.
      if (!storageProvider || storageProvider.type !== "postgres") {
        addIssue(issues, {
          path: `retrieval.providers.${index}`,
          code: "config.pgvector-postgres-required",
          message: "pgvector retrieval requires a Postgres storage provider."
        });
      }
    }
  }
}

/**
 * Default config validator for project configs after profile resolution.
 */
export class DefaultConfigValidator implements ConfigValidator {
  /**
   * Creates a validator with the default profile resolver or a test-supplied
   * resolver.
   */
  constructor(private readonly resolver: ProfileResolver = new DefaultProfileResolver()) {}

  /**
   * Resolves profiles, validates trust boundaries, and returns a fully resolved
   * project config or typed validation failures.
   */
  validate(config: AgenticInfraProjectConfig): FrameworkResult<ResolvedProjectConfig> {
    const resolvedResult = this.resolver.resolve(config);

    if (!resolvedResult.ok) {
      return resolvedResult;
    }

    const resolved = resolvedResult.value;
    const issues: ValidationIssue[] = [];

    // Project identity is required so generated docs, cache keys, and runtime
    // status have stable labels.
    if (!resolved.project.name?.trim()) {
      addIssue(issues, {
        path: "project.name",
        code: "config.missing-project-name",
        message: "Project name is required."
      });
    }

    const slug = resolved.project.slug;

    // Slugs must be predictable for package names, DB names, cache namespaces,
    // and generated paths.
    if (slug !== undefined && !PROJECT_SLUG_PATTERN.test(slug)) {
      addIssue(issues, {
        path: "project.slug",
        code: "config.invalid-slug",
        message: "Project slug must use lowercase letters, numbers, and single dashes."
      });
    }

    // Runtime modes are the top-level switch for what surfaces may start.
    if (!resolved.runtime.modes.length) {
      addIssue(issues, {
        path: "runtime.modes",
        code: "config.invalid-runtime-mode",
        message: "At least one runtime mode is required."
      });
    }

    validateDuplicateIds(
      resolved.runtime.modes as readonly string[],
      issues,
      "runtime.modes"
    );

    for (const mode of resolved.runtime.modes as readonly string[]) {
      if (!(RUNTIME_MODES as readonly string[]).includes(mode)) {
        addIssue(issues, {
          path: "runtime.modes",
          code: "config.invalid-runtime-mode",
          message: `Runtime mode "${mode}" is not supported.`
        });
      }
    }

    if (hasMode(resolved, "local-stdio-mcp") && !resolved.runtime.localStdioMcp?.enabled) {
      addIssue(issues, {
        path: "runtime.localStdioMcp",
        code: "config.invalid-runtime-combination",
        message: "local-stdio-mcp mode requires localStdioMcp.enabled."
      });
    }

    // Remote surfaces receive layered checks: enabled config, auth,
    // authorization, rate limit, audit, and no local/system capabilities.
    const remoteEnabled = hasMode(resolved, "remote-http-mcp");
    const remoteConfig = resolved.runtime.remoteHttpMcp;

    if (remoteEnabled && !remoteConfig?.enabled) {
      addIssue(issues, {
        path: "runtime.remoteHttpMcp",
        code: "config.invalid-runtime-combination",
        message: "remote-http-mcp mode requires remoteHttpMcp.enabled."
      });
    }

    if (remoteEnabled && remoteConfig?.enabled) {
      if (remoteConfig.auth?.required !== true) {
        addIssue(issues, {
          path: "runtime.remoteHttpMcp.auth",
          code: "config.remote-auth-required",
          message: "Remote HTTPS MCP requires an authentication policy."
        });
      }

      if (remoteConfig.authorization?.required !== true) {
        addIssue(issues, {
          path: "runtime.remoteHttpMcp.authorization",
          code: "config.remote-authorization-required",
          message: "Remote HTTPS MCP requires an authorization policy."
        });
      }

      if (remoteConfig.rateLimit?.required !== true) {
        addIssue(issues, {
          path: "runtime.remoteHttpMcp.rateLimit",
          code: "config.remote-rate-limit-required",
          message: "Remote HTTPS MCP requires a rate-limit policy."
        });
      }

      if (remoteConfig.audit?.enabled !== true) {
        addIssue(issues, {
          path: "runtime.remoteHttpMcp.audit",
          code: "config.remote-audit-required",
          message: "Remote HTTPS MCP requires audit behavior."
        });
      }

      if (remoteConfig.exposeLocalFilesystem) {
        addIssue(issues, {
          path: "runtime.remoteHttpMcp.exposeLocalFilesystem",
          code: "config.security-policy-weakened",
          message: "Remote HTTPS MCP cannot expose local filesystem access.",
          severity: "fatal"
        });
      }

      if (remoteConfig.allowShell) {
        addIssue(issues, {
          path: "runtime.remoteHttpMcp.allowShell",
          code: "config.security-policy-weakened",
          message: "Remote HTTPS MCP cannot expose shell access.",
          severity: "fatal"
        });
      }
    }

    // API service currently requires authentication and shares port validation
    // with other service surfaces.
    const apiEnabled = hasMode(resolved, "api-service");
    const apiConfig = resolved.runtime.apiService;

    if (apiEnabled && !apiConfig?.enabled) {
      addIssue(issues, {
        path: "runtime.apiService",
        code: "config.invalid-runtime-combination",
        message: "api-service mode requires apiService.enabled."
      });
    }

    if (apiEnabled && apiConfig?.enabled) {
      if (apiConfig.auth?.required !== true) {
        addIssue(issues, {
          path: "runtime.apiService.auth",
          code: "config.remote-auth-required",
          message: "API service requires an authentication policy."
        });
      }
    }

    const ports = new Map<number, string>();
    collectPort(ports, issues, remoteConfig?.enabled ? remoteConfig.port : undefined, "runtime.remoteHttpMcp.port");
    collectPort(ports, issues, apiConfig?.enabled ? apiConfig.port : undefined, "runtime.apiService.port");
    collectPort(ports, issues, resolved.dashboard.enabled ? resolved.dashboard.port : undefined, "dashboard.port");

    // Security policy options are fail-closed: explicit weakening is fatal.
    if (resolved.security.minimumPolicy === "relaxed") {
      addIssue(issues, {
        path: "security.minimumPolicy",
        code: "config.security-policy-weakened",
        message: "The base security policy cannot be relaxed.",
        severity: "fatal"
      });
    }

    if (resolved.security.allowPathTraversal) {
      addIssue(issues, {
        path: "security.allowPathTraversal",
        code: "config.security-policy-weakened",
        message: "Path traversal cannot be enabled.",
        severity: "fatal"
      });
    }

    if (resolved.security.allowSecretPaths) {
      addIssue(issues, {
        path: "security.allowSecretPaths",
        code: "config.security-policy-weakened",
        message: "Secret path access cannot be enabled.",
        severity: "fatal"
      });
    }

    if (resolved.security.allowLocalFilesystemInRemote) {
      addIssue(issues, {
        path: "security.allowLocalFilesystemInRemote",
        code: "config.security-policy-weakened",
        message: "Remote surfaces cannot expose local filesystem access.",
        severity: "fatal"
      });
    }

    if (resolved.security.allowShellInRemote) {
      addIssue(issues, {
        path: "security.allowShellInRemote",
        code: "config.security-policy-weakened",
        message: "Remote surfaces cannot expose shell access.",
        severity: "fatal"
      });
    }

    if (resolved.security.promptInjectionDefense?.enabled === false) {
      addIssue(issues, {
        path: "security.promptInjectionDefense.enabled",
        code: "config.security-policy-weakened",
        message: "Prompt-injection defense cannot be disabled.",
        severity: "fatal"
      });
    }

    // Path policies are validated after security booleans so both broad and
    // specific unsafe settings are reported.
    for (const [index, pathValue] of (resolved.security.allowedPaths ?? []).entries()) {
      validatePolicyPath({
        pathValue,
        configPath: `security.allowedPaths.${index}`,
        allowsSecretPattern: false,
        issues
      });
    }

    for (const [index, pathValue] of (resolved.security.blockedPaths ?? []).entries()) {
      validatePolicyPath({
        pathValue,
        configPath: `security.blockedPaths.${index}`,
        allowsSecretPattern: true,
        issues
      });
    }

    validateTokenBudget(resolved.tokenEfficiency.tokenBudget, issues);

    // Multi-agent mode requires shared context and token budgets so context
    // builders can create role slices safely.
    if (resolved.agents.mode === "token-efficient-multi-agent") {
      if (!resolved.agents.sharedContext?.enabled) {
        addIssue(issues, {
          path: "agents.sharedContext",
          code: "config.multi-agent-context-required",
          message: "Token-efficient multi-agent mode requires shared context config."
        });
      }

      if (!resolved.tokenEfficiency.enabled || !resolved.tokenEfficiency.tokenBudget) {
        addIssue(issues, {
          path: "tokenEfficiency.tokenBudget",
          code: "config.multi-agent-token-budget-required",
          message: "Token-efficient multi-agent mode requires token budget config."
        });
      }
    }

    // Provider and extension checks happen after runtime/security checks because
    // they depend on the resolved config surface.
    validateStorageReferences(resolved, issues);
    validateRemoteToolSafety(resolved.tools, issues);

    // Agent profile id duplication is detected early so
    // `createAgentDefinitionRegistry()` does not throw at runtime. The
    // registry's register-time check is a defense in depth; this is the
    // user-facing validation surface.
    if (resolved.agents.agents !== undefined) {
      validateDuplicateIds(
        resolved.agents.agents.map((profile) => profile.id),
        issues,
        "agents.agents"
      );
    }

    validateDuplicateIds(
      resolved.extensions.map((extension) => extension.id),
      issues,
      "extensions"
    );

    for (const [index, extension] of resolved.extensions.entries()) {
      validateExtensionProvider(extension, issues, `extensions.${index}`);
    }

    // evals validation (Stage 24)
    if (config.evals !== undefined) {
      if (config.evals.store?.capacity !== undefined) {
        const cap = config.evals.store.capacity;
        if (typeof cap !== "number" || !Number.isInteger(cap) || cap <= 0) {
          return fail({
            code: "config.invalid-evals-store-capacity",
            message: "config.evals.store.capacity must be a positive integer.",
            severity: "recoverable"
          });
        }
      }

      if (config.evals.llmJudge?.enabled === true && !config.llm) {
        return fail({
          code: "config.llm-judge-requires-llm-config",
          message:
            "config.evals.llmJudge.enabled requires config.llm to be configured.",
          severity: "recoverable"
        });
      }
    }

    if (issues.length > 0) {
      return validationFailure(issues);
    }

    return ok(resolved);
  }
}
