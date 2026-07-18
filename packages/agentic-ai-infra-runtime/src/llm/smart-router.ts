import type {
  BudgetGate,
  CostCatalog,
  FrameworkResult,
  LlmProvider,
  LlmRequest,
  LlmResponse,
  LlmRoutingPolicy
} from "@maharudra/agentic-ai-infra-core";

/**
 * SmartRouter selects an LLM provider per call using a routing policy,
 * enforces a per-call cost budget, and executes a fallback chain.
 *
 * Execution order for each `complete()` call:
 *
 * ```txt
 *  LlmRequest
 *      │
 *      ▼
 *  SmartRouter
 *      │
 *      ├─ build ordered providers (local-first if preferLocal)
 *      │
 *      ▼ for each provider in order
 *  countTokens() → estimateCost() → BudgetGate.check()
 *      │                                     │
 *      │ allowed                             │ blocked
 *      ▼                                     ▼
 *  provider.complete()              llm.budget-exceeded (stop)
 *      │
 *      ├─ ok: true  → return LlmResponse
 *      └─ ok: false → next provider
 *              │
 *          (all failed)
 *              ▼
 *      llm.fallback-exhausted
 * ```
 *
 * Budget-exceeded calls do NOT trigger fallback. This is intentional: the
 * budget limit is a hard ceiling for cost control, not a routing hint.
 *
 * @example
 * ```typescript
 * const router = new SmartRouter(
 *   [new MockLlmProvider("mock")],
 *   { preferLocal: true, maxCostPerCallUsd: 0.01, fallbackChain: [] },
 *   DEFAULT_COST_CATALOG,
 *   new DefaultBudgetGate(0.01)
 * );
 * const result = await router.complete({ prompt: "Hello" });
 * ```
 */
export class SmartRouter {
  /**
   * @param providers - Non-empty list of LLM providers available for routing.
   * @param policy - Routing policy controlling order, budget, and fallback chain.
   * @param costCatalog - Cost catalog for pre-call cost estimation.
   * @param budgetGate - Budget gate checked before each provider attempt.
   *
   * @throws When `providers` is empty — SmartRouter requires at least one provider.
   */
  constructor(
    private readonly providers: readonly LlmProvider[],
    private readonly policy: LlmRoutingPolicy,
    private readonly costCatalog: CostCatalog,
    private readonly budgetGate: BudgetGate
  ) {
    if (providers.length === 0) {
      throw new Error("SmartRouter: providers list must not be empty.");
    }
  }

  /**
   * Completes a prompt using the best available provider.
   *
   * Tries providers in the order returned by `orderedProviders()`. For each:
   *   1. Estimates cost via `CostCatalog.estimateCost()`.
   *   2. Checks cost against `BudgetGate.check()`.
   *      - Blocked → returns `llm.budget-exceeded` immediately (hard stop,
   *        no fallback).
   *   3. Calls `provider.complete(request)`.
   *      - Success → returns the result.
   *      - `llm.provider-unavailable` → logs to stderr and tries next provider.
   *      - Other error → returns the error immediately.
   * When all providers are exhausted without success:
   *   returns `{ ok: false, error: { code: "llm.fallback-exhausted" } }`.
   */
  async complete(request: LlmRequest): Promise<FrameworkResult<LlmResponse>> {
    const orderedList = this.orderedProviders();

    for (const provider of orderedList) {
      // Estimate cost using token counts before making the network call.
      // Conservative output estimate when maxTokens is unspecified.
      const promptText = request.prompt + (request.systemPrompt ?? "");
      const inputTokens = provider.countTokens(promptText);
      const outputTokens = request.maxTokens ?? 512;
      const estimatedCostUsd = this.costCatalog.estimateCost(
        provider.id,
        provider.model,
        inputTokens,
        outputTokens
      );

      // Budget gate is a hard stop — budget refusal never triggers fallback.
      // Callers must raise their maxCostPerCallUsd or use a cheaper model.
      const budgetDecision = this.budgetGate.check(
        provider.id,
        provider.model,
        estimatedCostUsd
      );

      if (!budgetDecision.allowed) {
        return {
          ok: false,
          error: {
            code: "llm.budget-exceeded",
            message: budgetDecision.reason,
            severity: "recoverable"
          }
        };
      }

      const result = await provider.complete(request);

      if (result.ok) {
        return result;
      }

      // Only provider-unavailable errors trigger fallback to the next provider.
      // Other error codes (e.g. budget-exceeded returned by a nested call) are
      // returned immediately without trying the next provider.
      if (result.error.code === "llm.provider-unavailable") {
        process.stderr.write(
          `[SmartRouter] Provider "${provider.id}" unavailable: ${result.error.message}\n`
        );
        continue;
      }

      return result;
    }

    return {
      ok: false,
      error: {
        code: "llm.fallback-exhausted",
        message: "All providers in the fallback chain failed.",
        severity: "recoverable"
      }
    };
  }

  /**
   * Returns the ordered provider list that would be used for a call.
   *
   * Builds the list without making any network requests. Used for inspection
   * and tests to verify routing policy without running actual completions.
   *
   * Order rules:
   * 1. If `policy.fallbackChain` is non-empty: reorder providers to match the
   *    chain; providers not named in the chain are appended after.
   * 2. If `policy.preferLocal` is true: stable-sort so `isLocal = true`
   *    providers precede `isLocal = false` providers (within each group,
   *    the fallback chain order is preserved).
   */
  orderedProviders(): readonly LlmProvider[] {
    let ordered = [...this.providers];

    // Reorder by fallback chain when specified.
    if (this.policy.fallbackChain.length > 0) {
      const chainIdx = new Map(
        this.policy.fallbackChain.map((id, i) => [id, i])
      );
      const inChain = ordered
        .filter((p) => chainIdx.has(p.id))
        .sort((a, b) => chainIdx.get(a.id)! - chainIdx.get(b.id)!);
      const notInChain = ordered.filter((p) => !chainIdx.has(p.id));
      ordered = [...inChain, ...notInChain];
    }

    // preferLocal: stable-sort to put local providers before remote ones.
    // Within each group (local vs remote), the fallback chain order is kept.
    if (this.policy.preferLocal) {
      const local = ordered.filter((p) => p.isLocal);
      const remote = ordered.filter((p) => !p.isLocal);
      ordered = [...local, ...remote];
    }

    return ordered;
  }
}
