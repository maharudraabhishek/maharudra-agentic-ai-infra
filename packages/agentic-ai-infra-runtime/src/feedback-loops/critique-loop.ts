/**
 * Critique Loop seam — Stage 25.5 D41 / D42.
 *
 * `NoopCritiqueLoop` is the default `FeedbackHook` for in-run critique.
 * Stage 48 (Self-Critique) ships `LlmCritiqueLoop` implementing the same
 * interface and injects it via `RuntimeServiceContainerOptions.feedbackHook`.
 *
 * Today this file only ships the no-op. The real critique loop calls an
 * LLM to evaluate output quality and recommend `revise` or `retry`.
 *
 * @umbrella Feedback Loops — in-run
 */
import type {
  FeedbackHook,
  FeedbackHookInput,
  FeedbackVerdict
} from "@maharudra/agentic-ai-infra-core";

/**
 * Default no-op critique loop. Always returns `action: "accept"`.
 */
export class NoopCritiqueLoop implements FeedbackHook {
  async evaluate(_input: FeedbackHookInput): Promise<FeedbackVerdict> {
    return { action: "accept" };
  }
}
