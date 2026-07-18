import { describe, expect, it } from "vitest";
import { RetrievalQualitySuite } from "../../src/evals/retrieval-quality-suite.js";

describe("RetrievalQualitySuite", () => {
  it("has the name 'retrieval-quality'", () => {
    const suite = new RetrievalQualitySuite(() => ({}));
    expect(suite.name).toBe("retrieval-quality");
  });

  it("calls the input provider on each run", async () => {
    let calls = 0;
    const suite = new RetrievalQualitySuite(() => {
      calls += 1;
      return {};
    });
    await suite.run();
    await suite.run();
    expect(calls).toBe(2);
  });

  it("returns a QualityReport with suiteName from the wrapped runner", async () => {
    const suite = new RetrievalQualitySuite(() => ({}));
    const result = await suite.run();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.suiteName).toBe("retrieval-quality");
      expect(result.value.total).toBeGreaterThan(0);
    }
  });
});
