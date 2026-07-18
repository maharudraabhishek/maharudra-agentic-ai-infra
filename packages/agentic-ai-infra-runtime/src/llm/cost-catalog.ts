import type { CostCatalog } from "@maharudra/agentic-ai-infra-core";

/**
 * Per-token input costs in USD for known provider/model combinations.
 *
 * Key format: `"providerId/model"` (e.g. `"anthropic/claude-haiku-4-5"`).
 * Prices are approximate and sourced from Anthropic pricing as of 2025-Q2.
 * Local providers (ollama, mock) are always 0.
 */
const KNOWN_INPUT_COSTS: Readonly<Record<string, number>> = {
  "anthropic/claude-haiku-4-5":  0.0000008,
  "anthropic/claude-sonnet-4-6": 0.000003,
  "anthropic/claude-opus-4-6":   0.000015,
  "ollama/llama3.2":             0,
  "ollama/mxbai-embed-large":    0,
  "mock/mock-v1":                0
};

/**
 * Per-token output costs in USD for known provider/model combinations.
 *
 * Same key format as KNOWN_INPUT_COSTS. Output tokens are typically more
 * expensive than input tokens for Anthropic models.
 */
const KNOWN_OUTPUT_COSTS: Readonly<Record<string, number>> = {
  "anthropic/claude-haiku-4-5":  0.000004,
  "anthropic/claude-sonnet-4-6": 0.000015,
  "anthropic/claude-opus-4-6":   0.000075,
  "ollama/llama3.2":             0,
  "ollama/mxbai-embed-large":    0,
  "mock/mock-v1":                0
};

/**
 * Default cost catalog with approximate per-token costs for known models.
 *
 * Returns 0 for unknown provider/model combinations — this is a safe open
 * default that never blocks calls to models not in the catalog. The budget
 * gate will always allow 0-cost calls, so unknown models are treated as free
 * rather than as blocked.
 *
 * Prices are approximate and sourced from Anthropic pricing as of 2025-Q2.
 * Ollama and mock providers are always 0.
 *
 * To use current pricing, override via a custom `CostCatalog` implementation
 * (Stage 24+: config cost table support).
 *
 * @example
 * ```typescript
 * const cost = DEFAULT_COST_CATALOG.estimateCost("anthropic", "claude-haiku-4-5", 1000, 200);
 * // 1000 * 0.0000008 + 200 * 0.000004 = 0.0008 + 0.0008 = 0.00160
 * ```
 */
export class DefaultCostCatalog implements CostCatalog {
  /**
   * Returns the per-token input cost in USD, or 0 for unknown models.
   *
   * Lookup key: `"${providerId}/${model}"`.
   */
  inputCostPerToken(providerId: string, model: string): number {
    return KNOWN_INPUT_COSTS[`${providerId}/${model}`] ?? 0;
  }

  /**
   * Returns the per-token output cost in USD, or 0 for unknown models.
   *
   * Lookup key: `"${providerId}/${model}"`.
   */
  outputCostPerToken(providerId: string, model: string): number {
    return KNOWN_OUTPUT_COSTS[`${providerId}/${model}`] ?? 0;
  }

  /**
   * Estimates total call cost from input and output token counts.
   *
   * Returns 0 when either the provider or model is unknown — treat 0 as
   * "unknown cost, allow the call" rather than "free". The budget gate allows
   * 0-cost calls unconditionally.
   *
   * @param providerId - Provider identifier (e.g. `"anthropic"`)
   * @param model - Model identifier (e.g. `"claude-haiku-4-5"`)
   * @param inputTokens - Number of input tokens
   * @param outputTokens - Number of output tokens
   */
  estimateCost(
    providerId: string,
    model: string,
    inputTokens: number,
    outputTokens: number
  ): number {
    return (
      inputTokens * this.inputCostPerToken(providerId, model) +
      outputTokens * this.outputCostPerToken(providerId, model)
    );
  }
}

/**
 * Shared default cost catalog instance.
 *
 * Use this singleton instead of constructing a new `DefaultCostCatalog` on
 * each call. The instance is stateless and safe to share across providers,
 * SmartRouter, and tests.
 */
export const DEFAULT_COST_CATALOG = new DefaultCostCatalog();
