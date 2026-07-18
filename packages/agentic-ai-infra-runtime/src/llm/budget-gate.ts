import type { BudgetGate, PermissionDecision } from "@maharudra/agentic-ai-infra-core";

/**
 * Enforces a per-call cost ceiling before each provider attempt.
 *
 * The gate is checked by SmartRouter before calling a provider — not after.
 * When the estimated cost exceeds the configured limit, the call is refused
 * immediately without attempting the provider. This is a hard stop: budget
 * refusal does not trigger fallback to the next provider.
 *
 * Returns `PermissionDecision` so callers have a uniform decision type shared
 * with the rest of the security surface (PermissionGate, DefaultApprovalPolicy).
 *
 * @security Fail-closed: `maxCostPerCallUsd <= 0` blocks all calls. The
 *   constructor throws to prevent accidental zero-limit construction. Use a
 *   large value (e.g. `1.0`) to allow all calls without a meaningful limit.
 *
 * @example
 * ```typescript
 * const gate = new DefaultBudgetGate(0.01);
 * const decision = gate.check("anthropic", "claude-haiku-4-5", 0.005);
 * // decision.allowed === true
 * const over = gate.check("anthropic", "claude-haiku-4-5", 0.015);
 * // over.allowed === false
 * ```
 */
export class DefaultBudgetGate implements BudgetGate {
  /**
   * @param maxCostPerCallUsd - Maximum allowed estimated cost per call in USD.
   *   Must be > 0. Throws on construction if <= 0 (fail-closed contract).
   */
  constructor(private readonly maxCostPerCallUsd: number) {
    if (maxCostPerCallUsd <= 0) {
      throw new Error(
        "DefaultBudgetGate: maxCostPerCallUsd must be > 0. " +
        "Use a large value (e.g. 1.0) to allow all calls."
      );
    }
  }

  /**
   * Checks whether the estimated cost is within the configured limit.
   *
   * Allows calls at exactly the limit (`estimatedCostUsd <= maxCostPerCallUsd`).
   * Blocks calls that exceed the limit (`estimatedCostUsd > maxCostPerCallUsd`).
   *
   * @param providerId - Provider identifier included in the block reason string
   * @param model - Model identifier included in the block reason string
   * @param estimatedCostUsd - Pre-call estimated cost from CostCatalog
   */
  check(
    providerId: string,
    model: string,
    estimatedCostUsd: number
  ): PermissionDecision {
    if (estimatedCostUsd > this.maxCostPerCallUsd) {
      return {
        allowed: false,
        reason:
          `Estimated cost $${estimatedCostUsd.toFixed(6)} for ` +
          `${providerId}/${model} exceeds limit ` +
          `$${this.maxCostPerCallUsd.toFixed(6)}.`
      };
    }

    return { allowed: true, reason: "within budget" };
  }
}

/**
 * Open gate used when no budget limit is configured.
 *
 * Always allows calls regardless of estimated cost. Used when the project
 * config has `llm.routing.maxCostPerCallUsd` absent or zero — the absence of
 * a budget limit is an explicit opt-in to unconstrained spending.
 *
 * @example
 * ```typescript
 * const gate = new NoopBudgetGate();
 * gate.check("any", "any-model", 999.0).allowed === true
 * ```
 */
export class NoopBudgetGate implements BudgetGate {
  /**
   * Always returns `{ allowed: true }`.
   *
   * Parameters are accepted to satisfy the interface but are not evaluated.
   */
  check(_providerId: string, _model: string, _estimatedCostUsd: number): PermissionDecision {
    return { allowed: true, reason: "no budget limit configured" };
  }
}
