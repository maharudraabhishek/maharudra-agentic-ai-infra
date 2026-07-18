import { describe, expect, it } from "vitest";
import {
  normalizeInitOptions,
  parseRetrievalStrategies,
  parseRuntimeModes,
  slugifyProjectName,
  validateProjectName,
  validateProjectSlug,
  validateTemplateRelativePath
} from "../src/index.js";

describe("CLI option validation", () => {
  it("validates project names and slugs", () => {
    expect(validateProjectName("Demo Project")).toBe(true);
    expect(validateProjectName("")).toBe(false);
    expect(validateProjectSlug("demo-project")).toBe(true);
    expect(validateProjectSlug("Demo Project")).toBe(false);
    expect(slugifyProjectName("Demo Project!!")).toBe("demo-project");
  });

  it("normalizes runtime and retrieval choices", () => {
    expect(parseRuntimeModes(["all"])).toEqual([
      "local-stdio-mcp",
      "remote-http-mcp",
      "api-service"
    ]);
    expect(parseRetrievalStrategies(["hybrid-all"])).toContain("pgvector");
  });

  it("rejects invalid profiles and unsupported package managers", () => {
    const result = normalizeInitOptions({
      projectName: "Demo",
      slug: "demo",
      profile: "unknown" as never,
      packageManager: "npm" as never
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toEqual(
        expect.arrayContaining(["invalid-profile", "unsupported-package-manager"])
      );
    }
  });

  it("rejects unsafe template paths and Windows traversal", () => {
    expect(validateTemplateRelativePath("docs/03-agentic-infra/README.md")).toBe(true);
    expect(validateTemplateRelativePath("../outside.md")).toBe(false);
    expect(validateTemplateRelativePath("C:\\Users\\example\\file.md")).toBe(false);
  });
});
