import { describe, expect, it } from "vitest";
import {
  DefaultRemoteSafeToolFilter,
  isRemoteSafeTool,
  type ToolContract
} from "../src/index.js";

const safeTool: ToolContract = {
  id: "catalog-summary",
  name: "Catalog summary",
  description: "Returns bounded business-safe summaries.",
  category: "business-safe",
  riskLevel: "low",
  outputPolicy: {
    remoteSafe: true,
    maxBytes: 4096
  },
  runtimePolicy: {
    allowedModes: ["remote-http-mcp"],
    remoteSafe: true
  }
};

const unsafeTool: ToolContract = {
  id: "shell-runner",
  name: "Shell runner",
  description: "Runs local commands.",
  category: "command",
  riskLevel: "critical",
  outputPolicy: {
    remoteSafe: false
  },
  runtimePolicy: {
    allowedModes: ["remote-http-mcp"],
    remoteSafe: false,
    shellAccess: true
  }
};

describe("remote-safe tool filtering", () => {
  it("accepts bounded business-safe tools", () => {
    expect(isRemoteSafeTool(safeTool)).toBe(true);
  });

  it("rejects local shell and high-risk tools", () => {
    expect(isRemoteSafeTool(unsafeTool)).toBe(false);
  });

  it("filters mixed tool lists", () => {
    expect(new DefaultRemoteSafeToolFilter().filter([safeTool, unsafeTool])).toEqual([
      safeTool
    ]);
  });
});
