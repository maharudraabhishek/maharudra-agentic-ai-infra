import type { EmbeddingProvider, EmbeddingProviderConfig } from "@maharudra/agentic-ai-infra-core";
import { LocalEmbeddingProvider, MockEmbeddingProvider } from "./index.js";

/**
 * Resolves an `EmbeddingProvider` instance from a typed config object.
 *
 * This factory is the single construction point for all config-driven embedding
 * providers. It is called by `createRuntimeServiceContainer` when
 * `config.embedding` is set, and may also be called directly by advanced callers
 * that want to construct a provider from config without starting the runtime.
 *
 * Supported types:
 *
 * | type         | class                  | network | use case              | CI-safe |
 * |--------------|------------------------|---------|------------------------|---------|
 * | `"mock"`     | `MockEmbeddingProvider`| no      | tests, CI, vectorless  | yes     |
 * | `"local-http"` | `LocalEmbeddingProvider` | yes | Ollama/LocalAI/LM Studio | no  |
 * | `"custom"`   | caller-supplied        | n/a     | pass via options       | —       |
 *
 * **Failure behavior:** throws synchronously, not as `FrameworkResult`, because a
 * bad `EmbeddingProviderConfig` is a startup configuration error that must surface
 * immediately — not lazily on the first embed call.
 *
 * **`"custom"` type:** the factory cannot construct a custom provider from config
 * fields alone. Pass the pre-constructed instance via
 * `RuntimeStartOptions.embeddingProvider` instead.
 *
 * @example
 * ```typescript
 * // Ollama with mxbai-embed-large:
 * const provider = createEmbeddingProvider({
 *   type: "local-http",
 *   baseUrl: "http://localhost:11434",
 *   model: "mxbai-embed-large",
 *   dimension: 1024
 * });
 * const result = await provider.embedText("retrieval context");
 * console.log(result.embedding.length); // 1024
 * ```
 *
 * @param config - Typed embedding provider configuration.
 * @returns A ready-to-use `EmbeddingProvider` instance.
 * @throws {Error} When the config is invalid or `type` is `"custom"`.
 */
export function createEmbeddingProvider(config: EmbeddingProviderConfig): EmbeddingProvider {
  switch (config.type) {
    case "mock":
      return new MockEmbeddingProvider();

    case "local-http": {
      // Validate required fields before construction — fail fast at startup.
      const missing: string[] = [];
      if (!config.baseUrl)   missing.push("baseUrl");
      if (!config.model)     missing.push("model");
      if (!config.dimension) missing.push("dimension");

      if (missing.length > 0) {
        throw new Error(
          `createEmbeddingProvider: EmbeddingProviderConfig type "local-http" ` +
          `requires fields: ${missing.join(", ")}. ` +
          `For Ollama with mxbai-embed-large: ` +
          `{ type: "local-http", baseUrl: "http://localhost:11434", ` +
          `model: "mxbai-embed-large", dimension: 1024 }`
        );
      }

      return new LocalEmbeddingProvider({
        baseUrl:   config.baseUrl!,
        model:     config.model!,
        dimension: config.dimension!,
        version:   config.version
        // promptField and embeddingField use LocalEmbeddingProvider defaults
        // ("prompt" and "embedding") — these match the Ollama API defaults.
      });
    }

    case "custom":
      throw new Error(
        `createEmbeddingProvider: EmbeddingProviderConfig type "custom" cannot ` +
        `be constructed from config fields alone. Pass the provider instance ` +
        `directly via RuntimeStartOptions.embeddingProvider instead.`
      );

    default:
      throw new Error(
        `createEmbeddingProvider: unknown EmbeddingProviderConfig type ` +
        `"${(config as EmbeddingProviderConfig).type}".`
      );
  }
}
