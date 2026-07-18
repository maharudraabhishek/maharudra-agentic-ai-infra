import type { PermissionDecision } from "../security/types.js";
import type { FrameworkResult } from "../errors/index.js";

/**
 * A single LLM completion request.
 *
 * All fields are readonly to prevent mutation by providers or middleware.
 * Providers must not store or log `prompt` content — it may contain sensitive data.
 */
export type LlmRequest = {
  /** The user prompt to complete. */
  readonly prompt: string;
  /** Optional system-level instruction for the model. */
  readonly systemPrompt?: string;
  /** Maximum output tokens. Providers use their own defaults when absent. */
  readonly maxTokens?: number;
  /** Sampling temperature in [0, 1]. Providers use their own defaults when absent. */
  readonly temperature?: number;
  /** Sequences that trigger generation stop. */
  readonly stopSequences?: readonly string[];
};

/**
 * The result of a single LLM completion.
 *
 * All token counts reflect actual usage returned by the provider.
 * `estimatedCostUsd` is computed from the CostCatalog at call time and may
 * differ from the provider's billing if pricing changes.
 */
export type LlmResponse = {
  /** The generated text content from the model. */
  readonly content: string;
  /** Tokens consumed by the input (prompt + system prompt). */
  readonly inputTokens: number;
  /** Tokens generated in the output. */
  readonly outputTokens: number;
  /** Sum of inputTokens + outputTokens. */
  readonly totalTokens: number;
  /** Model identifier as reported by the provider. */
  readonly model: string;
  /** The provider id that handled this request. */
  readonly providerId: string;
  /**
   * Estimated cost in USD for this call, computed from the CostCatalog.
   *
   * Zero for local providers (mock, ollama). May diverge from actual billing
   * if the CostCatalog prices are stale.
   */
  readonly estimatedCostUsd: number;
};

/**
 * Provider-agnostic LLM interface.
 *
 * Implementations must not throw — all failures are returned as
 * `FrameworkResult` with `ok: false`. This keeps error handling uniform
 * across SmartRouter's fallback chain.
 *
 * `countTokens()` is synchronous and may use a heuristic. It is used for
 * budget estimation before the actual call is made; exact accuracy is not
 * required but estimates must not undercount by more than 2×.
 * Recommended heuristic: `Math.ceil(text.length / 4)`.
 *
 * @example
 * ```typescript
 * const provider: LlmProvider = new MockLlmProvider("test");
 * const result = await provider.complete({ prompt: "Hello" });
 * if (result.ok) console.log(result.value.content);
 * ```
 */
export interface LlmProvider {
  /** Stable identifier for this provider instance. */
  readonly id: string;
  /** Model identifier used by this provider. */
  readonly model: string;
  /**
   * True when the provider runs locally without network calls.
   *
   * Local providers (mock, ollama) are zero-cost and immune to budget gates.
   * Remote providers (anthropic) require API keys and incur usage costs.
   */
  readonly isLocal: boolean;
  /**
   * Completes a prompt and returns a typed result.
   *
   * Never throws. Network failures, HTTP errors, and timeouts are returned
   * as `{ ok: false, error: { code: "llm.provider-unavailable" } }`.
   */
  complete(request: LlmRequest): Promise<FrameworkResult<LlmResponse>>;
  /**
   * Estimates token count synchronously.
   *
   * Used for cost estimation before making the call. Exact accuracy is not
   * required — the estimate must not undercount by more than 2×.
   * Standard heuristic: `Math.ceil(text.length / 4)`.
   */
  countTokens(text: string): number;
}

/**
 * Maps model IDs to per-token cost in USD.
 *
 * Returns 0 for unknown models — this is a safe open default that never blocks
 * calls to models not in the catalog. Callers that need exact pricing must
 * extend the catalog or supply a custom implementation.
 *
 * @example
 * ```typescript
 * const catalog: CostCatalog = new DefaultCostCatalog();
 * const cost = catalog.estimateCost("anthropic", "claude-haiku-4-5", 1000, 200);
 * ```
 */
export interface CostCatalog {
  /** Per-token input cost in USD, or 0 for unknown models. */
  inputCostPerToken(providerId: string, model: string): number;
  /** Per-token output cost in USD, or 0 for unknown models. */
  outputCostPerToken(providerId: string, model: string): number;
  /**
   * Estimates total call cost from token counts.
   *
   * Returns 0 when either the provider or model is unknown — callers can
   * treat 0 as "unknown cost, allow the call" rather than "free".
   */
  estimateCost(
    providerId: string,
    model: string,
    inputTokens: number,
    outputTokens: number
  ): number;
}

