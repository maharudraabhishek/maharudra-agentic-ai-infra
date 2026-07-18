import { describe, expect, it } from "vitest";
import { createEmbeddingProvider } from "../../src/retrieval/embedding-factory.js";
import { LocalEmbeddingProvider, MockEmbeddingProvider } from "../../src/retrieval/index.js";
import { MOCK_EMBEDDING_DIMENSION } from "../../src/retrieval/embedding-config.js";

describe("createEmbeddingProvider", () => {
  it('type "mock" returns an instance of MockEmbeddingProvider', () => {
    const result = createEmbeddingProvider({ type: "mock" });
    expect(result instanceof MockEmbeddingProvider).toBe(true);
  });

  it('type "mock" has dimension === MOCK_EMBEDDING_DIMENSION', () => {
    const result = createEmbeddingProvider({ type: "mock" });
    expect(result.dimension).toBe(MOCK_EMBEDDING_DIMENSION);
  });

  it('type "local-http" with all required fields returns a LocalEmbeddingProvider', () => {
    const result = createEmbeddingProvider({
      type: "local-http",
      baseUrl: "http://localhost:11434",
      model: "mxbai-embed-large",
      dimension: 1024
    });
    expect(result instanceof LocalEmbeddingProvider).toBe(true);
    expect(result.model).toBe("mxbai-embed-large");
    expect(result.dimension).toBe(1024);
  });

  it('type "local-http" missing baseUrl throws error containing "baseUrl"', () => {
    expect(() =>
      createEmbeddingProvider({ type: "local-http", model: "mxbai-embed-large", dimension: 1024 })
    ).toThrow(/baseUrl/);
  });

  it('type "local-http" missing model throws error containing "model"', () => {
    expect(() =>
      createEmbeddingProvider({ type: "local-http", baseUrl: "http://localhost:11434", dimension: 1024 })
    ).toThrow(/model/);
  });

  it('type "local-http" missing dimension throws error containing "dimension"', () => {
    expect(() =>
      createEmbeddingProvider({ type: "local-http", baseUrl: "http://localhost:11434", model: "mxbai-embed-large" })
    ).toThrow(/dimension/);
  });

  it('type "custom" throws directing caller to options.embeddingProvider', () => {
    expect(() =>
      createEmbeddingProvider({ type: "custom" })
    ).toThrow(/embeddingProvider/);
  });
});
