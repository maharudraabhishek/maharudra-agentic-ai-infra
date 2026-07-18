import type {
  ContextPackage,
  EvalResult,
  EvalStatus,
  QualityReport,
  RetrievalResult
} from "@maharudra/agentic-ai-infra-core";

// ---------------------------------------------------------------------------
// Pass / fail / skip factories (private helpers, re-implemented from evals/index.ts
// because those functions are unexported. IDs here use dots, not dashes, so
// replaceAll("-", " ") leaves them unchanged — this is correct behavior.)
// ---------------------------------------------------------------------------

function passed(id: string, message: string): EvalResult {
  return result(id, "passed", message);
}

function failed(id: string, message: string): EvalResult {
  return result(id, "failed", message);
}

function skipped(id: string, message: string): EvalResult {
  return result(id, "skipped", message);
}

function result(id: string, status: EvalStatus, message: string): EvalResult {
  return { id, name: id.replaceAll("-", " "), status, message };
}

// ---------------------------------------------------------------------------
// Input type
// ---------------------------------------------------------------------------

/**
 * Input for the retrieval quality eval suite.
 *
 * All fields are optional: omitting a field causes the dependent eval to
 * return "skipped" rather than failing. This design allows callers to supply
 * only the signals relevant to their context.
 */
export type RetrievalQualityEvalInput = {
  /** Retrieved results to evaluate. Used by recall, precision, and priority evals. */
  readonly retrievedResults?: readonly RetrievalResult[];
  /** Context package produced by ContextBuilder. Used by groundedness eval. */
  readonly contextPackage?: ContextPackage;
  /** Agent output text to check for citation presence. Used by groundedness eval. */
  readonly outputText?: string;
  /** Chunk IDs expected to appear in retrieval results. Used by recall eval. */
  readonly expectedChunkIds?: readonly string[];
  /**
   * Score threshold below which a result is considered irrelevant.
   * Used by precision eval. Default: 0.3.
   */
  readonly irrelevanceThreshold?: number;
  /** Actual token usage for the retrieval call. Used by budget eval. */
  readonly tokenUsage?: { readonly totalTokens: number };
  /** Maximum allowed tokens. Used by budget eval. */
  readonly tokenBudget?: number;
  /** Tool IDs that were blocked by policy. Used by policy refusal eval. */
  readonly blockedTools?: readonly string[];
  /** Tool IDs that were actually called. Used by policy refusal eval. */
  readonly calledTools?: readonly string[];
};

// ---------------------------------------------------------------------------
// Eval functions
// ---------------------------------------------------------------------------

/**
 * Checks that the agent output text cites at least one source from the context package.
 *
 * Requires both a ContextPackage (with sources) and the agent output text to compare
 * against. Returns "skipped" when either is absent.
 *
 * @param input - RetrievalQualityEvalInput with contextPackage and outputText.
 * @returns EvalResult with id "retrieval.groundedness".
 *
 * @example
 * ```typescript
 * const result = checkGroundedness({ contextPackage: pkg, outputText: agentResponse });
 * ```
 */
export function checkGroundedness(input: RetrievalQualityEvalInput): EvalResult {
  if (!input.contextPackage || !input.outputText) {
    return skipped("retrieval.groundedness", "No contextPackage or outputText was supplied.");
  }

  const sources = input.contextPackage.sources;
  const citedCount = sources.filter((s) => input.outputText!.includes(s.sourceId)).length;

  if (sources.length === 0 && input.outputText.length > 0) {
    return failed(
      "retrieval.groundedness",
      "Context package has no sources but output text is non-empty."
    );
  }

  if (citedCount === 0) {
    return failed(
      "retrieval.groundedness",
      "No context source is cited in the output text."
    );
  }

  return {
    ...passed("retrieval.groundedness", `Output cites ${citedCount} of ${sources.length} sources.`),
    metrics: { citationCount: sources.length, citedInOutput: 1 }
  };
}

/**
 * Checks that all expected chunk IDs appear in the retrieval results.
 *
 * Chunk IDs are resolved from metadata.chunkId when present, falling back
 * to sourceId. Returns "skipped" when expectedChunkIds or retrievedResults are absent.
 *
 * @param input - RetrievalQualityEvalInput with retrievedResults and expectedChunkIds.
 * @returns EvalResult with id "retrieval.recall".
 *
 * @example
 * ```typescript
 * const result = checkRetrievalRecall({
 *   retrievedResults: results,
 *   expectedChunkIds: ["chunk-auth", "chunk-session"]
 * });
 * ```
 */
