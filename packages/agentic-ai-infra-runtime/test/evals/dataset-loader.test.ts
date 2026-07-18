import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatasetLoader } from "../../src/evals/dataset-loader.js";

describe("DatasetLoader", () => {
  it("loads and validates a valid dataset", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eval-data-"));
    try {
      writeFileSync(
        join(dir, "good.json"),
        JSON.stringify({
          version: 1,
          name: "test",
          items: [{
            id: "i", question: "q", expectedChunks: [],
            expectedAnswer: "a", expectedToolCalls: []
          }]
        })
      );
      const loader = new DatasetLoader(dir);
      const r = await loader.load("good.json");
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.items).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("rejects path traversal with ..", async () => {
    const loader = new DatasetLoader(tmpdir());
    const r = await loader.load("../etc/passwd");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("evals.dataset-path-traversal");
  });

  it("rejects forward-slash path segments", async () => {
    const loader = new DatasetLoader(tmpdir());
    const r = await loader.load("sub/file.json");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("evals.dataset-path-traversal");
  });

  it("rejects backslash path segments", async () => {
    const loader = new DatasetLoader(tmpdir());
    const r = await loader.load("sub\\file.json");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("evals.dataset-path-traversal");
  });

  it("returns dataset-not-found for missing file", async () => {
    const loader = new DatasetLoader(tmpdir());
    const r = await loader.load("nope.json");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("evals.dataset-not-found");
  });

  it("returns invalid-dataset for invalid JSON", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eval-data-"));
    try {
      writeFileSync(join(dir, "bad.json"), "not-json");
      const loader = new DatasetLoader(dir);
      const r = await loader.load("bad.json");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("evals.invalid-dataset");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
