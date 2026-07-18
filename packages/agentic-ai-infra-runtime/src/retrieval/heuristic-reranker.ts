import type { Reranker, RetrievalResult } from "@maharudra/agentic-ai-infra-core";

/**
 * Weight and policy configuration for `HeuristicReranker`.
 *
 * All four weight values should sum to 1.0 for the combined adjustment to stay
 * in a predictable range. Non-unit sums are allowed but may produce scores
 * that are harder to interpret. Each component is multiplied by its weight and
 * added to the base score.
 */
export type HeuristicRerankerConfig = {
  /** Per-component weight factors. */
  weights: {
    /** Boost when all query terms appear verbatim in the result content. */
    exactMatchBoost: number;
    /** Boost when `updatedAt` is within `recencyWindowMs` of now. */
    recencyBoost: number;
    /** Boost from the source type priority table. Higher entry = stronger boost. */
    sourceTypePriority: number;
    /** Boost for shallower heading paths. Single-segment paths score highest. */
    headingDepthWeight: number;
  };
  /**
   * Window in milliseconds within which a result is considered recent.
   *
   * Default: 7 days (604_800_000 ms).
   */
  recencyWindowMs: number;
  /**
   * Priority table mapping source type strings to a [0, 1] priority value.
   *
   * Higher values mean higher priority. Sources not present in the table
   * receive a priority of 0 (no boost). Keys should match the `sourceType`
   * field on `RetrievalResult` or simplified tier strings.
   *
   * P2.5 note: add `"pdf"` between `"docs"` and `"code"` when PDF indexing
   * ships (Stage 17B/17C). Do NOT add it before then.
   */
  sourceTypePriority: Record<string, number>;
};

/**
 * Default source-type priority weights.
 *
 * P2.5 hook: `"pdf"` is included here so Stage 17B can activate PDF priority
 * without modifying this file. Do not remove it before P2.5 Stage 17A lands.
 */
export const DEFAULT_SOURCE_PRIORITY_MAP: Record<string, number> = {
  "agents-md":  1.0,
  "docs":       0.8,
  "pdf":        0.75,  // P2.5 hook — reserved, active after Stage 17A
  "code":       0.6,
  "generated":  0.2
};

/** Default configuration matching the documented Stage 18 weights. */
export const DEFAULT_HEURISTIC_CONFIG: HeuristicRerankerConfig = {
  weights: {
    exactMatchBoost:    0.3,
    recencyBoost:       0.2,
    sourceTypePriority: 0.3,
    headingDepthWeight: 0.2
  },
  recencyWindowMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  sourceTypePriority: {
    "agents-md":  1.0,
    "docs":       0.8,
    "code":       0.6,
    "generated":  0.2
  }
};

/**
 * Computes a normalized heuristic adjustment score in [0, 1] for a single
 * retrieval result, independent of the base provider score.
 *
 * The adjustment has four additive components:
 * 1. Exact-match boost — all query terms appear in the content.
 * 2. Recency boost — `updatedAt` is within `recencyWindowMs` of now.
 * 3. Source type priority — from the configurable priority table.
 * 4. Heading depth weight — shallower heading paths score higher.
 *
 * Each component is gated by whether the relevant field is present on the
 * result. Missing fields contribute 0, so older providers that do not set
 * `updatedAt` / `sourceType` / `headingPath` are not penalized — they just
 * do not receive the optional boosts.
 */