export function checkRetrievalRecall(input: RetrievalQualityEvalInput): EvalResult {
  if (!input.retrievedResults || !input.expectedChunkIds?.length) {
    return skipped("retrieval.recall", "No retrievedResults or expectedChunkIds were supplied.");
  }

  const retrievedIds = new Set(
    input.retrievedResults.map((r) => String(r.metadata?.chunkId ?? r.sourceId))
  );

  const missing = input.expectedChunkIds.filter((id) => !retrievedIds.has(id));
  const expected = input.expectedChunkIds.length;
  const found = expected - missing.length;

  if (missing.length > 0) {
    return {
      ...failed(
        "retrieval.recall",
        `Missing expected chunks: ${missing.join(", ")}.`
      ),
      metrics: { expected, found, missing: missing.length }
    };
  }

  return {
    ...passed("retrieval.recall", `All ${expected} expected chunks were retrieved.`),
    metrics: { expected, found, missing: 0 }
  };
}

/**
 * Checks that none of the called tools appear in the blocked-tools list.
 *
 * Returns "skipped" when either blockedTools or calledTools is absent or empty.
 *
 * @param input - RetrievalQualityEvalInput with blockedTools and calledTools.
 * @returns EvalResult with id "retrieval.policy-refusal".
 *
 * @example
 * ```typescript
 * const result = checkPolicyRefusal({
 *   blockedTools: ["agentic.write.file"],
 *   calledTools: ["agentic.retrieval.search"]
 * });
 * ```
 */
export function checkPolicyRefusal(input: RetrievalQualityEvalInput): EvalResult {
  if (!input.blockedTools?.length || !input.calledTools?.length) {
    return skipped("retrieval.policy-refusal", "No blockedTools or calledTools were supplied.");
  }

  const blockedSet = new Set(input.blockedTools);
  const violations = input.calledTools.filter((id) => blockedSet.has(id));

  if (violations.length > 0) {
    return {
      ...failed(
        "retrieval.policy-refusal",
        `Blocked tools were called: ${violations.join(", ")}.`
      ),
      metrics: { blockedCount: input.blockedTools.length, violationCount: violations.length }
    };
  }

  return {
    ...passed("retrieval.policy-refusal", "No blocked tools were called."),
    metrics: { blockedCount: input.blockedTools.length, violationCount: 0 }
  };
}

/**
 * Checks that actual token usage is within the configured budget.
 *
 * Returns "skipped" when tokenUsage or tokenBudget is absent.
 *
 * @param input - RetrievalQualityEvalInput with tokenUsage and tokenBudget.
 * @returns EvalResult with id "retrieval.budget-compliance".
 *
 * @example
 * ```typescript
 * const result = checkBudgetCompliance({
 *   tokenUsage: { totalTokens: 1200 },
 *   tokenBudget: 4000
 * });
 * ```
 */
export function checkBudgetCompliance(input: RetrievalQualityEvalInput): EvalResult {
  if (input.tokenUsage === undefined || input.tokenBudget === undefined) {
    return skipped("retrieval.budget-compliance", "No tokenUsage or tokenBudget was supplied.");
  }

  const used = input.tokenUsage.totalTokens;
  const budget = input.tokenBudget;
  const overBy = Math.max(0, used - budget);

  if (used > budget) {
    return {
      ...failed(
        "retrieval.budget-compliance",
        `Token usage ${used} exceeds budget ${budget} (over by ${overBy}).`
      ),
      metrics: { used, budget, overBy }
    };
  }

  return {
    ...passed("retrieval.budget-compliance", `Token usage ${used} is within budget ${budget}.`),
    metrics: { used, budget, overBy: 0 }
  };
}

/**
 * Checks that the proportion of low-score (irrelevant) retrieval results is at most 30%.
 *
 * A result is considered irrelevant if its score is below the threshold (default 0.3).
 * Returns "skipped" when retrievedResults is absent or empty.
 *
 * @param input - RetrievalQualityEvalInput with retrievedResults and optional irrelevanceThreshold.
 * @returns EvalResult with id "retrieval.precision".
 *
 * @example
 * ```typescript
 * const result = checkRetrievalPrecision({
 *   retrievedResults: results,
 *   irrelevanceThreshold: 0.4
 * });
 * ```
 */
