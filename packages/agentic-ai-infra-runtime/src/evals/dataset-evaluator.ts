import type {
  EvalDataset,
  EvalDatasetItem,
  EvalResult,
  EvalStatus,
  EvalSuiteContract,
  FrameworkResult,
  QualityReport,
  RetrievalResult
} from "@maharudra/agentic-ai-infra-core";
import { ok } from "@maharudra/agentic-ai-infra-core";

/**
 * Input provided per-item to the dataset evaluator.
 *
 * The evaluator does not run a query itself — Stage 24 keeps it deterministic
 * by accepting pre-computed retrieval and answer data. The caller invokes the
 * retrieval pipeline and the agent run, then feeds the results back.
 */
export type DatasetItemInputs = {
  readonly itemId: string;
  /** Chunks returned by retrieval for this item's question. */
  readonly retrievedChunks?: readonly RetrievalResult[];
  /** Agent's answer text for this item's question. */
  readonly actualAnswer?: string;
  /** Tool ids actually called during the agent run. */
  readonly actualToolCalls?: readonly string[];
};

/**
 * Provider returning the dataset and per-item input data for one suite run.
 */
export type DatasetEvalOptionsProvider = () => {
  readonly dataset: EvalDataset;
  readonly itemInputs?: readonly DatasetItemInputs[];
};

/**
 * `EvalSuiteContract` that scores a dataset against actual run outputs.
 *
 * For each item:
 *   - retrieval check: every `expectedChunks` id appears in `retrievedChunks`
 *   - answer check: `actualAnswer` matches `expectedAnswer` per `matchMode`
 *   - tool-call check: every `expectedToolCalls` id appears in `actualToolCalls`
 *
 * Items with `matchMode === "semantic"` skip the answer check (the
 * `LlmJudgeEvaluator` handles those when enabled).
 *
 * Missing per-item inputs cause that item's checks to be "skipped" rather than
 * "failed" — supports partial evaluations during development.
 */
export class DatasetEvaluator implements EvalSuiteContract {
  readonly name = "dataset-evaluator";

  constructor(private readonly optionsProvider: DatasetEvalOptionsProvider) {}

  async run(): Promise<FrameworkResult<QualityReport>> {
    const { dataset, itemInputs } = this.optionsProvider();
    const inputById = new Map<string, DatasetItemInputs>(
      (itemInputs ?? []).map((entry) => [entry.itemId, entry])
    );

    const results: EvalResult[] = [];
    let passed = 0;
    let failed = 0;
    let skipped = 0;

    for (const item of dataset.items) {
      const input = inputById.get(item.id);
      const itemResults = [
        this.checkRetrieval(item, input),
        this.checkAnswer(item, input),
        this.checkToolCalls(item, input)
      ];

      for (const r of itemResults) {
        results.push(r);
        if (r.status === "passed") passed += 1;
        else if (r.status === "failed") failed += 1;
        else skipped += 1;
      }
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

  private checkRetrieval(item: EvalDatasetItem, input?: DatasetItemInputs): EvalResult {
    if (!input || input.retrievedChunks === undefined) {
      return {
        id: `${item.id}.retrieval`,
        name: `${item.id} retrieval`,
        status: "skipped",
        message: "No retrievedChunks provided."
      };
    }

    // chunkId is the canonical identifier when providers populate metadata;
    // otherwise sourceId is the next-best identifier. Both are stringified.
    const retrievedIds = new Set(
      input.retrievedChunks.map((r) => String(r.metadata?.chunkId ?? r.sourceId))
    );

    const missing = item.expectedChunks.filter((id) => !retrievedIds.has(id));

    if (missing.length > 0) {
      return {
        id: `${item.id}.retrieval`,
        name: `${item.id} retrieval`,
        status: "failed",
        message: `Missing expected chunks: ${missing.join(", ")}.`,
        metrics: { expected: item.expectedChunks.length, missing: missing.length }
      };
    }

    return {
      id: `${item.id}.retrieval`,
      name: `${item.id} retrieval`,
      status: "passed",
      metrics: { expected: item.expectedChunks.length, missing: 0 }
    };
  }

  private checkAnswer(item: EvalDatasetItem, input?: DatasetItemInputs): EvalResult {
    if (!input || input.actualAnswer === undefined) {
      return {
        id: `${item.id}.answer`,
        name: `${item.id} answer`,
        status: "skipped",
        message: "No actualAnswer provided."
      };
    }

    const mode = item.matchMode ?? "substring";

    if (mode === "semantic") {
      return {
        id: `${item.id}.answer`,
        name: `${item.id} answer`,
        status: "skipped",
        message: "Semantic match requires LlmJudgeEvaluator."
      };
    }

    const matched =
      mode === "exact"
        ? input.actualAnswer.trim() === item.expectedAnswer.trim()
        : normalize(input.actualAnswer).includes(normalize(item.expectedAnswer));

    return {
      id: `${item.id}.answer`,
      name: `${item.id} answer`,
      status: matched ? "passed" : "failed",
      message: matched ? undefined : `Answer did not match (mode=${mode}).`
    };
  }

  private checkToolCalls(item: EvalDatasetItem, input?: DatasetItemInputs): EvalResult {
    if (!input || input.actualToolCalls === undefined) {
      return {
        id: `${item.id}.tools`,
        name: `${item.id} tools`,
        status: "skipped",
        message: "No actualToolCalls provided."
      };
    }

    const calledSet = new Set(input.actualToolCalls);
    const missing = item.expectedToolCalls.filter((id) => !calledSet.has(id));

    if (missing.length > 0) {
      return {
        id: `${item.id}.tools`,
        name: `${item.id} tools`,
        status: "failed",
        message: `Missing expected tool calls: ${missing.join(", ")}.`,
        metrics: { expected: item.expectedToolCalls.length, missing: missing.length }
      };
    }

    return {
      id: `${item.id}.tools`,
      name: `${item.id} tools`,
      status: "passed",
      metrics: { expected: item.expectedToolCalls.length, missing: 0 }
    };
  }
}

/**
 * Case-insensitive whitespace normalization for substring matching.
 */
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}
