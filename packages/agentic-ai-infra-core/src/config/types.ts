import type { AgentRuntimeConfig } from "../agents/types.js";
import type { FreshnessConfig } from "../cache/types.js";
import type { LlmConfig } from "../llm/types.js";
import type { DashboardConfig, ObservabilityConfig } from "../observability/types.js";
import type { EmbeddingProviderConfig, RetrievalConfig } from "../retrieval/types.js";
import type { RuntimeConfig } from "../runtime/types.js";
import type { SecurityConfig } from "../security/types.js";
import type { StorageConfig } from "../storage/types.js";
import type { TokenEfficiencyConfig } from "../token/types.js";
import type { ToolContract } from "../tools/types.js";

/**
 * User-facing configuration for context assembly behavior.
 *
 * Controls the dedup and compression passes applied by `ContextOptimizer`
 * before context is packaged for agent consumption. Both passes are optional
 * and their defaults are conservative (dedup threshold 0.95, compression off).
 */
export type ContextConfig = {
  /**
   * Configuration for the cosine-similarity deduplication pass.
   *
   * Dedup is always active when an `EmbeddingProvider` is available.
   * The threshold controls how similar two results must be before the
   * lower-priority one is dropped.
   */
  readonly dedup?: {
    /**
     * Cosine similarity threshold in [0, 1]. Results with similarity >=
     * this value are considered near-duplicates. Default: 0.95.
     */
    readonly threshold?: number;
  };
  /**
   * Configuration for the sentence-level compression pass.
   */
  readonly compression?: {
    /**
     * When true, low-signal sentences are trimmed from each result's content
     * before context assembly. Citation markers are always preserved.
     * Default: false.
     */
    readonly enabled?: boolean;
  };
};

/**
 * Eval system configuration.
 *
 * Controls in-memory `EvalStore` capacity and the optional `LlmJudgeEvaluator`.
 * All fields are optional; defaults are conservative.
 */
export type EvalsConfig = {
  /**
   * `EvalStore` configuration.
   */
  readonly store?: {
    /**
     * Ring buffer capacity in records. Default: 100.
     * Older records are dropped when capacity is exceeded.
     */
    readonly capacity?: number;
  };
  /**
   * Optional LLM-judge evaluator. Disabled by default.
   *
   * When `enabled === true` AND a SmartRouter is wired into the runtime
   * container, the `LlmJudgeEvaluator` is registered into the `EvalHarness`.
   */
  readonly llmJudge?: {
    readonly enabled?: boolean;
    /**
     * Reserved for future use. Stage 24 does not honor this field —
     * provider selection is policy-driven inside SmartRouter via
     * `LlmRoutingPolicy`.
     */
    readonly providerId?: string;
  };
};

/**
 * Human-readable project identity used by generated docs, dashboard summaries,
 * and runtime status output.
 */
export type ProjectIdentityConfig = {
  readonly name: string;
  readonly slug?: string;
  readonly description?: string;
};

/**
 * Config entry for project-provided extension providers.
 */
export type ExtensionProviderConfig = {
  readonly id: string;
  readonly kind: "storage" | "retrieval" | "runtime" | "tool" | "observability";
  readonly capabilities: readonly string[];
  readonly safetyPolicyRef?: string;
};

/**
 * User-facing framework configuration.
 *
 * Every section is optional at input time because built-in profiles and package
 * defaults can fill the resolved config before validation.
 */
export type AgenticInfraProjectConfig = {
  readonly project?: ProjectIdentityConfig;
  readonly profiles?: readonly string[];
  readonly runtime?: RuntimeConfig;
  readonly storage?: StorageConfig;
  readonly retrieval?: RetrievalConfig;
  readonly agents?: AgentRuntimeConfig;
  readonly tokenEfficiency?: TokenEfficiencyConfig;
  readonly dashboard?: DashboardConfig;
  readonly security?: SecurityConfig;
  readonly freshness?: FreshnessConfig;
  readonly observability?: ObservabilityConfig;
  /**
   * LLM provider configuration. Absent or undefined means no LLM providers are
   * wired — SmartRouter is not instantiated in the runtime service container.
   */
  readonly llm?: LlmConfig;
  /**
   * Optional embedding provider configuration.
   *
   * When set, `createRuntimeServiceContainer` constructs an `EmbeddingProvider`
   * via `createEmbeddingProvider()` and wires it into `PgVectorProvider` for
   * SQL semantic vector queries.
   *
   * When absent and the active profile declares a `pgvector` retrieval provider,
   * the container falls back to `MockEmbeddingProvider` automatically. This
   * fallback is intentional: profiles that need semantic queries work in CI
   * without Ollama, producing deterministic but lower-quality results.
   *
   * For local development with Ollama and mxbai-embed-large:
   * ```typescript
   * embedding: {
   *   type: "local-http",
   *   baseUrl: "http://localhost:11434",
   *   model: "mxbai-embed-large",
   *   dimension: 1024
   * }
   * ```
   */
  readonly embedding?: EmbeddingProviderConfig;
  /**
   * Context assembly configuration.
   *
   * Controls deduplication and compression passes applied by `ContextOptimizer`.
   * When absent, defaults apply: dedup threshold 0.95, compression disabled.
   */
  readonly context?: ContextConfig;
  /**
   * Eval system configuration.
   *
   * When absent, defaults apply: store capacity 100, LLM judge disabled.
   */
  readonly evals?: EvalsConfig;
  readonly tools?: readonly ToolContract[];
  readonly extensions?: readonly ExtensionProviderConfig[];
};

/**
 * Profile-expanded project configuration used after resolution.
 */
export type ResolvedProjectConfig = AgenticInfraProjectConfig & {
  readonly project: ProjectIdentityConfig;
  readonly profiles: readonly string[];
  readonly runtime: RuntimeConfig;
  readonly storage: StorageConfig;
  readonly retrieval: RetrievalConfig;
  readonly agents: AgentRuntimeConfig;
  readonly tokenEfficiency: TokenEfficiencyConfig;
  readonly dashboard: DashboardConfig;
  readonly security: SecurityConfig;
  readonly freshness: FreshnessConfig;
  readonly observability: ObservabilityConfig;
  /**
   * LLM provider configuration. Absent or undefined means no LLM providers are
   * wired — SmartRouter is not instantiated in the runtime service container.
   */
  readonly llm?: LlmConfig;
  /**
   * Optional embedding provider configuration.
   *
   * When set, `createRuntimeServiceContainer` constructs an `EmbeddingProvider`
   * via `createEmbeddingProvider()` and wires it into `PgVectorProvider` for
   * SQL semantic vector queries.
   *
   * When absent and the active profile declares a `pgvector` retrieval provider,
   * the container falls back to `MockEmbeddingProvider` automatically. This
   * fallback is intentional: profiles that need semantic queries work in CI
   * without Ollama, producing deterministic but lower-quality results.
   *
   * For local development with Ollama and mxbai-embed-large:
   * ```typescript
   * embedding: {
   *   type: "local-http",
   *   baseUrl: "http://localhost:11434",
   *   model: "mxbai-embed-large",
   *   dimension: 1024
   * }
   * ```
   */
  readonly embedding?: EmbeddingProviderConfig;
  readonly context?: ContextConfig;
  readonly evals?: EvalsConfig;
  readonly tools: readonly ToolContract[];
  readonly extensions: readonly ExtensionProviderConfig[];
};
