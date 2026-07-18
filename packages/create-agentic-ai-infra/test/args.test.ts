import { describe, expect, it } from "vitest";
import { createHelpText, parseCliArgs } from "../src/index.js";

describe("CLI args", () => {
  it("parses init flags", () => {
    const parsed = parseCliArgs([
      "init",
      "--project-name",
      "Demo",
      "--runtime",
      "all",
      "--dry-run"
    ]);

    expect(parsed.command).toBe("init");
    expect(parsed.options.projectName).toBe("Demo");
    expect(parsed.options.runtime).toEqual(["all"]);
    expect(parsed.options.dryRun).toBe(true);
  });

  it("prints help text", () => {
    expect(createHelpText()).toContain("create-agentic-ai-infra init");
  });
});
