import { describe, expect, it, vi, afterEach } from "vitest";
import { LocalEmbeddingProvider } from "../../src/retrieval/index.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeProvider(): LocalEmbeddingProvider {
  return new LocalEmbeddingProvider({
    baseUrl: "http://localhost:11434",
    model: "mxbai-embed-large",
    dimension: 1024
  });
}

function stubFetch(body: unknown, status = 200): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(body)
  }));
}

describe("LocalEmbeddingProvider — response format detection", () => {
  it("flat Ollama format { embedding: [...] } is parsed correctly", async () => {
    stubFetch({ embedding: new Array(1024).fill(0.1) });
    const provider = makeProvider();
    const result = await provider.embedText("test query");
    expect(result.embedding.length).toBe(1024);
    expect(result.model).toBe("mxbai-embed-large");
  });

  it("OpenAI-compat nested { data: [{ embedding: [...] }] } is parsed correctly", async () => {
    stubFetch({ data: [{ embedding: new Array(1024).fill(0.1) }] });
    const provider = makeProvider();
    const result = await provider.embedText("test query");
    expect(result.embedding.length).toBe(1024);
  });

  it("network error throws with 'network error' in message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));
    const provider = makeProvider();
    await expect(provider.embedText("test")).rejects.toThrow(/network error/i);
  });

  it("HTTP 500 response throws with status in message", async () => {
    stubFetch({}, 500);
    const provider = makeProvider();
    await expect(provider.embedText("test")).rejects.toThrow(/500/);
  });

  it("missing embedding field in both flat and nested paths throws descriptive message", async () => {
    stubFetch({ unrelated: "value" });
    const provider = makeProvider();
    await expect(provider.embedText("test")).rejects.toThrow(/embedding/);
  });

  it("dimension mismatch throws mentioning both expected and actual dimensions", async () => {
    stubFetch({ embedding: new Array(768).fill(0.1) });
    const provider = makeProvider();
    await expect(provider.embedText("test")).rejects.toThrow(/768/);
    await expect(provider.embedText("test")).rejects.toThrow(/1024/);
  });
});