export function checkRetrievalPrecision(input: RetrievalQualityEvalInput): EvalResult {
  if (!input.retrievedResults?.length) {
    return skipped("retrieval.precision", "No retrievedResults were supplied.");
  }

  const threshold = input.irrelevanceThreshold ?? 0.3;
  const total = input.retrievedResults.length;
  const irrelevant = input.retrievedResults.filter((r) => r.score < threshold).length;
  const irrelevantFraction = irrelevant / total;

  if (irrelevantFraction > 0.3) {
    return {
      ...failed(
        "retrieval.precision",
        `${irrelevant}/${total} results (${(irrelevantFraction * 100).toFixed(0)}%) are below the irrelevance threshold.`
      ),
      metrics: { total, irrelevant, irrelevantFraction: Number(irrelevantFraction.toFixed(4)) }
    };
  }

  return {
    ...passed(
      "retrieval.precision",
      `Precision acceptable: ${irrelevant}/${total} results are below threshold.`
    ),
    metrics: { total, irrelevant, irrelevantFraction: Number(irrelevantFraction.toFixed(4)) }
  };
}

/**
 * Checks that at least one of the top-5 retrieval results has the globally highest source priority.
 *
 * Uses metadata.sourcePriority for ordering. Returns "skipped" when fewer than 2 results are
 * present (not enough to evaluate ordering).
 *
 * Pass condition: the maximum sourcePriority in results[0..4] equals the maximum across ALL
 * results — i.e., at least one top-5 result is from the highest-priority source.
 *
 * @param input - RetrievalQualityEvalInput with retrievedResults.
 * @returns EvalResult with id "retrieval.source-priority".
 *
 * @example
 * ```typescript
 * const result = checkSourcePriority({ retrievedResults: results });
 * ```
 */
export function checkSourcePriority(input: RetrievalQualityEvalInput): EvalResult {
  if (!input.retrievedResults || input.retrievedResults.length < 2) {
    return skipped("retrieval.source-priority", "Fewer than 2 results — ordering cannot be evaluated.");
  }

  const results = input.retrievedResults;
  const priorities = results.map((r) => Number(r.metadata?.sourcePriority ?? 0));
  const maxPriority = Math.max(...priorities);
  const topFive = priorities.slice(0, 5);
  const topFiveMax = Math.max(...topFive);
  const topFiveCount = topFive.length;
  const topResultPriority = priorities[0] ?? 0;

  if (topFiveMax < maxPriority) {
    const highPriorityIndex = priorities.indexOf(maxPriority);
    return {
      ...failed(
        "retrieval.source-priority",
        `No top-5 result has the highest source priority (${maxPriority}). ` +
          `Highest-priority source appears at index ${highPriorityIndex}.`
      ),
      metrics: { topResultPriority, maxPriority, topFiveCount }
    };
  }

  return {
    ...passed(
      "retrieval.source-priority",
      `Top-5 contains a result with the highest source priority (${maxPriority}).`
    ),
    metrics: { topResultPriority, maxPriority, topFiveCount }
  };
}

// ---------------------------------------------------------------------------
// Suite runner
// ---------------------------------------------------------------------------

/**
 * Runs all retrieval quality eval checks against the supplied input.
 *
 * Eval results default to "skipped" when required input fields are absent.
 * This allows callers to supply only the signals they have available.
 * Full coverage requires all fields to be populated (Stage 24+).
 *
 * @param input - RetrievalQualityEvalInput; all fields are optional.
 * @returns QualityReport with suiteName "retrieval-quality" and 6 eval results.
 *
 * @example
 * ```typescript
 * const report = runRetrievalQualityEvals({
 *   retrievedResults: router.retrieve(...).value,
 *   expectedChunkIds: ["chunk-auth", "chunk-session"],
 *   tokenUsage: { totalTokens: 1200 },
 *   tokenBudget: 4000
 * });
 * ```
 */
export function runRetrievalQualityEvals(
  input: RetrievalQualityEvalInput
): QualityReport {
  const results: EvalResult[] = [
    checkGroundedness(input),
    checkRetrievalRecall(input),
    checkPolicyRefusal(input),
    checkBudgetCompliance(input),
    checkRetrievalPrecision(input),
    checkSourcePriority(input)
  ];

  const failed = results.filter((r) => r.status === "failed").length;
  const skippedCount = results.filter((r) => r.status === "skipped").length;
  const passed = results.filter((r) => r.status === "passed").length;

  return {
    suiteName: "retrieval-quality",
    status: failed > 0 ? "failed" : skippedCount === results.length ? "skipped" : "passed",
    total: results.length,
    passed,
    failed,
    skipped: skippedCount,
    results
  };
}
