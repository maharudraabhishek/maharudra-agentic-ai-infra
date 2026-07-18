/**
 * Guardrails — core types (Stage 25.5 D40 / D42).
 *
 * Read-only contracts per D21. Concrete implementations live in the runtime
 * package (`runtime/src/guardrails/`). The default `NoopContentGuard` is
 * auto-wired into `RuntimeServiceContainer.contentGuard` (D43).
 *
 * `ContentGuard` is the content-safety concern (harmful content, jailbreaks,
 * PII). The response-policy concern (citations / evidence coverage) lives
 * on `HeuristicOutputGuard` in the runtime package and on
 * `AgentResponsePolicy` in `core/src/agents/types.ts`. Both share the
 * Guardrails umbrella but solve different problems.
 *
 * @umbrella Guardrails
 */

/** Result of a content-guard inspection. */
export type SafetyVerdict = {
  /** Whether the inspected content is safe to proceed with. */
  readonly safe: boolean;
  /**
   * What action the caller should take.
   * - `"pass"` — proceed unchanged
   * - `"block"` — refuse the request/response
   * - `"rewrite"` — replace content with `rewrittenText` (Stage 42)
   * - `"warn"` — proceed but emit an observability warning
   */
  readonly action: "pass" | "block" | "rewrite" | "warn";
  /** Free-form reason. Optional. */
  readonly reason?: string;
  /** Rewritten content when `action === "rewrite"`. */
  readonly rewrittenText?: string;
};

/** Input to a content-guard inspection. */
export type ContentGuardInput = {
  /** `"input"` = pre-execution check; `"output"` = post-execution check. */
  readonly direction: "input" | "output";
  readonly text: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
};

/**
 * Content-safety guard contract.
 *
 * Implementations may be heuristic-only (no LLM call, can run anywhere) or
 * LLM-backed (must run at Layer 10 or above per Stage 21 D1).
 *
 * Stage 25.5 ships `NoopContentGuard` as the default. Stage 42's
 * Constitutional AI guard ships a concrete LLM-backed implementation.
 */
export interface ContentGuard {
  inspect(input: ContentGuardInput): Promise<SafetyVerdict>;
}
