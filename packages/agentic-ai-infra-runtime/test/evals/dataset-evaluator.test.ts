import { describe, expect, it } from "vitest";
import type { EvalDataset, RetrievalResult } from "@maharudra/agentic-ai-infra-core";
import { DatasetEvaluator } from "../../src/evals/dataset-evaluator.js";

function makeDataset(itemOverrides: Partial<EvalDataset["items"][number]> = {}): EvalDataset {
  return {
    version: 1,
    name: "test",
    items: [{
      id: "i1",
      question: "q",
      expectedChunks: ["c1"],
      expectedAnswer: "the quick brown fox",
      expectedToolCalls: ["t1"],
      ...itemOverrides
    }]
  };
}

function chunk(id: string): RetrievalResult {
  return {
    providerId: "test",
    sourceId: id,
    score: 1,
    preview: "p",
    metadata: { chunkId: id }
  };
}

describe("DatasetEvaluator", () => {
  it("passes when retrieval, answer, and tools all match", async () => {
    const ds = makeDataset();
    const suite = new DatasetEvaluator(() => ({
      dataset: ds,
      itemInputs: [{
        itemId: "i1",
        retrievedChunks: [chunk("c1")],
        actualAnswer: "the QUICK brown fox jumps",
        actualToolCalls: ["t1"]
      }]
    }));
    const r = await suite.run();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe("passed");
  });

  it("fails retrieval when expected chunk is missing", async () => {
    const ds = makeDataset();
    const suite = new DatasetEvaluator(() => ({
      dataset: ds,
      itemInputs: [{ itemId: "i1", retrievedChunks: [], actualAnswer: "ok", actualToolCalls: ["t1"] }]
    }));
    const r = await suite.run();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe("failed");
  });

  it("substring match is case-insensitive after normalization", async () => {
    const ds = makeDataset();
    const suite = new DatasetEvaluator(() => ({
      dataset: ds,
      itemInputs: [{
        itemId: "i1",
        retrievedChunks: [chunk("c1")],
        actualAnswer: "THE   QUICK\n\nBROWN  FOX",
        actualToolCalls: ["t1"]
      }]
    }));
    const r = await suite.run();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe("passed");
  });

  it("exact match requires byte-equality after trim", async () => {
    const ds = makeDataset({ matchMode: "exact" });
    const suite = new DatasetEvaluator(() => ({
      dataset: ds,
      itemInputs: [{
        itemId: "i1",
        retrievedChunks: [chunk("c1")],
        actualAnswer: "the quick BROWN fox",
        actualToolCalls: ["t1"]
      }]
    }));
    const r = await suite.run();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe("failed");
  });

  it("semantic match is skipped", async () => {
    const ds = makeDataset({ matchMode: "semantic" });
    const suite = new DatasetEvaluator(() => ({
      dataset: ds,
      itemInputs: [{
        itemId: "i1",
        retrievedChunks: [chunk("c1")],
        actualAnswer: "ok",
        actualToolCalls: ["t1"]
      }]
    }));
    const r = await suite.run();
    expect(r.ok).toBe(true);
    if (r.ok) {
      const answerResult = r.value.results.find((x) => x.id === "i1.answer");
      expect(answerResult?.status).toBe("skipped");
    }
  });

  it("missing inputs result in skipped checks, not failures", async () => {
    const ds = makeDataset();
    const suite = new DatasetEvaluator(() => ({ dataset: ds, itemInputs: [] }));
    const r = await suite.run();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.skipped).toBe(3); // retrieval, answer, tools all skipped
      expect(r.value.failed).toBe(0);
    }
  });
});
