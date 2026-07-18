import { describe, expect, it } from "vitest";
import type {
  AgenticInfraProjectConfig,
  ErrorCode,
  LlmConfig
} from "../src/index.js";

describe("LLM error codes in ErrorCode union", () => {
  it("includes llm.provider-unavailable", () => {
    // TypeScript will fail to compile if this assignment is type-invalid.
    const code: ErrorCode = "llm.provider-unavailable";
    expect(code).toBe("llm.provider-unavailable");
  });

  it("includes llm.budget-exceeded", () => {
    const code: ErrorCode = "llm.budget-exceeded";
    expect(code).toBe("llm.budget-exceeded");
  });

  it("includes llm.fallback-exhausted", () => {
    const code: ErrorCode = "llm.fallback-exhausted";
    expect(code).toBe("llm.fallback-exhausted");
  });
});

describe("AgenticInfraProjectConfig accepts llm?: LlmConfig", () => {
  it("allows absent llm field (undefined)", () => {
    // Type-level assertion — if this compiles, the field is correctly optional.
    const config: AgenticInfraProjectConfig = {};
    expect(config.llm).toBeUndefined();
  });

  it("allows a valid LlmConfig", () => {
    const llm: LlmConfig = {
      providers: [
        { id: "local", type: "mock", model: "mock-v1" }
      ],
      routing: {
        preferLocal: true,
        maxCostPerCallUsd: 0.01,
        fallbackChain: ["local"]
      }
    };
    const config: AgenticInfraProjectConfig = { llm };
    expect(config.llm?.providers.length).toBe(1);
  });
});
