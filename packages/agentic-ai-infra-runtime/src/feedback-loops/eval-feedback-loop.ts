/**
 * Eval-Feedback Loop seam — Stage 25.5 D41 / D42.
 *
 * Cross-run feedback hook that consults `EvalStore.getHistory()` to decide
 * whether to accept, retry, escalate, or revise. The seam is wired today;
 * Stage 49 (RLHF) ships the LLM-backed implementation that actually
 * analyzes the history.
 *
 * `NoopEvalFeedbackLoop` is the default. It is a separate class from
 * `NoopCritiqueLoop` because:
 * 1. `RuntimeServiceContainer.feedbackHook` is a single slot today;
 *    Stage 49 will likely introduce a second slot. Two classes ready
 *    now means two slots ready later without renaming.
 * 2. Real cross-run and in-run hooks have different latency budgets and
 *    different cancellation semantics. Separating them at the class level
 *    keeps the future split clean.
 *
 * @umbrella Feedback Loops — cross-run
 */
import type {
  EvalStore,
  FeedbackHook,
  FeedbackHookInput,
  FeedbackVerdict
} from "@maharudra/agentic-ai-infra-core";

/**
 * Default no-op cross-run feedback loop. Accepts every output.
 *
 * @param evalStore - Reserved for the Stage 49 implementation; the no-op
 *   does not read it. The parameter is on the constructor so the wiring
 *   in `createRuntimeServiceContainer` can supply it today.
 */
export class NoopEvalFeedbackLoop implements FeedbackHook {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(private readonly evalStore?: EvalStore) {}

  async evaluate(_input: FeedbackHookInput): Promise<FeedbackVerdict> {
    return { action: "accept" };
  }
}
