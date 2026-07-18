import { cliFail, cliOk } from "./result.js";
import type {
  CliIssue,
  CliResult,
  NormalizedInitOptions,
  RetrievalProviderType,
  RuntimeMode
} from "./types.js";

/**
 * Generated framework config object before it is serialized to TypeScript.
 */
export type GeneratedProjectConfig = Record<string, unknown>;

type RetrievalProviderConfig = {
  readonly id: string;
  readonly type: RetrievalProviderType;
  readonly enabled: boolean;
  readonly storageProviderId?: string;
  readonly safetyPolicy?: {
    readonly remoteSafe: boolean;
  };
};

type StorageProviderConfig = {
  readonly id: string;
  readonly type: "memory" | "postgres";
  readonly connectionRef?: string;
  readonly capabilities?: readonly string[];
};

type RuntimeConfig = {
  readonly modes: readonly RuntimeMode[];
  readonly localStdioMcp?: Record<string, unknown>;
  readonly remoteHttpMcp?: Record<string, unknown>;
  readonly apiService?: Record<string, unknown>;
};

/**
 * Builds generated runtime config from normalized CLI options.
 *
 * Runtime config is explicit about local and remote boundaries so generated
 * projects can import runtime adapters without accidentally exposing local-only
 * capabilities through remote surfaces.
 */
function buildRuntimeConfig(options: NormalizedInitOptions): RuntimeConfig {
  const hasLocal = options.runtimeModes.includes("local-stdio-mcp");
  const hasRemote = options.runtimeModes.includes("remote-http-mcp");
  const hasApi = options.runtimeModes.includes("api-service");

  return {
    modes: options.runtimeModes,
    localStdioMcp: hasLocal
      ? {
          enabled: true,
          transport: "stdio",
          allowLocalFilesystem: true,
          allowControlledWrites:
            options.profile === "controlled-write" ||
            options.profile === "full-agentic-context" ||
            options.profile === "hybrid-all",
          allowShell: false,
          toolProfile: options.profile
        }
      : undefined,
    remoteHttpMcp: hasRemote
      ? {
          // Remote config binds to loopback by default and includes required
          // policy references. Runtime startup still fails closed if a caller
          // removes auth, audit, or rate-limit policy configuration.
          enabled: true,
          transport: "https",
          host: "127.0.0.1",
          port: 8443,
          auth: { required: true, provider: "project", policyRef: "remote-auth-policy" },
          authorization: { required: true, policyRef: "remote-authorization-policy" },
          rateLimit: { required: true, policyRef: "remote-rate-limit-policy" },
          audit: { enabled: true, sink: "safe-log", policyRef: "remote-audit-policy" },
          exposeLocalFilesystem: false,
          allowShell: false,
          toolProfile: "remote-safe"
        }
      : undefined,
    apiService: hasApi
      ? {
          // The API service follows the same remote-safe shape as remote MCP so
          // generated projects do not expose unsafe local capabilities.
          enabled: true,
          transport: "https",
          host: "127.0.0.1",
          port: 8787,
          auth: { required: true, provider: "project", policyRef: "api-auth-policy" },
          authorization: { required: true, policyRef: "api-authorization-policy" },
          rateLimit: { required: true, policyRef: "api-rate-limit-policy" },
          audit: { enabled: true, sink: "safe-log", policyRef: "api-audit-policy" }
        }
      : undefined
  };
}

/**
 * Builds generated storage provider config for the selected profile and retrieval strategy.
 *
 * The vectorless-local profile uses in-memory storage (no Postgres or Docker required).
 * The hybrid-rag profile uses two Postgres providers: one for lexical/structural indexes
 * and one for vector indexes. All other profiles that need retrieval use a single
 * Postgres-backed storage. The core validator rejects type:"filesystem" with
 * config.filesystem-storage-not-implemented, so this function never produces filesystem
 * providers.
 */
