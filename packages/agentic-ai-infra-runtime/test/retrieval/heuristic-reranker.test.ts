/**
 * Stage 18 — HeuristicReranker unit tests.
 *
 * All assertions are deterministic and run without network or database access.
 * Tests verify that each scoring component fires correctly when its data is
 * present, and that absent data does not penalize results.
 */
import { describe, expect, it } from "vitest";
import type { RetrievalResult } from "@maharudra/agentic-ai-infra-core";
import {
  DEFAULT_HEURISTIC_CONFIG,
  HeuristicReranker
} from "../../src/retrieval/heuristic-reranker.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(
  sourceId: string,
  overrides: Partial<RetrievalResult> = {}
): RetrievalResult {
  return {
    providerId: "test-provider",
    sourceId,
    score: 0.5,
    preview: `content from ${sourceId}`,
    content: `content from ${sourceId}`,
    ...overrides
  };
}

/** ISO timestamp for a date within the default 7-day recency window. */
function recentTs(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // 1 day ago
}

/** ISO timestamp older than the default 7-day recency window. */
function staleTs(): string {
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days ago
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("HeuristicReranker — Stage 18", () => {

  it("empty input returns []", () => {
    const reranker = new HeuristicReranker();
    expect(reranker.rerank([], "query")).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const reranker = new HeuristicReranker();
    const a = makeResult("a", { score: 0.8 });
    const b = makeResult("b", { score: 0.2 });
    const input = [a, b];
    const result = reranker.rerank(input, "query");

    // Input order unchanged
    expect(input[0]!.sourceId).toBe("a");
    expect(input[1]!.sourceId).toBe("b");
    // Output is a new array
    expect(result).not.toBe(input);
  });

  it("agents-md source scores above code source", () => {
    const reranker = new HeuristicReranker();
    const agents = makeResult("AGENTS.md", { score: 0.5, sourceType: "agents-md" });
    const code   = makeResult("src/index.ts", { score: 0.5, sourceType: "code" });

    const result = reranker.rerank([code, agents], "context design");

    expect(result[0]!.sourceId).toBe("AGENTS.md");
    expect(result[1]!.sourceId).toBe("src/index.ts");
  });

  it("docs source scores above generated source", () => {
    const reranker = new HeuristicReranker();
    const docs      = makeResult("docs/guide.md", { score: 0.5, sourceType: "docs" });
    const generated = makeResult("dist/config.js", { score: 0.5, sourceType: "generated" });

    const result = reranker.rerank([generated, docs], "architecture");

    expect(result[0]!.sourceId).toBe("docs/guide.md");
  });

  it("exact match query term boosts score", () => {
    const reranker = new HeuristicReranker();
    const withMatch    = makeResult("a.ts", { score: 0.5, content: "retrieval quality testing abc" });
    const withoutMatch = makeResult("b.ts", { score: 0.5, content: "something completely different" });

    const result = reranker.rerank([withoutMatch, withMatch], "retrieval quality testing");

    expect(result[0]!.sourceId).toBe("a.ts");
  });

  it("result with updatedAt within window scores above stale result", () => {
    const reranker = new HeuristicReranker();
    const fresh = makeResult("fresh.md", { score: 0.5, updatedAt: recentTs() });
    const stale = makeResult("stale.md", { score: 0.5, updatedAt: staleTs() });

    const result = reranker.rerank([stale, fresh], "query");

    expect(result[0]!.sourceId).toBe("fresh.md");
  });

  // DECISION: headingPath separator is " > " (space-greater-than-space).
  // Confirmed from FullTextProvider and PgVectorProvider join format:
  // (row.heading_path ?? []).join(" > "). HeuristicReranker splits on " > "
  // so "Overview > Details > Sub-section > Edge-case" yields depth 4.
  it("shallower headingPath scores above deep path", () => {
    const reranker = new HeuristicReranker();
    const shallow = makeResult("doc.md", { score: 0.5, headingPath: "Overview" });
    const deep    = makeResult("doc2.md", { score: 0.5, headingPath: "Overview > Details > Sub-section > Edge-case" });

    const result = reranker.rerank([deep, shallow], "overview");

    expect(result[0]!.sourceId).toBe("doc.md");
  });

  it("all-equal scores preserve stable order (no arbitrary shuffle)", () => {
    const reranker = new HeuristicReranker();
    const a = makeResult("a.ts", { score: 0.5 });
    const b = makeResult("b.ts", { score: 0.5 });
    const c = makeResult("c.ts", { score: 0.5 });

    const result = reranker.rerank([a, b, c], "query with no matches");

    // No adjustments fire (no sourceType, no updatedAt, no headingPath, no
    // exact-match content). Stable sort preserves original order.
    expect(result[0]!.sourceId).toBe("a.ts");
    expect(result[1]!.sourceId).toBe("b.ts");
    expect(result[2]!.sourceId).toBe("c.ts");
  });

  it("reranked results have updated score field (combined value)", () => {
    const reranker = new HeuristicReranker();
    const result = makeResult("agents.md", { score: 0.5, sourceType: "agents-md" });
    const out = reranker.rerank([result], "query");

    // Combined score should be > base score due to sourceType boost
    expect(out[0]!.score).toBeGreaterThan(0.5);
  });

  it("DEFAULT_HEURISTIC_CONFIG weights sum to 1.0", () => {
    const { weights } = DEFAULT_HEURISTIC_CONFIG;
    const sum =
      weights.exactMatchBoost +
      weights.recencyBoost +
      weights.sourceTypePriority +
      weights.headingDepthWeight;

    expect(sum).toBeCloseTo(1.0);
  });

  it("result with no optional fields is not penalized — score equals base", () => {
    const reranker = new HeuristicReranker();
    const bare = makeResult("plain.ts", { score: 0.7 });
    const out = reranker.rerank([bare], "xyz-no-match");

    // No adjustments fire — combined score equals base
    expect(out[0]!.score).toBeCloseTo(0.7);
  });
});