/**
 * Budget gate for LLM call-level cost control.
 *
 * Reuses `PermissionDecision` so callers have a uniform decision type shared
 * with the rest of the security surface (PermissionGate, DefaultApprovalPolicy).
 *
 * The gate is checked before each provider attempt in SmartRouter, not after
 * the fact. Budget-exceeded calls are a hard stop — they do not trigger fallback
 * to the next provider.
 *
 * @security Fail-closed: when `maxCostPerCallUsd <= 0`, all calls are blocked.
 *
 * @example
 * ```typescript
 * const gate: BudgetGate = new DefaultBudgetGate(0.01);
 * const decision = gate.check("anthropic", "claude-haiku-4-5", 0.005);
 * if (!decision.allowed) throw new Error(decision.reason);
 * ```
 */
export interface BudgetGate {
  /**
   * Checks whether the estimated cost is within the configured limit.
   *
   * Returns `{ allowed: true }` when cost ≤ limit, `{ allowed: false }` with a
   * descriptive reason when cost exceeds the limit.
   */
  check(
    providerId: string,
    model: string,
    estimatedCostUsd: number
  ): PermissionDecision;
}

/**
 * SmartRouter provider selection policy.
 *
 * Controls which providers are tried, in what order, and under what cost limit.
 * Used by SmartRouter to build the ordered provider list for each call.
 */
export type LlmRoutingPolicy = {
  /**
   * When true, providers with `isLocal = true` are tried before remote providers
   * regardless of the fallback chain order.
   *
   * Recommended for development: ensures Ollama (free, fast) is always
   * preferred over paid remote APIs.
   */
  readonly preferLocal: boolean;
  /**
   * Maximum estimated cost per call in USD.
   *
   * Calls estimated above this limit are refused before the network request is
   * made. Set to a large value (e.g. `1.0`) to allow all calls.
   */
  readonly maxCostPerCallUsd: number;
  /**
   * Provider ids to try in order.
   *
   * If `preferLocal` is true, local providers are prepended to this list
   * automatically. Providers not named in the chain are appended after the
   * chain in their original construction order.
   */
  readonly fallbackChain: readonly string[];
  /**
   * Per-call timeout in milliseconds applied by individual providers.
   *
   * Default: 30000 (30 seconds). Providers that implement `AbortController`-based
   * timeouts use this value; others may ignore it.
   */
  readonly timeoutMs?: number;
};

/**
 * Config for one LLM provider, stored in the project config.
 *
 * The `type` field selects the provider implementation:
 * - `"mock"` — deterministic, no network, for testing and CI
 * - `"ollama"` — local Ollama instance, free, requires `ollama serve`
 * - `"anthropic"` — Anthropic Messages API, requires API key in env
 */
export type LlmProviderConfig = {
  /** Stable identifier for this provider instance. */
  readonly id: string;
  /** Provider type determines which implementation is constructed. */
  readonly type: "mock" | "ollama" | "anthropic";
  /** Model identifier passed to the provider HTTP API or mock. */
  readonly model: string;
  /**
   * Base URL for the provider HTTP endpoint.
   *
   * - Ollama default: `http://localhost:11434`
   * - Anthropic default: `https://api.anthropic.com`
   * - Mock: ignored.
   */
  readonly baseUrl?: string;
  /**
   * Name of the environment variable holding the API key.
   *
   * Required for `type: "anthropic"`. Ignored for `mock` and `ollama`.
   *
   * @security The env var name is stored in config; the key value is read at
   *   construction time from `process.env` and must never be logged or included
   *   in spans.
   */
  readonly apiKeyEnvVar?: string;
};

/**
 * LLM section of the project config.
 *
 * Absent or undefined means no LLM providers are wired — SmartRouter is not
 * instantiated in the runtime service container. This is the safe default for
 * projects that do not need LLM calls from within the framework itself.
 *
 * @example
 * ```typescript
 * const llmConfig: LlmConfig = {
 *   providers: [
 *     { id: "local", type: "ollama", model: "llama3.2" },
 *     { id: "remote", type: "anthropic", model: "claude-haiku-4-5", apiKeyEnvVar: "ANTHROPIC_API_KEY" }
 *   ],
 *   routing: { preferLocal: true, maxCostPerCallUsd: 0.01, fallbackChain: ["local", "remote"] }
 * };
 * ```
 */
export type LlmConfig = {
  /** Ordered list of provider configs. Must have at least one entry to activate SmartRouter. */
  readonly providers: readonly LlmProviderConfig[];
  /** Routing policy for SmartRouter. Sensible defaults are applied when absent. */
  readonly routing?: LlmRoutingPolicy;
};
