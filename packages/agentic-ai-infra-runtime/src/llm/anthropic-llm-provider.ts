import type {
  FrameworkResult,
  LlmProvider,
  LlmRequest,
  LlmResponse
} from "@maharudra/agentic-ai-infra-core";
import { DEFAULT_COST_CATALOG } from "./cost-catalog.js";

/**
 * Expected shape of the Anthropic Messages API response.
 * Only the fields consumed by this provider are typed.
 */
type AnthropicMessagesResponse = {
  readonly content: ReadonlyArray<{ readonly type: string; readonly text: string }>;
  readonly usage: { readonly input_tokens: number; readonly output_tokens: number };
  readonly model: string;
};

/**
 * LLM provider implementation for the Anthropic Messages API.
 *
 * Uses `fetch` — no `@anthropic-ai/sdk` dependency. This keeps the framework
 * free of vendor SDK constraints and avoids paid installs in CI environments.
 *
 * `isLocal = false`: Anthropic is a remote API that incurs real costs per token.
 * All calls are subject to the budget gate before the network request is made.
 *
 * API endpoint: `POST {baseUrl}/v1/messages`
 * Headers: `x-api-key`, `anthropic-version: 2023-06-01`
 *
 * @security The API key value is stored in a private field and must never be
 *   logged, included in spans, or written to any observable output. Use
 *   `AnthropicLlmProvider.fromEnv()` to read the key from an environment
 *   variable; never pass key values through config objects or command-line args.
 *
 * @example
 * ```typescript
 * const result = AnthropicLlmProvider.fromEnv("prod", "claude-haiku-4-5", "ANTHROPIC_API_KEY");
 * if (result.ok) {
 *   const response = await result.value.complete({ prompt: "Summarize this." });
 * }
 * ```
 */
export class AnthropicLlmProvider implements LlmProvider {
  readonly isLocal = false;

  /**
   * @param id - Stable provider identifier.
   * @param model - Anthropic model id (e.g. `"claude-haiku-4-5"`).
   * @param apiKey - Anthropic API key value. Must not be logged.
   * @param baseUrl - API base URL. Default: `https://api.anthropic.com`.
   * @param timeoutMs - Per-call abort timeout in milliseconds. Default: 30 000.
   *
   * @security `apiKey` is a secret value. Never pass it from user-visible config,
   *   env file content, or CLI flags. Read it from `process.env` via `fromEnv()`.
   */
  constructor(
    readonly id: string,
    readonly model: string,
    private readonly apiKey: string,
    private readonly baseUrl: string = "https://api.anthropic.com",
    private readonly timeoutMs: number = 30000
  ) {}

  /**
   * Constructs an `AnthropicLlmProvider` by reading the API key from an
   * environment variable at call time.
   *
   * Returns `{ ok: false }` when the env var is absent or empty so the container
   * wiring in `createRuntimeServiceContainer()` can skip this provider gracefully
   * without failing startup for the whole project.
   *
   * @param id - Stable provider identifier.
   * @param model - Anthropic model id.
   * @param apiKeyEnvVar - Name of the env var holding the API key (e.g. `"ANTHROPIC_API_KEY"`).
   * @param baseUrl - Optional base URL override.
   *
   * @security Only the env var name is stored in config. The key value is read
   *   from `process.env` here and stored only in the private `apiKey` field.
   */
  static fromEnv(
    id: string,
    model: string,
    apiKeyEnvVar: string,
    baseUrl?: string
  ): FrameworkResult<AnthropicLlmProvider> {
    const apiKey = process.env[apiKeyEnvVar];

    if (!apiKey) {
      return {
        ok: false,
        error: {
          code: "llm.provider-unavailable",
          message: `${apiKeyEnvVar} is not set — AnthropicLlmProvider cannot be constructed.`,
          severity: "recoverable"
        }
      };
    }

    return { ok: true, value: new AnthropicLlmProvider(id, model, apiKey, baseUrl) };
  }

  /**
   * Sends a completion request to the Anthropic Messages API.
   *
   * Wraps the fetch in an `AbortController` that fires after `timeoutMs` ms.
   * Each call gets its own controller — aborts do not affect concurrent calls.
   *
   * On HTTP non-200, network error, JSON parse failure, or abort:
   * returns `{ ok: false, error: { code: "llm.provider-unavailable" } }`.
   *
   * @returns `ok: true` with `LlmResponse` on success, `ok: false` on any failure.
   *
   * @security Never logs `this.apiKey`. The key is only used to populate the
   *   `x-api-key` header and is not stored or forwarded elsewhere.
   */
  async complete(request: LlmRequest): Promise<FrameworkResult<LlmResponse>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const body: Record<string, unknown> = {
        model: this.model,
        messages: [{ role: "user", content: request.prompt }],
        // max_tokens is required by the Anthropic API.
        max_tokens: request.maxTokens ?? 1024
      };

      if (request.systemPrompt !== undefined) {
        body["system"] = request.systemPrompt;
      }

      if (request.temperature !== undefined) {
        body["temperature"] = request.temperature;
      }

      if (request.stopSequences !== undefined) {
        body["stop_sequences"] = [...request.stopSequences];
      }

      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // The x-api-key header value is the only place the API key is used.
          // It must not be captured in logs, spans, or error messages.
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        return {
          ok: false,
          error: {
            code: "llm.provider-unavailable",
            message: `Anthropic HTTP ${response.status}: ${response.statusText}`,
            severity: "recoverable"
          }
        };
      }

      const data = await response.json() as AnthropicMessagesResponse;

      const content = data.content[0]?.text ?? "";
      const inputTokens = data.usage.input_tokens;
      const outputTokens = data.usage.output_tokens;
      const estimatedCostUsd = DEFAULT_COST_CATALOG.estimateCost(
        this.id,
        this.model,
        inputTokens,
        outputTokens
      );

      return {
        ok: true,
        value: {
          content,
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
          model: this.model,
          providerId: this.id,
          estimatedCostUsd
        }
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "llm.provider-unavailable",
          message: error instanceof Error ? error.message : "Anthropic request failed.",
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
   * The Anthropic token counting endpoint requires an extra network call.
   * The heuristic is used for Stage 19 budget estimation before the call.
   * Exact token counting via the API is deferred to Stage 24+.
   */
  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
