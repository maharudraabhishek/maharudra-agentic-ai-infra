import { describe, expect, it } from "vitest";
import {
  ok,
  fail,
  type FrameworkResult,
  type LlmRequest,
  type LlmResponse
} from "@maharudra/agentic-ai-infra-core";
import { LlmJudgeEvaluator } from "../../src/evals/llm-judge-evaluator.js";
import type { SmartRouter } from "../../src/llm/smart-router.js";

class FakeSmartRouter {
  public callCount = 0;
  constructor(private readonly verdict: "PASS" | "FAIL" | "MAYBE" | "FAIL_HTTP") {}

  async complete(_req: LlmRequest): Promise<FrameworkResult<LlmResponse>> {
    this.callCount += 1;
    if (this.verdict === "FAIL_HTTP") {
      return fail({
        code: "llm.provider-unavailable",
        message: "no providers",
        severity: "recoverable"
      });
    }
    return ok({
      content: this.verdict,
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      model: "fake",
      providerId: "fake",
      estimatedCostUsd: 0
    });
  }
}

describe("LlmJudgeEvaluator", () => {
  it("returns skipped when items are empty", async () => {
    const router = new FakeSmartRouter("PASS");
    const suite = new LlmJudgeEvaluator(router as unknown as SmartRouter, () => ({ items: [] }));
    const r = await suite.run();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe("skipped");
  });

  it("returns passed when verdict starts with PASS", async () => {
    const router = new FakeSmartRouter("PASS");
    const suite = new LlmJudgeEvaluator(router as unknown as SmartRouter, () => ({
      items: [{ itemId: "i1", question: "q", expectedAnswer: "a", actualAnswer: "b" }]
    }));
    const r = await suite.run();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe("passed");
  });

  it("returns failed when verdict starts with FAIL", async () => {
    const router = new FakeSmartRouter("FAIL");
    const suite = new LlmJudgeEvaluator(router as unknown as SmartRouter, () => ({
      items: [{ itemId: "i1", question: "q", expectedAnswer: "a", actualAnswer: "b" }]
    }));
    const r = await suite.run();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe("failed");
  });

  it("returns skipped for unparseable verdict", async () => {
    const router = new FakeSmartRouter("MAYBE");
    const suite = new LlmJudgeEvaluator(router as unknown as SmartRouter, () => ({
      items: [{ itemId: "i1", question: "q", expectedAnswer: "a", actualAnswer: "b" }]
    }));
    const r = await suite.run();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe("skipped");
      expect(r.value.results[0].message).toContain("Unparseable");
    }
  });

  it("returns skipped when SmartRouter fails", async () => {
    const router = new FakeSmartRouter("FAIL_HTTP");
    const suite = new LlmJudgeEvaluator(router as unknown as SmartRouter, () => ({
      items: [{ itemId: "i1", question: "q", expectedAnswer: "a", actualAnswer: "b" }]
    }));
    const r = await suite.run();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe("skipped");
      expect(r.value.results[0].message).toContain("LLM judge unavailable");
    }
  });

  it("caches results — repeat identical input does not re-call SmartRouter", async () => {
    const router = new FakeSmartRouter("PASS");
    const item = { itemId: "i1", question: "q", expectedAnswer: "a", actualAnswer: "b" };
    const suite = new LlmJudgeEvaluator(router as unknown as SmartRouter, () => ({ items: [item] }));
    await suite.run();
    await suite.run();
    expect(router.callCount).toBe(1);
  });
});
