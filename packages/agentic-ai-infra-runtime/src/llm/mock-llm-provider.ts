import type {
  FrameworkResult,
  LlmProvider,
  LlmRequest,
  LlmResponse
} from "@maharudra/agentic-ai-infra-core";

/**
 * Deterministic LLM provider for testing and CI.
 *
 * `complete()` never makes a network call. Returns a fixed response string
 * that includes the prompt length so tests can assert round-trip fidelity
 * without hardcoding model output.
 *
 * `countTokens()` uses the 4-char heuristic (`Math.ceil(text.length / 4)`).
 *
 * `estimatedCostUsd` is always 0 — mock is never blocked by the budget gate.
 * `isLocal` is always true — mock is always preferred over remote providers
 * when `preferLocal: true` in the routing policy.
 *
 * @example
 * ```typescript
 * const provider = new MockLlmProvider("test-mock");
 * const result = await provider.complete({ prompt: "hello world" });
 * // result.value.content === "[mock] received 11 chars"
 * ```
 */
export class MockLlmProvider implements LlmProvider {
  readonly model = "mock-v1";
  readonly isLocal = true;

  /**
   * Creates a MockLlmProvider.
   *
   * @param id - Stable provider id. Defaults to "mock".
   */
  constructor(readonly id: string = "mock") {}

  /**
   * Returns a deterministic response without any network call.
   *
   * Content format: `"[mock] received N chars"` where N is the prompt length.
   * This lets tests assert round-trip fidelity by checking prompt length
   * rather than exact model output.
   *
   * @returns Always `ok: true` — MockLlmProvider never fails.
   */
  async complete(request: LlmRequest): Promise<FrameworkResult<LlmResponse>> {
    const content = `[mock] received ${request.prompt.length} chars`;
    const inputTokens = this.countTokens(request.prompt);
    const outputTokens = this.countTokens(content);

    return {
      ok: true,
      value: {
        content,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        model: this.model,
        providerId: this.id,
        estimatedCostUsd: 0
      }
    };
  }

  /**
   * Estimates token count using the 4-char heuristic.
   *
   * Returns `Math.ceil(text.length / 4)`. This is the same heuristic used by
   * OllamaLlmProvider and AnthropicLlmProvider for Stage 19 budget estimation.
   */
  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
