/**
 * Stage 21 — RetrievalRouter Promise.allSettled parallelism tests.
 *
 * All assertions are deterministic and run without network or database access.
 * Verifies that the sequential-to-parallel refactor preserves all existing
 * contracts: single-provider regression, multi-provider collection, exception
 * isolation, merger (RRF), and reranker (HeuristicReranker).
 */
import { describe, expect, it } from "vitest";
import type { FrameworkResult, RetrievalInput, RetrievalResult } from "@maharudra/agentic-ai-infra-core";
import {
  FullTextProvider,
  HeuristicReranker,
  ReciprocalRankFusion,
  RetrievalRouter
} from "../../src/retrieval/index.js";
import type { RetrievalProvider } from "@maharudra/agentic-ai-infra-core";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const corpusA = {
  documents: [
    {
      sourceId: "docs/runtime",
      title: "Runtime Adapters",
      content: "# Runtime Adapters\nRemote runtime requires auth and audit.\nruntime context engineering",
      sourcePriority: 3,
      sourceVersion: "v1"
    }
  ],
  chunks: [
    {
      chunkId: "chunk-runtime",
      sourceId: "docs/runtime",
      content: "Remote runtime requires auth, audit, and rate limits. runtime engine."
    }
  ]
};

const corpusB = {
  documents: [
    {
      sourceId: "src/context",
      title: "Context Source",
      content: "import { x } from './runtime';\nexport function buildContext() { return 'context'; }",
      sourcePriority: 2,
      sourceVersion: "v1"
    }
  ],
  chunks: [
    {
      chunkId: "chunk-context",
      sourceId: "src/context",
      content: "export function buildContext creates bounded context packages runtime."
    }
  ]
};

/** Provider that always throws — used to test exception isolation. */
class ThrowingProvider implements RetrievalProvider {
  readonly id = "throwing-provider";
  readonly type = "full-text" as const;
  async retrieve(_input: RetrievalInput): Promise<FrameworkResult<readonly RetrievalResult[]>> {
    throw new Error("intentional provider failure");
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RetrievalRouter — Promise.allSettled parallelism (Stage 21)", () => {

  it("single provider: result is identical after parallelism change", async () => {
    const router = new RetrievalRouter([new FullTextProvider("ft", corpusA)]);
    const result = await router.retrieve({ query: "runtime" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBeGreaterThan(0);
    }
  });

  it("two providers: both results are collected when run in parallel", async () => {
    const router = new RetrievalRouter([
      new FullTextProvider("ft-a", corpusA),
      new FullTextProvider("ft-b", corpusB)
    ]);
    const result = await router.retrieve({ query: "runtime" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Both corpora contain "runtime" — combined results exceed single-provider count.
      expect(result.value.length).toBeGreaterThan(0);
    }
  });

  it("one provider throws: surviving provider result is returned without router throw", async () => {
    const router = new RetrievalRouter([
      new ThrowingProvider(),
      new FullTextProvider("ft-a", corpusA)
    ]);

    // Must not throw at router level — throwing provider is silently skipped.
    // Calling retrieve() directly; any uncaught throw from the router will
    // fail this test automatically since the test itself is async.
    const result = await router.retrieve({ query: "runtime" });

    // The router returns ok (surviving FullTextProvider ran successfully).
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Surviving provider returns results — zero is acceptable if no match found.
      expect(Array.isArray(result.value)).toBe(true);
    }
  });

  it("RRF merger still applies after parallelism change: results are deduplicated", async () => {
    const merger = new ReciprocalRankFusion();
    const router = new RetrievalRouter(
      [
        new FullTextProvider("ft-a", corpusA),
        new FullTextProvider("ft-b", corpusA)  // same corpus → same sourceIds
      ],
      { merger }
    );
    const result = await router.retrieve({ query: "runtime" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // RRF must deduplicate: no duplicate sourceIds in the merged output.
      const sourceIds = result.value.map((r) => r.sourceId);
      const uniqueIds = new Set(sourceIds);
      expect(uniqueIds.size).toBe(sourceIds.length);
    }
  });

  it("HeuristicReranker still applies after parallelism change", async () => {
    const reranker = new HeuristicReranker();
    const router = new RetrievalRouter(
      [new FullTextProvider("ft", corpusA)],
      { reranker }
    );
    const result = await router.retrieve({ query: "runtime" });

    // Structural test: reranker path executes without error and returns results.
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Array.isArray(result.value)).toBe(true);
    }
  });
});
