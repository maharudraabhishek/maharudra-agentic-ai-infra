import { describe, expect, it } from "vitest";
import { validateEvalDataset } from "../src/evals/validator.js";

describe("validateEvalDataset", () => {
  it("accepts an empty v1 dataset", () => {
    const r = validateEvalDataset({ version: 1, name: "x", items: [] });
    expect(r.ok).toBe(true);
  });

  it("rejects missing version", () => {
    const r = validateEvalDataset({ name: "x", items: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("evals.invalid-dataset-version");
  });

  it("rejects wrong version", () => {
    const r = validateEvalDataset({ version: 2, name: "x", items: [] });
    expect(r.ok).toBe(false);
  });

  it("rejects missing name", () => {
    const r = validateEvalDataset({ version: 1, items: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("evals.invalid-dataset");
  });

  it("rejects non-array items", () => {
    const r = validateEvalDataset({ version: 1, name: "x", items: "no" });
    expect(r.ok).toBe(false);
  });

  it("rejects item missing id", () => {
    const r = validateEvalDataset({
      version: 1, name: "x",
      items: [{ question: "q", expectedChunks: [], expectedAnswer: "a", expectedToolCalls: [] }]
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("evals.invalid-dataset-item");
  });

  it("rejects item with non-array expectedChunks", () => {
    const r = validateEvalDataset({
      version: 1, name: "x",
      items: [{ id: "i", question: "q", expectedChunks: "no", expectedAnswer: "a", expectedToolCalls: [] }]
    });
    expect(r.ok).toBe(false);
  });

  it("rejects item with invalid difficulty", () => {
    const r = validateEvalDataset({
      version: 1, name: "x",
      items: [{
        id: "i", question: "q", expectedChunks: [], expectedAnswer: "a", expectedToolCalls: [],
        difficulty: "extreme"
      }]
    });
    expect(r.ok).toBe(false);
  });

  it("rejects item with invalid matchMode", () => {
    const r = validateEvalDataset({
      version: 1, name: "x",
      items: [{
        id: "i", question: "q", expectedChunks: [], expectedAnswer: "a", expectedToolCalls: [],
        matchMode: "fuzzy"
      }]
    });
    expect(r.ok).toBe(false);
  });

  it("rejects item with negative tokenBudget", () => {
    const r = validateEvalDataset({
      version: 1, name: "x",
      items: [{
        id: "i", question: "q", expectedChunks: [], expectedAnswer: "a", expectedToolCalls: [],
        tokenBudget: -1
      }]
    });
    expect(r.ok).toBe(false);
  });

  it("accepts an item with all optional fields", () => {
    const r = validateEvalDataset({
      version: 1, name: "x",
      items: [{
        id: "i", question: "q", expectedChunks: ["c"], expectedAnswer: "a", expectedToolCalls: ["t"],
        tags: ["security"], difficulty: "medium", matchMode: "exact", tokenBudget: 4000,
        metadata: { source: "test", createdAt: "2026-05-22" }
      }]
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.items[0].tags).toEqual(["security"]);
      expect(r.value.items[0].matchMode).toBe("exact");
    }
  });

  it("preserves description when present", () => {
    const r = validateEvalDataset({ version: 1, name: "x", description: "y", items: [] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.description).toBe("y");
  });
});
