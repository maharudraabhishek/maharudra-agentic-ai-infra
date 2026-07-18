/**
 * Stage 21 — Retrieval quality eval suite unit tests.
 *
 * Verifies all 6 eval functions (pass + skip/fail paths) and the suite runner.
 * All assertions are deterministic and require no network or database access.
 */
import { describe, expect, it } from "vitest";
import type { RetrievalResult } from "@maharudra/agentic-ai-infra-core";
import {
  checkBudgetCompliance,
  checkGroundedness,
  checkPolicyRefusal,
  checkRetrievalPrecision,
  checkRetrievalRecall,
  checkSourcePriority,
  runRetrievalQualityEvals
} from "../../src/evals/retrieval-evals.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeResult(overrides: Partial<RetrievalResult> = {}): RetrievalResult {
  return {
    providerId: "ft",
    sourceId: "doc/a",
    score: 0.8,
    preview: "content",
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// checkGroundedness
// ---------------------------------------------------------------------------

describe("checkGroundedness", () => {
  it("skips when contextPackage or outputText is absent", () => {
    const result = checkGroundedness({});
    expect(result.status).toBe("skipped");
  });

  it("passes when outputText contains a sourceId from contextPackage.sources", () => {
    const contextPackage = {
      id: "ctx-1",
      task: "test",
      sources: [{ sourceId: "doc/a", label: "Doc A" }],
      contextText: "some context",
      tokenEstimate: 100
    };
    const result = checkGroundedness({
      contextPackage,
      outputText: "See doc/a for details."
    });
    expect(result.status).toBe("passed");
    expect(result.metrics?.citedInOutput).toBe(1);
  });

  it("fails when no source is cited in outputText", () => {
    const contextPackage = {
      id: "ctx-2",
      task: "test",
      sources: [{ sourceId: "doc/b", label: "Doc B" }],
      contextText: "some context",
      tokenEstimate: 50
    };
    const result = checkGroundedness({
      contextPackage,
      outputText: "This text has no citations."
    });
    expect(result.status).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// checkRetrievalRecall
// ---------------------------------------------------------------------------

describe("checkRetrievalRecall", () => {
  it("skips when expectedChunkIds is absent", () => {
    const result = checkRetrievalRecall({ retrievedResults: [makeResult()] });
    expect(result.status).toBe("skipped");
  });

  it("passes when all expectedChunkIds appear in retrieved results via metadata.chunkId", () => {
    const result = checkRetrievalRecall({
      retrievedResults: [
        makeResult({ metadata: { chunkId: "chunk-auth" } }),
        makeResult({ sourceId: "doc/b", metadata: { chunkId: "chunk-session" } })
      ],
      expectedChunkIds: ["chunk-auth", "chunk-session"]
    });
    expect(result.status).toBe("passed");
    expect(result.metrics?.missing).toBe(0);
  });

  it("fails when a chunk is missing: message includes the missing ID", () => {
    const result = checkRetrievalRecall({
      retrievedResults: [makeResult({ metadata: { chunkId: "chunk-auth" } })],
      expectedChunkIds: ["chunk-auth", "chunk-missing"]
    });
    expect(result.status).toBe("failed");
    expect(result.message).toContain("chunk-missing");
  });
});

// ---------------------------------------------------------------------------
// checkPolicyRefusal
// ---------------------------------------------------------------------------

describe("checkPolicyRefusal", () => {
  it("skips when blockedTools is absent", () => {
    const result = checkPolicyRefusal({ calledTools: ["agentic.retrieval.search"] });
    expect(result.status).toBe("skipped");
  });

  it("passes when calledTools does not intersect blockedTools", () => {
    const result = checkPolicyRefusal({
      blockedTools: ["agentic.write.file"],
      calledTools: ["agentic.retrieval.search"]
    });
    expect(result.status).toBe("passed");
    expect(result.metrics?.violationCount).toBe(0);
  });

  it("fails when calledTools includes a blocked tool: message includes the violation", () => {
    const result = checkPolicyRefusal({
      blockedTools: ["agentic.write.file"],
      calledTools: ["agentic.write.file", "agentic.retrieval.search"]
    });
    expect(result.status).toBe("failed");
    expect(result.message).toContain("agentic.write.file");
  });
});

// ---------------------------------------------------------------------------
// checkBudgetCompliance
// ---------------------------------------------------------------------------

describe("checkBudgetCompliance", () => {
  it("skips when tokenUsage or tokenBudget is absent", () => {
    const result = checkBudgetCompliance({});
    expect(result.status).toBe("skipped");
  });

  it("passes when totalTokens is within budget", () => {
    const result = checkBudgetCompliance({
      tokenUsage: { totalTokens: 1200 },
      tokenBudget: 4000
    });
    expect(result.status).toBe("passed");
  });

  it("fails when totalTokens exceeds budget: message includes both values", () => {
    const result = checkBudgetCompliance({
      tokenUsage: { totalTokens: 5000 },
      tokenBudget: 4000
    });
    expect(result.status).toBe("failed");
    expect(result.message).toContain("5000");
    expect(result.message).toContain("4000");
  });
});

// ---------------------------------------------------------------------------
// checkRetrievalPrecision
// ---------------------------------------------------------------------------

describe("checkRetrievalPrecision", () => {
  it("skips when retrievedResults is absent", () => {
    const result = checkRetrievalPrecision({});
    expect(result.status).toBe("skipped");
  });

  it("passes when fewer than 30% of results are below threshold", () => {
    const result = checkRetrievalPrecision({
      retrievedResults: [
        makeResult({ score: 0.8 }),
        makeResult({ score: 0.7 }),
        makeResult({ score: 0.6 }),
        makeResult({ score: 0.1 })  // 1/4 = 25% irrelevant — below 30% threshold
      ]
    });
    expect(result.status).toBe("passed");
  });

  it("fails when more than 30% of results are below threshold", () => {
    const result = checkRetrievalPrecision({
      retrievedResults: [
        makeResult({ score: 0.8 }),
        makeResult({ score: 0.1 }),
        makeResult({ score: 0.05 }),
        makeResult({ score: 0.02 })  // 3/4 = 75% irrelevant
      ]
    });
    expect(result.status).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// checkSourcePriority
// ---------------------------------------------------------------------------

describe("checkSourcePriority", () => {
  it("skips when fewer than 2 results are provided", () => {
    const result = checkSourcePriority({ retrievedResults: [makeResult()] });
    expect(result.status).toBe("skipped");
  });

  it("passes when top-5 contains a result with the globally highest sourcePriority", () => {
    const result = checkSourcePriority({
      retrievedResults: [
        makeResult({ metadata: { sourcePriority: 5 } }),
        makeResult({ sourceId: "doc/b", metadata: { sourcePriority: 3 } }),
        makeResult({ sourceId: "doc/c", metadata: { sourcePriority: 2 } })
      ]
    });
    expect(result.status).toBe("passed");
    expect(result.metrics?.maxPriority).toBe(5);
  });

  it("fails when no top-5 result has the globally highest sourcePriority", () => {
    // 6 results: top 5 have priority 1, the 6th has priority 10.
    const results = [
      makeResult({ sourceId: "a", metadata: { sourcePriority: 1 } }),
      makeResult({ sourceId: "b", metadata: { sourcePriority: 1 } }),
      makeResult({ sourceId: "c", metadata: { sourcePriority: 1 } }),
      makeResult({ sourceId: "d", metadata: { sourcePriority: 1 } }),
      makeResult({ sourceId: "e", metadata: { sourcePriority: 1 } }),
      makeResult({ sourceId: "f", metadata: { sourcePriority: 10 } })  // only at index 5
    ];
    const result = checkSourcePriority({ retrievedResults: results });
    expect(result.status).toBe("failed");
    expect(result.metrics?.maxPriority).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// runRetrievalQualityEvals — suite runner
// ---------------------------------------------------------------------------

describe("runRetrievalQualityEvals", () => {
  it("returns QualityReport with suiteName 'retrieval-quality'", () => {
    const report = runRetrievalQualityEvals({});
    expect(report.suiteName).toBe("retrieval-quality");
    expect(report.total).toBe(6);
    expect(Array.isArray(report.results)).toBe(true);
    expect(report.results.length).toBe(6);
  });

  it("returns status 'skipped' when all input fields are empty", () => {
    const report = runRetrievalQualityEvals({});
    expect(report.status).toBe("skipped");
    expect(report.skipped).toBe(6);
    expect(report.passed).toBe(0);
    expect(report.failed).toBe(0);
  });
});
