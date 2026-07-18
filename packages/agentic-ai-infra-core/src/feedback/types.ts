/**
 * Feedback Loops — core types (Stage 25.5 D41 / D42).
 *
 * Read-only contracts per D21. Concrete implementations live in the runtime
 * package (`runtime/src/feedback-loops/`). The default `NoopFeedbackHook`
 * is auto-wired into `RuntimeServiceContainer.feedbackHook` (D43).
 *
 * Stage 25.5 Phase 04 already ships `runWithRetry` as a concrete in-run
 * feedback-loop primitive. This file declares the broader hook interface
 * that Stage 48 (SelfCritique) and Stage 49 (RLHF) will implement.
 *
 * @umbrella Feedback Loops
 */

/**
 * Closed taxonomy of actions a feedback hook can recommend.
 * - `"accept"` — output is fine; proceed
 * - `"retry"` — re-execute the operation (caller chooses how)
 * - `"escalate"` — route to human review or higher-privilege path
 * - `"revise"` — modify the output before returning (Stage 48 self-critique)
 */
export type FeedbackAction = "accept" | "retry" | "escalate" | "revise";

/** Verdict returned by a feedback hook. */
export type FeedbackVerdict = {
  readonly action: FeedbackAction;
  readonly reason?: string;
};

/** Input to a feedback-hook evaluation. */
export type FeedbackHookInput = {
  readonly runId: string;
  readonly traceId: string;
  readonly outputText: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
};

/**
 * Post-output feedback contract.
 *
 * Called after an agent or orchestrator returns. Implementations may inspect
 * `EvalStore.getHistory()`, trajectory data, or external signals.
 *
 * Stage 25.5 ships `NoopFeedbackHook` as the default. Stage 48 ships
 * `LlmCritiqueLoop`; Stage 49 ships `RLHFFeedbackHook`.
 */
export interface FeedbackHook {
  evaluate(input: FeedbackHookInput): Promise<FeedbackVerdict>;
}
