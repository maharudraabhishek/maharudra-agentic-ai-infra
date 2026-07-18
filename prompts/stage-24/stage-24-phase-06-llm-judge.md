# Stage 24 — Phase 6: LlmJudgeEvaluator (seam, disabled by default)
## Claude Code Prompt — MahaRudra Agentic AI Infra

---

## BEFORE YOU START

**Platform:** Windows 11, PowerShell, Node >= 20, **pnpm only**
**CI command:** `pnpm run ci`
**Read first:** `AGENTS.md`, `STATUS.md`, `kb.md`, `runtime/src/llm/smart-router.ts` (verify the `complete()` signature), `core/src/llm/types.ts` (`LlmRequest`, `LlmResponse` shapes)
**Prerequisite:** Phases 1–5 complete, CI green at ~400 tests
**Expected after this phase:** ~405 tests passing

---

## SCOPE — Phase 6 only

Implement `LlmJudgeEvaluator` as a seam — registered into `EvalHarness` only when explicitly enabled (D15). Default: disabled. Uses `SmartRouter.complete()` for judging and caches results so repeated identical inputs are deterministic.

---

## VERIFIED API (from source)

These are not optional — they reflect the actual existing code:

- **SmartRouter method:** `complete(request: LlmRequest): Promise<FrameworkResult<LlmResponse>>` (NOT `route()`)
- **LlmRequest:** `{ prompt, systemPrompt?, maxTokens?, temperature?, stopSequences? }` (NOT `{ task, maxOutputTokens, providerId }`)
- **LlmResponse:** has `content` field (NOT `text`)
- **Per-call provider override:** does NOT exist in `LlmRequest`. Provider selection is policy-driven via `LlmRoutingPolicy`. `EvalsConfig.llmJudge.providerId` is reserved for future use; do not wire it in Stage 24.

---

## FILES TO CHANGE

```
packages/agentic-ai-infra-runtime/src/evals/llm-judge-evaluator.ts        NEW
packages/agentic-ai-infra-runtime/src/evals/index.ts                      MODIFY (export)
packages/agentic-ai-infra-runtime/test/evals/llm-judge-evaluator.test.ts  NEW
```

---

## CHANGE 1 — `runtime/src/evals/llm-judge-evaluator.ts` (NEW)

