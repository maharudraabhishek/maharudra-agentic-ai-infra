import { describe, it, expect } from "vitest";
import type { RuntimeMode, ToolContract } from "@maharudra/agentic-ai-infra-core";
import { DefaultPermissionGate } from "../../src/harness/index.js";

const baseTool = (overrides: Partial<ToolContract> = {}): ToolContract => ({
  id: "t-1",
  name: "T",
  description: "test",
  category: "read",
  riskLevel: "low",
  outputPolicy: { remoteSafe: true },
  runtimePolicy: { allowedModes: ["local-stdio-mcp"] },
  ...overrides
});

describe("Stage 25.5 Phase 04 — Refusal Taxonomy", () => {
  it("mode-not-allowed populates refusalReason", () => {
    const gate = new DefaultPermissionGate();
    const decision = gate.decide({
      runtimeMode: "remote-http-mcp" as RuntimeMode,
      tool: baseTool({ runtimePolicy: { allowedModes: ["local-stdio-mcp"] } }),
      requestedCapability: "read"
    });
    expect(decision.allowed).toBe(false);
    expect(decision.refusalReason).toBe("mode-not-allowed");
  });

  it("shell-blocked populates refusalReason", () => {
    const gate = new DefaultPermissionGate();
    const decision = gate.decide({
      runtimeMode: "local-stdio-mcp" as RuntimeMode,
      tool: baseTool({
        category: "command",
        runtimePolicy: { allowedModes: ["local-stdio-mcp"], shellAccess: true }
      }),
      requestedCapability: "exec"
    });
    expect(decision.allowed).toBe(false);
    expect(decision.refusalReason).toBe("shell-blocked");
  });

  it("role-floor populates refusalReason", () => {
    const gate = new DefaultPermissionGate();
    const decision = gate.decide({
      runtimeMode: "local-stdio-mcp" as RuntimeMode,
      tool: baseTool({ category: "write", runtimePolicy: { allowedModes: ["local-stdio-mcp"] } }),
      requestedCapability: "write",
      agentRole: "security-reviewer"
    });
    expect(decision.allowed).toBe(false);
    expect(decision.refusalReason).toBe("role-floor");
  });

  it("allowed: true decisions have no refusalReason", () => {
    const gate = new DefaultPermissionGate();
    const decision = gate.decide({
      runtimeMode: "local-stdio-mcp" as RuntimeMode,
      tool: baseTool(),
      requestedCapability: "read"
    });
    expect(decision.allowed).toBe(true);
    expect(decision.refusalReason).toBeUndefined();
  });
});
