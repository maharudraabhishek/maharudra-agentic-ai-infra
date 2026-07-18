import { describe, expect, it } from "vitest";
import * as core from "../src/index.js";
import { validateEvalDataset } from "../src/index.js";

describe("public exports", () => {
  it("exposes side-effect-free contracts and helpers", () => {
    expect(core.DefaultConfigValidator).toBeTypeOf("function");
    expect(core.DefaultProfileResolver).toBeTypeOf("function");
    expect(core.BUILT_IN_PROFILE_NAMES).toContain("minimal");
    expect(core.RETRIEVAL_PROVIDER_TYPES).toContain("pgvector");
    expect(core.RUNTIME_MODES).toContain("local-stdio-mcp");
    expect(typeof validateEvalDataset).toBe("function");
  });
});
