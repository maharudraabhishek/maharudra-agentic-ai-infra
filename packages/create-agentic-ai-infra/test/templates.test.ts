import { describe, expect, it } from "vitest";
import {
  createTemplateContext,
  hasUnresolvedPlaceholders,
  normalizeInitOptions,
  renderTemplates
} from "../src/index.js";

function normalized() {
  const result = normalizeInitOptions({
    projectName: "Demo Project",
    slug: "demo-project",
    profile: "full-agentic-context",
    agentMode: "token-efficient-multi-agent",
    runtime: ["all"],
    retrieval: ["hybrid-all"],
    dashboard: true,
    withDocker: true
  });

  if (!result.ok) {
    throw new Error("Expected valid options.");
  }

  return result.value;
}

describe("template rendering", () => {
  it("replaces template placeholders", () => {
    const options = normalized();
    const context = createTemplateContext(options);

    expect(context.PROJECT_NAME).toBe("Demo Project");
    expect(context.PROFILE).toBe("full-agentic-context");
  });

  it("renders generated output without unresolved placeholders", () => {
    const files = renderTemplates(normalized());

    expect(files.length).toBeGreaterThan(0);
    expect(files.some((file) => file.relativePath === "agentic-ai-infra.config.ts")).toBe(true);

    for (const file of files) {
      expect(hasUnresolvedPlaceholders(file.content), file.relativePath).toBe(false);
    }
  });

  it("uses neutral generated paths", () => {
    const files = renderTemplates(normalized());

    expect(files.map((file) => file.relativePath)).toEqual(
      expect.arrayContaining([
        "tools/agentic/mcp-server/src/server.ts",
        "tools/agentic/mcp-server/src/start.ts",
        "services/agentic-context-service/src/server.ts",
        "services/agentic-context-service/src/start.ts",
        "tools/agentic/mcp-server/src/dashboard.ts",
        "infra/local-dev/ai-context-db/docker-compose.yml",
        "docs/03-agentic-infra/dashboard-runtime.md",
        "docs/03-agentic-infra/README.md",
        ".agents/skills/agentic-project-workflow/SKILL.md"
      ])
    );

    for (const file of files) {
      expect(file.relativePath.toLowerCase()).not.toContain("maharudra");
    }
  });

  it("renders runtime skeletons with explicit start entrypoints", () => {
    const files = renderTemplates(normalized());
    const localServer = files.find(
      (file) => file.relativePath === "tools/agentic/mcp-server/src/server.ts"
    )?.content;
    const localStart = files.find(
      (file) => file.relativePath === "tools/agentic/mcp-server/src/start.ts"
    )?.content;
    const remoteServer = files.find(
      (file) => file.relativePath === "services/agentic-context-service/src/server.ts"
    )?.content;

    expect(localServer).toContain("@maharudra/agentic-ai-infra-runtime");
    expect(localServer).not.toContain("startLocalRuntime(");
    expect(localStart).toContain("startLocalRuntime(");
    expect(remoteServer).toContain("exposeLocalFilesystem: false");
    expect(remoteServer).toContain("allowShell: false");
    expect(remoteServer).not.toContain("RUN_AGENTIC_AI_INFRA_MIGRATIONS");
  });

  it("includes dashboard scripts and package dependency only when selected", () => {
    const enabledFiles = renderTemplates(normalized());
    const enabledPackage = enabledFiles.find(
      (file) => file.relativePath === "tools/agentic/mcp-server/package.json"
    )?.content;
    const disabled = normalizeInitOptions({
      projectName: "No Dashboard",
      slug: "no-dashboard",
      profile: "secure-readonly",
      dashboard: false
    });

    if (!disabled.ok) {
      throw new Error("Expected valid no-dashboard options.");
    }

    const disabledFiles = renderTemplates(disabled.value);
    const disabledPackage = disabledFiles.find(
      (file) => file.relativePath === "tools/agentic/mcp-server/package.json"
    )?.content;
    const disabledConfig = disabledFiles.find(
      (file) => file.relativePath === "agentic-ai-infra.config.ts"
    )?.content;

    expect(enabledPackage).toContain("\"dashboard\": \"node dist/dashboard.js\"");
    expect(enabledPackage).toContain("@maharudra/agentic-ai-infra-dashboard");
    expect(disabledPackage).not.toContain("\"dashboard\":");
    expect(disabledPackage).not.toContain("@maharudra/agentic-ai-infra-dashboard");
    expect(disabledFiles.some((file) => file.relativePath.endsWith("dashboard.ts"))).toBe(false);
    expect(disabledFiles.some((file) => file.relativePath.includes("dashboard"))).toBe(false);
    expect(disabledConfig).not.toContain("\"dashboard\"");
  });

  it("renders dashboard-enabled templates idempotently", () => {
    expect(renderTemplates(normalized())).toEqual(renderTemplates(normalized()));
  });
});