function buildStorageProviders(
  options: NormalizedInitOptions
): readonly StorageProviderConfig[] {
  const providers: StorageProviderConfig[] = [];

  if (options.profile === "vectorless-local") {
    // In-memory store: zero dependencies, no Docker, no migrations. Data is lost on restart.
    // The core InMemoryStorageProvider auto-wires when type:"memory" is declared.
    providers.push({
      id: "in-memory-store",
      type: "memory",
      capabilities: ["full-text", "document-tree", "symbol-code"]
    });
    return providers;
  }

  if (options.profile === "hybrid-rag") {
    // hybrid-rag always uses two Postgres providers: one for lexical/structural indexes
    // and one for pgvector semantic similarity. Both target the same connection ref.
    providers.push({
      id: "rag-context-store",
      type: "postgres",
      connectionRef: "local-ai-context-postgres",
      capabilities: ["full-text", "document-tree", "page-index", "symbol-code"]
    });
    providers.push({
      id: "rag-vector-store",
      type: "postgres",
      connectionRef: "local-ai-context-postgres",
      capabilities: ["pgvector"]
    });
    return providers;
  }

  if (options.retrievalStrategies.length > 0) {
    // Postgres-backed local context store for file-derived indexes.
    // Connection reference keeps the generated config credential-free.
    providers.push({
      id: "local-context-store",
      type: "postgres",
      connectionRef: "local-ai-context-postgres",
      capabilities: ["full-text", "document-tree", "page-index", "symbol-code", "hybrid"]
    });
  }

  if (
    options.retrievalStrategies.includes("pgvector") ||
    options.retrievalStrategies.includes("graph")
  ) {
    // Vector and graph providers require a separate Postgres provider entry
    // so their capabilities are declared explicitly for the runtime registry.
    providers.push({
      id: "local-postgres-context",
      type: "postgres",
      connectionRef: "local-ai-context-postgres",
      capabilities: ["pgvector", "graph"]
    });
  }

  return providers;
}

/**
 * Builds generated retrieval provider config from selected strategies.
 *
 * Providers are disabled only by removing the strategy; selected strategies get
 * concrete ids so router config can reference them safely.
 */
function buildRetrievalProviders(
  options: NormalizedInitOptions
): readonly RetrievalProviderConfig[] {
  return options.retrievalStrategies.map((strategy) => ({
    id: `local-${strategy}`,
    type: strategy,
    enabled: true,
    storageProviderId:
      strategy === "pgvector" || strategy === "graph"
        ? "local-postgres-context"
        : "local-context-store",
    safetyPolicy: { remoteSafe: false }
  }));
}

/**
 * Creates the complete generated project config object.
 *
 * The object is later serialized into `agentic-ai-infra.config.ts`, so it avoids
 * runtime-only values, environment reads, secret material, and side effects.
 */
