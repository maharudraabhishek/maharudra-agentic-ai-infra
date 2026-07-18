import { describe, expect, it } from "vitest";
import { DEFAULT_COST_CATALOG, DefaultCostCatalog } from "../../src/llm/cost-catalog.js";

describe("DefaultCostCatalog", () => {
  it("inputCostPerToken for known anthropic model returns non-zero", () => {
    const catalog = new DefaultCostCatalog();
    const cost = catalog.inputCostPerToken("anthropic", "claude-haiku-4-5");
    expect(cost).toBeGreaterThan(0);
  });

  it("outputCostPerToken for known anthropic model returns non-zero", () => {
    const catalog = new DefaultCostCatalog();
    const cost = catalog.outputCostPerToken("anthropic", "claude-haiku-4-5");
    expect(cost).toBeGreaterThan(0);
  });

  it("inputCostPerToken for unknown model returns 0", () => {
    const catalog = new DefaultCostCatalog();
    expect(catalog.inputCostPerToken("unknown-provider", "unknown-model")).toBe(0);
  });

  it("estimateCost for ollama model returns 0", () => {
    const catalog = new DefaultCostCatalog();
    const cost = catalog.estimateCost("ollama", "llama3.2", 1000, 500);
    expect(cost).toBe(0);
  });

  it("estimateCost for anthropic claude-haiku with 1000 input + 200 output tokens is in sensible USD range", () => {
    const catalog = new DefaultCostCatalog();
    // 1000 * 0.0000008 + 200 * 0.000004 = 0.0008 + 0.0008 = 0.0016 USD
    const cost = catalog.estimateCost("anthropic", "claude-haiku-4-5", 1000, 200);
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(0.01);
  });

  it("DEFAULT_COST_CATALOG is a shared DefaultCostCatalog instance", () => {
    expect(DEFAULT_COST_CATALOG).toBeInstanceOf(DefaultCostCatalog);
  });
});
