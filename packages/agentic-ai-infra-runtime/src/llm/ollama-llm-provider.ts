import type {
  FrameworkResult,
  LlmProvider,
  LlmRequest,
  LlmResponse
} from "@maharudra/agentic-ai-infra-core";

/**
 * Expected shape of the Ollama `/api/generate` non-streaming response.
 * `stream: false` is mandatory in the request body to get this shape.
 */
type OllamaGenerateResponse = {
  readonly model: string;
  readonly response: string;
  readonly done: boolean;
  /** Output token count. May be absent in older Ollama versions. */
  readonly eval_count?: number;
  /** Input token count. May be absent in older Ollama versions. */
  readonly prompt_eval_count?: number;
};

/**
 * LLM provider implementation for local Ollama instances.
 *
 * Uses the Ollama HTTP API (`POST /api/generate`) with `stream: false` to
 * get a single JSON response. No Ollama SDK — this provider uses `fetch`
 * only, so it works in any Node.js 18+ context without extra dependencies.
 *
 * `isLocal = true`: Ollama runs on the developer machine and incurs zero cost.
 * It is always budget-gate-safe regardless of the configured `maxCostPerCallUsd`.
 *
 * Timeout: an `AbortController` cancels the fetch after `timeoutMs` (default
 * 30 000 ms). Each call gets its own controller — aborts do not affect other
 * concurrent calls.
 *
 * @example
 * ```typescript
 * const provider = new OllamaLlmProvider("local", "llama3.2");
 * const result = await provider.complete({ prompt: "Explain RAG in one sentence." });
 * ```
 */
export class OllamaLlmProvider implements LlmProvider {
  readonly isLocal = true;

  /**
   * @param id - Stable provider identifier.
   * @param model - Ollama model tag (e.g. `"llama3.2"`, `"mistral"`).
   * @param baseUrl - Ollama server base URL. Default: `http://localhost:11434`.
   * @param timeoutMs - Per-call abort timeout in milliseconds. Default: 30 000.
   */
  constructor(
    readonly id: string,
    readonly model: string,
    private readonly baseUrl: string = "http://localhost:11434",
    private readonly timeoutMs: number = 30000
  ) {}

  /**
   * Sends a completion request to the Ollama `/api/generate` endpoint.
   *
   * Uses `stream: false` so the response is a single JSON object rather than
   * an NDJSON stream. Wraps the fetch in an `AbortController` that fires after
   * `timeoutMs` ms to prevent indefinite hangs.
   *
   * On any network error, HTTP non-200, JSON parse failure, or abort:
   * returns `{ ok: false, error: { code: "llm.provider-unavailable" } }`.
   *
   * @returns `ok: true` with `LlmResponse` on success, `ok: false` on any failure.
   */
  async complete(request: LlmRequest): Promise<FrameworkResult<LlmResponse>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const body: Record<string, unknown> = {
        model: this.model,
        prompt: request.prompt,
        stream: false,
        options: {
          ...(request.temperature !== undefined && { temperature: request.temperature }),
          ...(request.maxTokens !== undefined && { num_predict: request.maxTokens }),
          ...(request.stopSequences !== undefined && { stop: [...request.stopSequences] })
        }
      };

      if (request.systemPrompt !== undefined) {
        body["system"] = request.systemPrompt;
      }

      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        return {
          ok: false,
          error: {
            code: "llm.provider-unavailable",
            message: `Ollama HTTP ${response.status}: ${response.statusText}`,
            severity: "recoverable"
          }
        };
      }

      const data = await response.json() as OllamaGenerateResponse;

      // Ollama reports token counts in eval_count / prompt_eval_count.
      // Fall back to the heuristic when the fields are absent (older versions).
      const outputTokens = data.eval_count ?? this.countTokens(data.response);
      const inputTokens = data.prompt_eval_count ??
        this.countTokens(request.prompt + (request.systemPrompt ?? ""));

      return {
        ok: true,
        value: {
          content: data.response,
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
          model: this.model,
          providerId: this.id,
          // Ollama runs locally — zero cost regardless of model.
          estimatedCostUsd: 0
        }
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "llm.provider-unavailable",
          message: error instanceof Error ? error.message : "Ollama request failed.",
          severity: "recoverable"
        }
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Estimates token count using the 4-char heuristic.
   *
   * The Ollama tokenize endpoint exists but is not stable across model
   * versions. The heuristic is used for Stage 19 budget estimation.
   * Exact token counting is deferred to Stage 24+.
   */
  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