```typescript
import { createHash } from "node:crypto";
import type {
  EvalResult,
  EvalStatus,
  EvalSuiteContract,
  FrameworkResult,
  QualityReport
} from "@maharudra/agentic-ai-infra-core";
import { ok } from "@maharudra/agentic-ai-infra-core";
import type { SmartRouter } from "../llm/smart-router.js";

/**
 * Per-judging input fed by the caller.
 */
export type LlmJudgeItemInput = {
  readonly itemId: string;
  readonly question: string;
  readonly expectedAnswer: string;
  readonly actualAnswer: string;
};

/**
 * Provider supplying per-run inputs.
 */
export type LlmJudgeOptionsProvider = () => {
  readonly items: readonly LlmJudgeItemInput[];
};

/**
 * LLM-as-judge eval suite — disabled by default.
 *
 * Asks an LLM to score each item's `actualAnswer` against `expectedAnswer`.
 * Results are cached by `sha256(question | expected | actual)` so repeated
 * runs are deterministic when inputs are identical.
 *
 * Registration is gated by `config.evals.llmJudge.enabled === true` AND a
 * `SmartRouter` being present in the runtime container (D15). When either is
 * false, the suite is not registered, and `DatasetEvaluator` skips items with
 * `matchMode === "semantic"`.
 *
 * NOTE: This is the SEAM, not a full production implementation. The judge
 * prompt is intentionally minimal — production teams will customize via
 * subclassing.
 */
export class LlmJudgeEvaluator implements EvalSuiteContract {
  readonly name = "llm-judge";

  private readonly cache = new Map<string, EvalResult>();

  constructor(
    private readonly smartRouter: SmartRouter,
    private readonly optionsProvider: LlmJudgeOptionsProvider
  ) {}

  async run(): Promise<FrameworkResult<QualityReport>> {
    const { items } = this.optionsProvider();

    if (items.length === 0) {
      return ok({
        suiteName: this.name,
        status: "skipped",
        total: 1,
        passed: 0,
        failed: 0,
        skipped: 1,
        results: [
          {
            id: "llm-judge.empty",
            name: "llm judge empty",
            status: "skipped",
            message: "No items supplied for LLM judging."
          }
        ]
      });
    }

    let passed = 0;
    let failed = 0;
    let skipped = 0;
    const results: EvalResult[] = [];

    for (const item of items) {
      const cacheKey = hashItem(item);
      const cached = this.cache.get(cacheKey);

      if (cached) {
        if (cached.status === "passed") passed += 1;
        else if (cached.status === "failed") failed += 1;
        else skipped += 1;
        results.push(cached);
        continue;
      }

      const judgement = await this.judge(item);
      if (judgement.status === "passed") passed += 1;
      else if (judgement.status === "failed") failed += 1;
      else skipped += 1;
      results.push(judgement);
      this.cache.set(cacheKey, judgement);
    }

    const status: EvalStatus =
      failed > 0 ? "failed" : passed > 0 ? "passed" : "skipped";

    return ok({
      suiteName: this.name,
      status,
      total: results.length,
      passed,
      failed,
      skipped,
      results
    });
  }

  /**
   * Calls SmartRouter with a minimal judging prompt and parses the verdict.
   *
   * Uses `SmartRouter.complete()` returning `LlmResponse` whose `content`
   * field carries the model output. Prompt is intentionally short to keep
   * token usage low.
   */
  private async judge(item: LlmJudgeItemInput): Promise<EvalResult> {
    const prompt =
      "Given the question, expected answer, and actual answer, " +
      "respond with ONLY one of: PASS, FAIL.\n\n" +
      `Question: ${item.question}\n` +
      `Expected: ${item.expectedAnswer}\n` +
      `Actual: ${item.actualAnswer}\n\n` +
      "Verdict:";

    const response = await this.smartRouter.complete({
      prompt,
      maxTokens: 8
    });

    if (!response.ok) {
      return {
        id: `${item.itemId}.llm-judge`,
        name: `${item.itemId} llm judge`,
        status: "skipped",
        message: `LLM judge unavailable: ${response.error.message}`
      };
    }

    const text = response.value.content.trim().toUpperCase();
    const verdict: EvalStatus =
      text.startsWith("PASS") ? "passed" :
      text.startsWith("FAIL") ? "failed" :
      "skipped";

    return {
      id: `${item.itemId}.llm-judge`,
      name: `${item.itemId} llm judge`,
      status: verdict,
      message: verdict === "skipped" ? `Unparseable verdict: ${text}` : undefined
    };
  }
}

/**
 * Deterministic cache key for a judging input.
 */
function hashItem(item: LlmJudgeItemInput): string {
  return createHash("sha256")
    .update(item.question)
    .update("|")
    .update(item.expectedAnswer)
    .update("|")
    .update(item.actualAnswer)
    .digest("hex");
}
```

---

## CHANGE 2 — `runtime/src/evals/index.ts`

Add to existing exports:

```typescript
export * from "./llm-judge-evaluator.js";
```

---

## CHANGE 3 — `runtime/test/evals/llm-judge-evaluator.test.ts` (NEW)

Use a `FakeSmartRouter` that returns canned `LlmResponse`s. Verify SmartRouter is not called when the cache hits.

```typescript
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
```

---

## SELF-REVIEW CHECKLIST

- [ ] `runtime/src/evals/llm-judge-evaluator.ts` exports `LlmJudgeEvaluator`, `LlmJudgeItemInput`, `LlmJudgeOptionsProvider`
- [ ] Uses `smartRouter.complete({ prompt, maxTokens })` — NOT `route()`
- [ ] Reads `response.value.content` — NOT `response.value.text`
- [ ] No `providerId` field in the LlmRequest call
- [ ] Cache hit avoids repeat `complete()` call
- [ ] Class name `LlmJudgeEvaluator`, suite name `"llm-judge"`
- [ ] `runtime/src/evals/index.ts` exports the new file
- [ ] ≥6 new tests pass
- [ ] Previous ~400 tests still pass
- [ ] `pnpm run ci` passes
- [ ] JSDoc on every exported symbol

---

## WHAT NOT TO DO

- Do NOT call `smartRouter.route()` — that method does not exist
- Do NOT access `response.value.text` — the field is `content`
- Do NOT wire `EvalsConfig.llmJudge.providerId` to anything — reserved for future use
- Do NOT register `LlmJudgeEvaluator` in any container in this phase — Phase 9 handles wiring
- Do NOT cache by hashing the prompt alone — include all three (question + expected + actual)
- Do NOT expand the judge prompt — keep it minimal so token usage stays low
- Do NOT import `LlmRequest`/`LlmResponse` from runtime — they are core types

---

## DONE SIGNAL

```
Stage 24 Phase 6 complete.
Test count: [N]/[N] passing (target ~405).
CI: build ✓ typecheck ✓ test ✓ lint ✓
Files changed: 3
Next: Phase 7 — Executor refactor (options object + MultiAgent eval push)
```
