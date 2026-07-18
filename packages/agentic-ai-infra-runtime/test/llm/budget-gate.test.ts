import { describe, expect, it } from "vitest";
import { DefaultBudgetGate, NoopBudgetGate } from "../../src/llm/budget-gate.js";

describe("DefaultBudgetGate", () => {
  it("allows call at exactly the limit (≤ not <)", () => {
    const gate = new DefaultBudgetGate(0.01);
    const decision = gate.check("anthropic", "claude-haiku-4-5", 0.01);
    expect(decision.allowed).toBe(true);
  });

  it("blocks call over the limit (allowed: false)", () => {
    const gate = new DefaultBudgetGate(0.01);
    const decision = gate.check("anthropic", "claude-haiku-4-5", 0.011);
    expect(decision.allowed).toBe(false);
  });

  it("reason string includes provider, model, and estimated cost when blocked", () => {
    const gate = new DefaultBudgetGate(0.01);
    const decision = gate.check("anthropic", "claude-haiku-4-5", 0.05);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("anthropic");
    expect(decision.reason).toContain("claude-haiku-4-5");
    expect(decision.reason).toContain("0.050000");
  });

  it("throws on construction with maxCostPerCallUsd <= 0", () => {
    expect(() => new DefaultBudgetGate(0)).toThrow();
    expect(() => new DefaultBudgetGate(-1)).toThrow();
  });

  it("allows call exactly at 0 cost when limit is small positive", () => {
    const gate = new DefaultBudgetGate(0.000001);
    const decision = gate.check("mock", "mock-v1", 0);
    expect(decision.allowed).toBe(true);
  });
});

describe("NoopBudgetGate", () => {
  it("always returns allowed: true regardless of cost", () => {
    const gate = new NoopBudgetGate();
    expect(gate.check("anthropic", "claude-opus-4-6", 999.0).allowed).toBe(true);
  });

  it("does not throw for any input including 0 cost", () => {
    const gate = new NoopBudgetGate();
    expect(() => gate.check("any", "any", 0)).not.toThrow();
    expect(() => gate.check("any", "any", -1)).not.toThrow();
  });
});
