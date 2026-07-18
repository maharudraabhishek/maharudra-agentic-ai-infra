import { describe, expect, it } from "vitest";
import type {
  FrameworkResult,
  LlmRequest,
  LlmResponse,
  LlmRoutingPolicy
} from "@maharudra/agentic-ai-infra-core";
import { MockLlmProvider } from "../../src/llm/mock-llm-provider.js";
import { DEFAULT_COST_CATALOG } from "../../src/llm/cost-catalog.js";
import { DefaultBudgetGate, NoopBudgetGate } from "../../src/llm/budget-gate.js";
import { SmartRouter } from "../../src/llm/smart-router.js";

// A FailingMockLlmProvider that always returns llm.provider-unavailable.
// Defined inline per spec — not exported from test-utils.
class FailingMockLlmProvider extends MockLlmProvider {
  override async complete(_request: LlmRequest): Promise<FrameworkResult<LlmResponse>> {
    return {
      ok: false,
      error: {
        code: "llm.provider-unavailable",
        message: "test failure",
        severity: "recoverable"
      }
    };
  }
}

const openPolicy: LlmRoutingPolicy = {
  preferLocal: true,
  maxCostPerCallUsd: 1.0,
  fallbackChain: []
};

function makeRouter(
  providers: InstanceType<typeof MockLlmProvider>[],
  policy: LlmRoutingPolicy = openPolicy
): SmartRouter {
  const budgetGate = new DefaultBudgetGate(policy.maxCostPerCallUsd);
  return new SmartRouter(providers, policy, DEFAULT_COST_CATALOG, budgetGate);
}

describe("SmartRouter.orderedProviders()", () => {
  it("local provider appears first when preferLocal: true", () => {
    const local = new MockLlmProvider("local");  // isLocal = true
    const failing = new FailingMockLlmProvider("remote");

    // Make remote appear non-local by overriding the property.
    Object.defineProperty(failing, "isLocal", { value: false });

    const router = makeRouter([failing, local]);
    const order = router.orderedProviders();
    expect(order[0]?.id).toBe("local");
    expect(order[1]?.id).toBe("remote");
  });

  it("order respects fallbackChain when preferLocal: false", () => {
    const a = new MockLlmProvider("a");
    const b = new MockLlmProvider("b");
    const c = new MockLlmProvider("c");

    const policy: LlmRoutingPolicy = {
      preferLocal: false,
      maxCostPerCallUsd: 1.0,
      fallbackChain: ["c", "a", "b"]
    };
    const router = makeRouter([a, b, c], policy);
    const order = router.orderedProviders().map((p) => p.id);
    expect(order).toEqual(["c", "a", "b"]);
  });
});

describe("SmartRouter.complete()", () => {
  it("returns first provider's result on success", async () => {
    const provider = new MockLlmProvider("p1");
    const router = makeRouter([provider]);
    const result = await router.complete({ prompt: "hello" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.providerId).toBe("p1");
    }
  });

  it("falls through to second provider when first fails", async () => {
    const failing = new FailingMockLlmProvider("fail");
    const ok = new MockLlmProvider("ok");
    const router = makeRouter([failing, ok]);
    const result = await router.complete({ prompt: "hello" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.providerId).toBe("ok");
    }
  });

  it("returns llm.fallback-exhausted when all providers fail", async () => {
    const a = new FailingMockLlmProvider("a");
    const b = new FailingMockLlmProvider("b");
    const router = makeRouter([a, b]);
    const result = await router.complete({ prompt: "hello" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("llm.fallback-exhausted");
    }
  });

  it("budget block returns llm.budget-exceeded immediately and does NOT fall through to next provider", async () => {
    const remote = new MockLlmProvider("remote");
    // Simulate a remote provider with non-zero cost by using a fake model name
    // that the catalog knows and override isLocal to false.
    const alwaysSucceed = new MockLlmProvider("succeed");

    const tinyPolicy: LlmRoutingPolicy = {
      preferLocal: false,
      maxCostPerCallUsd: 0.000001, // 1 micro-dollar limit
      fallbackChain: []
    };

    // Mock a catalog that returns a high cost for "remote"
    const expensiveCatalog = {
      inputCostPerToken: (_pid: string, _m: string) => 0.001,
      outputCostPerToken: (_pid: string, _m: string) => 0.001,
      estimateCost: (_pid: string, _m: string, inp: number, out: number) => (inp + out) * 0.001
    };

    const gate = new DefaultBudgetGate(tinyPolicy.maxCostPerCallUsd);
    const router = new SmartRouter([remote, alwaysSucceed], tinyPolicy, expensiveCatalog, gate);

    const result = await router.complete({ prompt: "hello world" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("llm.budget-exceeded");
    }
  });

  it("local provider with cost 0 is never budget-blocked even when maxCostPerCallUsd is tiny", async () => {
    const local = new MockLlmProvider("local"); // isLocal=true, estimatedCostUsd=0

    const tinyPolicy: LlmRoutingPolicy = {
      preferLocal: true,
      maxCostPerCallUsd: 0.000001,
      fallbackChain: []
    };
    const gate = new DefaultBudgetGate(tinyPolicy.maxCostPerCallUsd);
    // DEFAULT_COST_CATALOG returns 0 for mock/mock-v1
    const router = new SmartRouter([local], tinyPolicy, DEFAULT_COST_CATALOG, gate);

    const result = await router.complete({ prompt: "hello" });
    expect(result.ok).toBe(true);
  });

  it("returns llm.fallback-exhausted when single provider fails", async () => {
    const failing = new FailingMockLlmProvider("only");
    const router = makeRouter([failing]);
    const result = await router.complete({ prompt: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("llm.fallback-exhausted");
    }
  });
});

describe("SmartRouter constructor", () => {
  it("throws when providers list is empty", () => {
    expect(() => new SmartRouter([], openPolicy, DEFAULT_COST_CATALOG, new NoopBudgetGate())).toThrow();
  });
});