export function createProjectConfig(
  options: NormalizedInitOptions
): GeneratedProjectConfig {
  const storageProviders = buildStorageProviders(options);

  return {
    project: {
      name: options.projectName,
      slug: options.slug
    },
    profiles: [options.profile],
    runtime: buildRuntimeConfig(options),
    agents: {
      mode: options.agentMode,
      sharedContext:
        options.agentMode === "token-efficient-multi-agent"
          ? {
              enabled: true,
              maxPacketTokens: 9000
            }
          : undefined
    },
    tokenEfficiency: {
      enabled: true,
      tokenBudget: {
        maxTotalTokens:
          options.agentMode === "token-efficient-multi-agent" ? 24000 : 16000,
        maxContextTokens:
          options.agentMode === "token-efficient-multi-agent" ? 12000 : 8000,
        maxResponseTokens: 4000,
        reserveTokens: 1000,
        roleBudgets:
          options.agentMode === "token-efficient-multi-agent"
            ? {
                manager: 4000,
                "architecture-reviewer": 5000,
                "security-reviewer": 5000,
                "implementation-planner": 7000,
                "eval-reviewer": 4000,
                "docs-reviewer": 4000
              }
            : undefined
      }
    },
    storage: {
      defaultProviderId: storageProviders[0]?.id,
      providers: storageProviders
    },
    retrieval: {
      enabled: options.retrievalStrategies.length > 0 || options.profile === "hybrid-rag",
      providers: options.profile === "hybrid-rag"
        ? [
            // hybrid-rag always generates all four providers: full-text, pgvector,
            // page-index, and symbol-code. Retrieval strategy flags are ignored
            // for this profile — the profile drives the full provider set.
            { id: "rag-full-text", type: "full-text", enabled: true, storageProviderId: "rag-context-store", safetyPolicy: { remoteSafe: false } },
            { id: "rag-pgvector",  type: "pgvector",  enabled: true, storageProviderId: "rag-vector-store",  safetyPolicy: { remoteSafe: false } },
            { id: "rag-page-index",type: "page-index",enabled: true, storageProviderId: "rag-context-store", safetyPolicy: { remoteSafe: false } },
            { id: "rag-symbol",    type: "symbol-code",enabled: true,storageProviderId: "rag-context-store", safetyPolicy: { remoteSafe: false } }
          ]
        : buildRetrievalProviders(options),
      router:
        options.profile === "hybrid-rag"
          ? {
              strategy: "hybrid",
              providerOrder: ["rag-full-text", "rag-pgvector", "rag-page-index", "rag-symbol"],
              maxResults: 12,
              // RRF merger and heuristic reranker are the defining feature of
              // the hybrid-rag profile. They are not configurable per-project —
              // the profile drives the full quality pipeline.
              merger: "rrf",
              reranker: "heuristic"
            }
          : options.retrievalStrategies.length > 0
            ? {
                strategy:
                  options.retrievalStrategies.length > 1 ? "hybrid" : "single",
                providerOrder: options.retrievalStrategies.map(
                  (strategy) => `local-${strategy}`
                ),
                maxResults: 8
              }
            : undefined
    },
    dashboard: options.dashboard
      ? {
          enabled: true,
          host: "127.0.0.1",
          port: options.dashboardPort,
          showTokenUsage: true,
          showRetrievalQuality: true,
          showEvalResults: true,
          showAuditEvents: true,
          showAgentWorkflows: true
        }
      : undefined,
    security: {
      minimumPolicy: "strict",
      allowPathTraversal: false,
      allowSecretPaths: false,
      allowLocalFilesystemInRemote: false,
      allowShellInRemote: false,
      promptInjectionDefense: {
        // Retrieved content can help answer questions, but it must never be
        // treated as trusted instructions that override the agent's policies.
        enabled: true,
        retrievedContentIsEvidence: true,
        warnOnUntrustedContent: true
      }
    },
    freshness: {
      defaultPolicy: {
        maxAgeSeconds: 3600,
        requireSourceVersion: true,
        staleWhileRevalidate: false
      }
    },
    observability: {
      enabled: true,
      safeLogging: true,
      audit: { enabled: true, sink: "local" },
      traces: { enabled: true, sink: "local" }
    }
  };
}

/**
 * Validates cross-field assumptions in the generated config.
 *
 * This check runs after config creation so it can catch missing runtime modes,
 * shared-context mismatches, and provider/storage relationships that are not
 * visible from individual CLI flags alone.
 */
export function validateGeneratedConfig(
  options: NormalizedInitOptions
): CliResult<GeneratedProjectConfig> {
  const config = createProjectConfig(options);
  const issues: CliIssue[] = [];
  const runtime = config.runtime as { modes?: readonly RuntimeMode[] };

  if (!runtime.modes?.length) {
    issues.push({
      severity: "error",
      code: "invalid-runtime",
      message: "Generated config requires at least one runtime mode."
    });
  }

  if (
    options.agentMode === "token-efficient-multi-agent" &&
    !(config.agents as { sharedContext?: { enabled?: boolean } }).sharedContext?.enabled
  ) {
    issues.push({
      severity: "error",
      code: "missing-shared-context",
      message: "Token-efficient multi-agent config requires shared context."
    });
  }

  if (
    (options.retrievalStrategies.includes("pgvector") || options.profile === "hybrid-rag") &&
    !buildStorageProviders(options).some((provider) => provider.type === "postgres")
  ) {
    issues.push({
      severity: "error",
      code: "pgvector-postgres-required",
      message: "pgvector retrieval requires Postgres storage config."
    });
  }

  if (issues.length > 0) {
    return cliFail(issues);
  }

  return cliOk(config);
}
