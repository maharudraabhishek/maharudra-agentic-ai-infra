/**
 * Stage 18 — ReciprocalRankFusion unit tests.
 *
 * All assertions are deterministic and run without network or database access.
 * The RRF formula is verified by comparing relative score magnitudes and
 * deduplication behavior rather than exact floating-point values.
 */
import { describe, expect, it } from "vitest";
import type { RetrievalResult } from "@maharudra/agentic-ai-infra-core";
import { DEFAULT_RRF_K, ReciprocalRankFusion } from "../../src/retrieval/rrf-merger.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(sourceId: string, preview: string, score = 0): RetrievalResult {
  return {
    providerId: "test-provider",
    sourceId,
    score,
    preview,
    content: preview
  };
}

const A = makeResult("src/a.ts", "export function alpha");
const B = makeResult("src/b.ts", "export function beta");
const C = makeResult("src/c.ts", "export function gamma");
const D = makeResult("src/d.ts", "export function delta");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ReciprocalRankFusion — Stage 18", () => {

  it("empty input returns []", () => {
    const merger = new ReciprocalRankFusion();
    expect(merger.merge([])).toEqual([]);
  });

  it("all-empty inner lists returns []", () => {
    const merger = new ReciprocalRankFusion();
    expect(merger.merge([[], []])).toEqual([]);
  });

  it("single provider list preserves order by RRF score (rank 1 scores highest)", () => {
    const merger = new ReciprocalRankFusion();
    const result = merger.merge([[A, B, C]]);

    expect(result.length).toBe(3);
    // rank 1 (A) → 1/(60+1) ≈ 0.0164
    // rank 2 (B) → 1/(60+2) ≈ 0.0161
    // rank 3 (C) → 1/(60+3) ≈ 0.0159
    expect(result[0]!.sourceId).toBe("src/a.ts");
    expect(result[1]!.sourceId).toBe("src/b.ts");
    expect(result[2]!.sourceId).toBe("src/c.ts");
  });

  it("merge([[a, b, c], [b, c, d]]) deduplicates by chunkId", () => {
    const merger = new ReciprocalRankFusion();
    const result = merger.merge([[A, B, C], [B, C, D]]);

    // 4 unique chunks: A, B, C, D
    expect(result.length).toBe(4);
    const ids = result.map((r) => r.sourceId);
    expect(ids).toContain("src/a.ts");
    expect(ids).toContain("src/b.ts");
    expect(ids).toContain("src/c.ts");
    expect(ids).toContain("src/d.ts");
  });

  it("result count is <= union of all input chunkIds", () => {
    const merger = new ReciprocalRankFusion();
    const result = merger.merge([[A, B], [B, C], [C, D]]);
    // Union = {A, B, C, D} = 4 unique items
    expect(result.length).toBeLessThanOrEqual(4);
    expect(result.length).toBe(4);
  });

  it("rank 1 in any list always scores higher than rank 60 in the same list", () => {
    const merger = new ReciprocalRankFusion();
    // Build a list of 60 items; first item is rank 1, last is rank 60
    const bigList: RetrievalResult[] = Array.from({ length: 60 }, (_, i) =>
      makeResult(`src/file${i}.ts`, `content ${i}`)
    );
    const result = merger.merge([bigList]);

    // First result should be rank-1 (highest RRF score)
    expect(result[0]!.sourceId).toBe("src/file0.ts");
    // Rank 1 score: 1/(60+1) ≈ 0.0164 > 1/(60+60) = 0.0083 (rank 60)
    expect(result[0]!.score).toBeGreaterThan(result[59]!.score);
  });

  it("duplicate in multiple lists sums its RRF scores (higher than single-list rank-1)", () => {
    const merger = new ReciprocalRankFusion();
    // B appears as rank 1 in both lists — should accumulate two contributions
    const list1 = [B, A];  // B at rank 1, A at rank 2
    const list2 = [B, C];  // B at rank 1, C at rank 2
    const result = merger.merge([list1, list2]);

    // B's total: 1/(60+1) + 1/(60+1) = 2/(61) ≈ 0.0328
    // A's total: 1/(60+2) = 0.0161
    // C's total: 1/(60+2) = 0.0161
    expect(result[0]!.sourceId).toBe("src/b.ts");
    expect(result[0]!.score).toBeGreaterThan(result[1]!.score);
  });

  it("k=0 is disallowed — throws on construction", () => {
    expect(() => new ReciprocalRankFusion(0)).toThrow(/k must be > 0/);
  });

  it("negative k is disallowed — throws on construction", () => {
    expect(() => new ReciprocalRankFusion(-5)).toThrow(/k must be > 0/);
  });

  it("DEFAULT_RRF_K is 60", () => {
    expect(DEFAULT_RRF_K).toBe(60);
  });

  it("custom k changes relative score magnitudes", () => {
    const merger60 = new ReciprocalRankFusion(60);
    const merger1  = new ReciprocalRankFusion(1);

    const r60 = merger60.merge([[A, B]]);
    const r1  = merger1.merge([[A, B]]);

    // k=1: rank-1 gets 1/(1+1)=0.5, rank-2 gets 1/(1+2)≈0.333
    // k=60: rank-1 gets 1/(60+1)≈0.0164, rank-2 gets 1/(60+2)≈0.0161
    // In both cases rank-1 > rank-2, but magnitudes differ
    expect(r1[0]!.score).toBeGreaterThan(r60[0]!.score);
    expect(r1[0]!.sourceId).toBe(r60[0]!.sourceId); // both pick A as first
  });
});
