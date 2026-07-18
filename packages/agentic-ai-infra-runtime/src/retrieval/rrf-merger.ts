import type { RetrievalMerger, RetrievalResult } from "@maharudra/agentic-ai-infra-core";

/**
 * Standard RRF smoothing constant (Cormack, Clarke, Buettcher, 2009).
 *
 * k=60 is the empirically validated default. Higher values reduce the
 * ranking impact of very highly ranked documents, producing a smoother
 * merge when provider scores are on incompatible scales.
 */
export const DEFAULT_RRF_K = 60;

/**
 * ReciprocalRankFusion merges multiple ranked result lists using the RRF
 * formula: `score(d) = Σ 1 / (k + rank(d))`.
 *
 * How it works:
 * 1. For each provider list, every result receives a rank (1-indexed, where
 *    1 is the best result in that list).
 * 2. The RRF contribution for that result in that list is `1 / (k + rank)`.
 * 3. If the same chunk (identified by `sourceId + preview`) appears in
 *    multiple provider lists, its contributions are summed.
 * 4. Results are returned in descending total RRF score order.
 *
 * Why RRF over simple score averaging:
 * - Provider scores are on different scales (ts_rank vs cosine similarity).
 *   Averaging incomparable scales produces misleading results.
 * - RRF only needs rank position, not raw score, so it is robust to scale
 *   differences and outliers.
 * - A document ranked 1st in any list always contributes 1/(k+1) ≈ 0.016,
 *   which dominates documents ranked 60th (1/(k+60) ≈ 0.008).
 *
 * Identity invariant: `merge([[...results]])` preserves original order.
 *
 * @example
 * ```typescript
 * const merger = new ReciprocalRankFusion();
 * const merged = merger.merge([fullTextResults, pgvectorResults]);
 * // merged is deduplicated and ordered by combined RRF score
 * ```
 */
export class ReciprocalRankFusion implements RetrievalMerger {
  private readonly k: number;

  /**
   * Creates a ReciprocalRankFusion merger with the given smoothing constant.
   *
   * @param k - RRF smoothing constant. Must be > 0. Defaults to 60.
   * @throws {Error} when `k <= 0` — a zero or negative constant produces
   *   infinite or negative scores, which violates the merger contract.
   */
  constructor(k = DEFAULT_RRF_K) {
    if (k <= 0) {
      throw new Error(`ReciprocalRankFusion: k must be > 0, got ${k}.`);
    }

    this.k = k;
  }

  /**
   * Merges multiple provider result lists into one deduplicated list ordered
   * by total RRF score descending.
   *
   * Deduplication key: `sourceId:preview`. When the same key appears in
   * multiple lists, RRF scores are summed and the `RetrievalResult` metadata
   * from the first occurrence is preserved in the output.
   *
   * An empty input or all-empty inner lists returns `[]`.
   *
   * @param providerResults - One array per provider. Inner arrays are ranked
   *   lists (index 0 = best result for that provider).
   * @returns Merged list ordered by total RRF score descending.
   */
  merge(providerResults: ReadonlyArray<RetrievalResult[]>): RetrievalResult[] {
    // Map from dedup key → { total RRF score, first-seen RetrievalResult }
    const scoreMap = new Map<string, { rrfScore: number; result: RetrievalResult }>();

    for (const results of providerResults) {
      // Rank is 1-indexed so rank=1 is the highest contribution.
      for (let rank = 1; rank <= results.length; rank++) {
        const result = results[rank - 1];

        if (!result) {
          continue;
        }

        // Dedup key uses sourceId + first 100 chars of preview to collapse
        // identical results that may have slightly different metadata from
        // different providers.
        const key = `${result.sourceId}:${result.preview.slice(0, 100)}`;
        const contribution = 1 / (this.k + rank);
        const existing = scoreMap.get(key);

        if (existing) {
          // Accumulate RRF contributions from additional provider lists.
          existing.rrfScore += contribution;
        } else {
          // First occurrence — capture the result metadata from this provider.
          scoreMap.set(key, { rrfScore: contribution, result });
        }
      }
    }

    // Sort by total RRF score descending.
    return [...scoreMap.values()]
      .sort((a, b) => b.rrfScore - a.rrfScore)
      .map(({ rrfScore, result }) => ({
        ...result,
        // Replace the original provider score with the combined RRF score so
        // downstream consumers (HeuristicReranker, ContextBuilder) receive a
        // single comparable score value.
        score: rrfScore
      }));
  }
}
