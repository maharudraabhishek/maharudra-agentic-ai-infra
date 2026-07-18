import { describe, expect, it } from "vitest";
import { MockLlmProvider } from "../../src/llm/mock-llm-provider.js";

describe("MockLlmProvider", () => {
  it("complete() returns ok: true with deterministic content", async () => {
    const provider = new MockLlmProvider();
    const result = await provider.complete({ prompt: "Hello" });
    expect(result.ok).toBe(true);
  });

  it("complete() content includes prompt length", async () => {
    const provider = new MockLlmProvider();
    const prompt = "Hello world!"; // 12 chars
    const result = await provider.complete({ prompt });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.content).toBe("[mock] received 12 chars");
    }
  });

  it("countTokens('') returns 0", () => {
    const provider = new MockLlmProvider();
    expect(provider.countTokens("")).toBe(0);
  });

  it("countTokens('1234') returns 1", () => {
    const provider = new MockLlmProvider();
    expect(provider.countTokens("1234")).toBe(1);
  });

  it("countTokens(12 chars) returns 3", () => {
    const provider = new MockLlmProvider();
    expect(provider.countTokens("123456789012")).toBe(3);
  });

  it("estimatedCostUsd is 0", async () => {
    const provider = new MockLlmProvider();
    const result = await provider.complete({ prompt: "test" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.estimatedCostUsd).toBe(0);
    }
  });

  it("isLocal is true", () => {
    const provider = new MockLlmProvider();
    expect(provider.isLocal).toBe(true);
  });

  it("model is 'mock-v1'", () => {
    const provider = new MockLlmProvider();
    expect(provider.model).toBe("mock-v1");
  });
});
