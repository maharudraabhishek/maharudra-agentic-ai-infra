/**
 * Stage 23 — ContextOptimizer dedup + compression unit tests.
 *
 * Covers:
 * 1. Cosine dedup pass with pre-populated result.embedding
 * 2. Cosine dedup via lazy embed when result.embedding absent (MockEmbeddingProvider)
 * 3. Text Jaccard fallback when no embeddings and no provider
 * 4. Compression pass — low-signal sentences removed, citations preserved
 * 5. Compression disabled — content unchanged
 * 6. Budget loop still enforced after dedup + compression
 * 7. D8 pre-sort regression guard — pre-sort order preserved through passes
 * 8. ContextBuilder.build() returns Promise (async contract)
 */
import { describe, expect, it } from "vitest";
import type { RetrievalResult } from "@maharudra/agentic-ai-infra-core";
import { ContextOptimizer, ContextBuilder } from "../../src/context/index.js";
import { MockEmbeddingProvider } from "../../src/retrieval/index.js";

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
    preview: `Preview content for ${sourceId}`,
    content: `Content for ${sourceId}`,
    tokenEstimate: 20,
    ...overrides
  };
}

/** Creates a 1024-dim unit vector with 1 at position `index` and 0 elsewhere. */
function unitVector(index: number, dim = 1024): readonly number[] {
  return Array.from({ length: dim }, (_, i) => (i === index ? 1 : 0));
}

const defaultPolicy = {
  maxContextTokens: 10000,
  dedupeSources: true,
  preferCitations: true,
  includeSecurityWarnings: true
};

// ---------------------------------------------------------------------------
// 1. Cosine dedup pass with pre-populated embeddings
// ---------------------------------------------------------------------------

describe("cosineSimilarity via ContextOptimizer dedup", () => {
  it("drops near-duplicate result when cosine similarity >= 0.95", async () => {
    const vec = unitVector(0);
    const resultA = makeResult("source-a", { embedding: vec, score: 0.9, sourcePriority: 1.0 });
    const resultB = makeResult("source-b", { embedding: vec, score: 0.5, sourcePriority: 0.5 });

    const optimizer = new ContextOptimizer(defaultPolicy);
    const result = await optimizer.optimize([resultA, resultB]);

    expect(result).toHaveLength(1);
    expect(result[0]!.sourceId).toBe("source-a");
  });

  it("keeps both results when cosine similarity < 0.95", async () => {
    const vecA = unitVector(0); // [1, 0, 0, ...]
    const vecB = unitVector(1); // [0, 1, 0, ...] — orthogonal, cosine = 0
    const resultA = makeResult("source-a", { embedding: vecA });
    const resultB = makeResult("source-b", { embedding: vecB });

    const optimizer = new ContextOptimizer(defaultPolicy);
    const result = await optimizer.optimize([resultA, resultB]);

    expect(result).toHaveLength(2);
  });

  it("drops near-duplicate via lazy embed when result.embedding absent", async () => {
    // Same preview text → MockEmbeddingProvider produces same deterministic vector.
    const sharedPreview = "identical preview text for dedup testing purposes here";
    const resultA = makeResult("source-a", { preview: sharedPreview, score: 0.9, sourcePriority: 1.0 });
    const resultB = makeResult("source-b", { preview: sharedPreview, score: 0.5, sourcePriority: 0.5 });

    const mockProvider = new MockEmbeddingProvider();
    const optimizer = new ContextOptimizer(defaultPolicy, mockProvider);
    const result = await optimizer.optimize([resultA, resultB]);

    expect(result).toHaveLength(1);
    expect(result[0]!.sourceId).toBe("source-a");
  });
});

// ---------------------------------------------------------------------------
// 2. Text Jaccard fallback dedup
// ---------------------------------------------------------------------------