function computeAdjustment(
  result: RetrievalResult,
  queryTerms: readonly string[],
  now: number,
  config: HeuristicRerankerConfig
): number {
  let adjustment = 0;

  // 1. Exact-match boost: all query terms must appear in the content (or
  //    preview if content is absent). Term check is case-insensitive.
  if (queryTerms.length > 0) {
    const text = (result.content ?? result.preview).toLowerCase();
    const allPresent = queryTerms.every((term) => text.includes(term.toLowerCase()));

    if (allPresent) {
      adjustment += config.weights.exactMatchBoost;
    }
  }

  // 2. Recency boost: result was updated within the recency window.
  if (result.updatedAt) {
    const updatedMs = Date.parse(result.updatedAt);

    if (!Number.isNaN(updatedMs) && now - updatedMs <= config.recencyWindowMs) {
      adjustment += config.weights.recencyBoost;
    }
  }

  // 3. Source type priority: prefer the pre-resolved result.sourcePriority field
  //    (stamped by RetrievalRouter in Stage 22). Fall back to the table lookup
  //    for providers that set sourceType but predate the field.
  const resolvedPriority =
    result.sourcePriority ??
    (result.sourceType ? (config.sourceTypePriority[result.sourceType] ?? 0) : 0);
  adjustment += config.weights.sourceTypePriority * resolvedPriority;

  // 4. Heading depth weight: single-segment paths score highest; deeper
  //    paths score proportionally less via an inverse-depth formula.
  //    Separator is " > " (space-greater-than-space) — matches the join used
  //    by FullTextProvider and PgVectorProvider when returning results from
  //    Postgres: (row.heading_path ?? []).join(" > ").
  //    headingPath: "Overview" → depth 1 → factor 1.0
  //    headingPath: "Overview > Details" → depth 2 → factor 0.5
  //    headingPath: "Overview > Details > Sub" → depth 3 → factor 0.33
  if (result.headingPath) {
    const depth = result.headingPath.split(" > ").filter(Boolean).length;
    const depthFactor = depth > 0 ? 1 / depth : 0;
    adjustment += config.weights.headingDepthWeight * depthFactor;
  }

  return adjustment;
}

/**
 * HeuristicReranker applies deterministic, configurable heuristics to reorder
 * retrieval results without any model call or network request.
 *
 * The reranker computes a combined score = base_score + adjustment for each
 * result and sorts descending. Equal combined scores preserve stable input
 * order (sort is stable).
 *
 * Needle-in-haystack note: this reranker produces scores that `ContextBuilder`
 * uses for placement ordering. The actual first/last positioning in the
 * context window is `ContextBuilder`'s responsibility, not this class's.
 *
 * @example
 * ```typescript
 * const reranker = new HeuristicReranker();
 * const reranked = reranker.rerank(mergedResults, "retrieval quality testing");
 * // AGENTS.md sources and exact-match results move to the top
 * ```
 */
export class HeuristicReranker implements Reranker {
  private readonly config: HeuristicRerankerConfig;

  /**
   * Creates a HeuristicReranker with the given configuration.
   *
   * Defaults to `DEFAULT_HEURISTIC_CONFIG` when no config is supplied.
   */
  constructor(config: HeuristicRerankerConfig = DEFAULT_HEURISTIC_CONFIG) {
    this.config = config;
  }

  /**
   * Returns a new array of results sorted by combined score descending.
   *
   * The input array is not mutated. Equal combined scores maintain their
   * relative input order (stable sort).
   *
   * @param results - Flat list of results from merger or router.
   * @param query - Original query text for exact-match term scoring.
   */
  rerank(results: RetrievalResult[], query: string): RetrievalResult[] {
    if (results.length === 0) {
      return [];
    }

    // Split query into lowercase terms, excluding empty strings.
    const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const now = Date.now();

    // Build (originalIndex, combinedScore) pairs for stable sort.
    const scored: Array<{ index: number; combined: number }> = results.map((result, index) => ({
      index,
      combined: result.score + computeAdjustment(result, queryTerms, now, this.config)
    }));

    // Sort descending by combined score, then by original index for stability.
    scored.sort((a, b) => b.combined - a.combined || a.index - b.index);

    return scored.map(({ index, combined }) => ({
      ...results[index]!,
      // Update the score field so downstream consumers see the reranked value.
      score: combined
    }));
  }
}
