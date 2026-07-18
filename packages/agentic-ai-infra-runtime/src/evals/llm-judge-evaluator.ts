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