describe("text Jaccard fallback dedup", () => {
  it("deduplicates identical text when no embeddings and no provider", async () => {
    const sharedContent = "the quick brown fox jumps over the lazy dog again and again";
    const resultA = makeResult("source-a", { preview: sharedContent, content: sharedContent, score: 0.9, sourcePriority: 1.0 });
    const resultB = makeResult("source-b", { preview: sharedContent, content: sharedContent, score: 0.5, sourcePriority: 0.5 });

    const optimizer = new ContextOptimizer(defaultPolicy);
    const result = await optimizer.optimize([resultA, resultB]);

    expect(result).toHaveLength(1);
  });

  it("keeps distinct text results when no embeddings available", async () => {
    const resultA = makeResult("source-a", {
      preview: "TypeScript interfaces enable structural typing and compile time checking",
      content: "TypeScript interfaces enable structural typing and compile time checking"
    });
    const resultB = makeResult("source-b", {
      preview: "PostgreSQL pgvector extension allows storing embedding vectors in columns",
      content: "PostgreSQL pgvector extension allows storing embedding vectors in columns"
    });

    const optimizer = new ContextOptimizer(defaultPolicy);
    const result = await optimizer.optimize([resultA, resultB]);

    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 3. Compression pass
// ---------------------------------------------------------------------------

describe("compression pass", () => {
  it("removes low-signal sentences when compressionEnabled is true", async () => {
    // 5 segments: 2 short (Hi., Ok.) + 3 substantive → drop ratio 2/5 = 40% < 60% safety valve
    const content =
      "Hi. This sentence provides substantive technical detail about the retrieval mechanism and how it processes documents. The system also handles edge cases carefully with proper error recovery. Proper indexing strategies are important for search performance. Ok.";
    const resultA = makeResult("source-a", { content, preview: content });

    const optimizer = new ContextOptimizer({ ...defaultPolicy, compressionEnabled: true });
    const result = await optimizer.optimize([resultA]);

    expect(result).toHaveLength(1);
    expect(result[0]!.content).not.toContain("Hi.");
    expect(result[0]!.content).toContain("retrieval mechanism");
  });

  it("preserves citation markers even in short sentences", async () => {
    const content = "[1] short. This is a longer sentence with more substantive detail about the system.";
    const resultA = makeResult("source-a", { content, preview: content });

    const optimizer = new ContextOptimizer({ ...defaultPolicy, compressionEnabled: true });
    const result = await optimizer.optimize([resultA]);

    expect(result).toHaveLength(1);
    expect(result[0]!.content).toContain("[1]");
  });

  it("leaves content unchanged when compressionEnabled is false (default)", async () => {
    const content = "Hi. Ok. Short.";
    const resultA = makeResult("source-a", { content, preview: content });

    const optimizer = new ContextOptimizer({ ...defaultPolicy, compressionEnabled: false });
    const result = await optimizer.optimize([resultA]);

    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe(content);
  });

  it("returns original content when compression would drop > 60%", async () => {
    // All sentences are short (< 6 words) — compression would drop > 60%.
    const content = "Hi. Ok. Yes. No. Sure. Fine.";
    const resultA = makeResult("source-a", { content, preview: content });

    const optimizer = new ContextOptimizer({ ...defaultPolicy, compressionEnabled: true });
    const result = await optimizer.optimize([resultA]);

    expect(result).toHaveLength(1);
    // Safety valve: original returned when drop ratio > 60%
    expect(result[0]!.content).toBe(content);
  });
});

// ---------------------------------------------------------------------------
// 4. Budget enforcement after dedup + compression
// ---------------------------------------------------------------------------

describe("budget enforcement after dedup + compression", () => {
  it("still enforces token budget after dedup and compression passes", async () => {
    const policy = { ...defaultPolicy, maxContextTokens: 80 };
    const results = [
      makeResult("source-a", { tokenEstimate: 50 }),
      makeResult("source-b", { tokenEstimate: 50 }),
      makeResult("source-c", { tokenEstimate: 50 })
    ];

    const optimizer = new ContextOptimizer(policy);
    const result = await optimizer.optimize(results);

    // 80 tokens budget: first result (50) fits, second (50) would exceed 80 — skipped.
    expect(result).toHaveLength(1);
  });

  it("D8 pre-sort regression guard — optimize preserves priority order", async () => {
    const highPriority = makeResult("high-priority", {
      score: 0.3,
      sourcePriority: 1.0,
      tokenEstimate: 10
    });
    const lowPriority = makeResult("low-priority", {
      score: 0.9,
      sourcePriority: 0.5,
      tokenEstimate: 10
    });

    const optimizer = new ContextOptimizer(defaultPolicy);
    // Pass in reverse priority order — optimizer must re-sort by sourcePriority DESC.
    const result = await optimizer.optimize([lowPriority, highPriority]);

    expect(result[0]!.sourceId).toBe("high-priority");
  });
});

// ---------------------------------------------------------------------------
// 5. ContextBuilder async contract
// ---------------------------------------------------------------------------

describe("ContextBuilder.build() is async", () => {
  it("build() returns a Promise", async () => {
    const builder = new ContextBuilder();
    const resultPromise = builder.build({
      task: "test task",
      retrievalResults: [],
      tokenBudget: {
        maxTotalTokens: 4500,
        maxContextTokens: 4000,
        maxResponseTokens: 500
      }
    });

    expect(resultPromise).toBeInstanceOf(Promise);

    const result = await resultPromise;
    expect(result.ok).toBe(true);
  });
});
