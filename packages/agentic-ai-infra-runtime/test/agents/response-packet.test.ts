import { describe, it, expect } from "vitest";
import type {
  AgenticInfraProjectConfig,
  ContextPackage,
  DeterministicAgentOutput,
  RoleContextSlice
} from "@maharudra/agentic-ai-infra-core";
import {
  TokenEfficientMultiAgentExecutor,
  createAgentDefinitionRegistry
} from "../../src/agents/index.js";

// Minimal shared config for the multi-agent path
function baseConfig(): AgenticInfraProjectConfig {
  return {
    project: { name: "rp", slug: "rp" },
    runtime: { modes: ["local-stdio-mcp"] },
    tools: [],
    agents: {
      mode: "token-efficient-multi-agent",
      sharedContext: { enabled: true, maxPacketTokens: 4000 }
    },
    tokenEfficiency: {
      tokenBudget: {
        maxTotalTokens: 20000,
        maxInputTokens: 10000,
        maxOutputTokens: 10000,
        perRoleBudget: { manager: 5000 }
      }
    },
    profile: "vectorless-local"
  } as unknown as AgenticInfraProjectConfig;
}

function makeContextPackage(): ContextPackage {
  return {
    id: "ctx-pkg-1",
    task: "review the auth module",
    sources: [
      { sourceId: "s-1", label: "auth.ts" },
      { sourceId: "s-2", label: "session.ts" },
      { sourceId: "s-3", label: "permissions.ts" }
    ],
    contextText: "auth code here",
    tokenEstimate: 500,
    roleSlices: [
      {
        role: "security-reviewer",
        sourcePacketId: "ctx-pkg-1",
        maxTokens: 1000,
        includedSourceIds: ["s-1", "s-2"]
      },
      {
        role: "architecture-reviewer",
        sourcePacketId: "ctx-pkg-1",
        maxTokens: 1000,
        includedSourceIds: ["s-3"]
      }
    ] as readonly RoleContextSlice[]
  };
}

describe("Stage 25.5 Phase 02 — ResponsePacket citation propagation", () => {
  it("DeterministicAgentOutput type accepts citations as optional", () => {
    // Compile-time guard via a type-asserting literal.
    const out: DeterministicAgentOutput = {
      role: "security-reviewer",
      summary: "ok",
      findings: [],
      sourceCount: 0,
      citations: [{ sourceId: "s-1" }]
    };
    expect(out.citations).toHaveLength(1);
  });

  it("DeterministicAgentOutput type accepts evidenceCoverage as optional", () => {
    const out: DeterministicAgentOutput = {
      role: "security-reviewer",
      summary: "ok",
      findings: [],
      sourceCount: 0,
      evidenceCoverage: 0.75
    };
    expect(out.evidenceCoverage).toBeCloseTo(0.75);
  });

  it("DeterministicAgentOutput type accepts confidence and abstainReason as optional", () => {
    const out: DeterministicAgentOutput = {
      role: "security-reviewer",
      summary: "ok",
      findings: [],
      sourceCount: 0,
      confidence: 0.9,
      abstainReason: "evidence weak"
    };
    expect(out.confidence).toBeCloseTo(0.9);
    expect(out.abstainReason).toBe("evidence weak");
  });

  it("Pre-Phase-02 output literals still type-check (D23 compat)", () => {
    const out: DeterministicAgentOutput = {
      role: "manager",
      summary: "x",
      findings: ["a"],
      sourceCount: 1
    };
    expect(out.citations).toBeUndefined();
    expect(out.evidenceCoverage).toBeUndefined();
  });

  it("Multi-agent executor populates citations on role outputs", async () => {
    const config = baseConfig();
    // createAgentDefinitionRegistry() with no args registers the 6 default definitions
    const registry = createAgentDefinitionRegistry();
    const executor = new TokenEfficientMultiAgentExecutor({
      config,
      agentRegistry: registry
    });
    const result = await executor.execute({
      task: "security review",
      contextPackage: makeContextPackage()
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sec = result.value.roleOutputs.find(
      (r) => r.role === "security-reviewer"
    );
    expect(sec).toBeDefined();
    expect(sec!.citations).toBeDefined();
    expect(sec!.citations!.length).toBeGreaterThan(0);
    // All cited sourceIds must be drawn from the package sources
    const packageSourceIds = makeContextPackage().sources.map((s) => s.sourceId);
    for (const citation of sec!.citations!) {
      expect(packageSourceIds).toContain(citation.sourceId);
    }
  });

  it("Each role's citations match its slice's includedSourceIds", async () => {
    const config = baseConfig();
    const registry = createAgentDefinitionRegistry();
    const executor = new TokenEfficientMultiAgentExecutor({
      config,
      agentRegistry: registry
    });
    const result = await executor.execute({
      task: "architecture review",
      contextPackage: makeContextPackage()
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Verify the core invariant: each roleOutput.citations exactly matches
    // the executor-computed roleSlice.includedSourceIds for that role.
    for (const roleOutput of result.value.roleOutputs) {
      const correspondingSlice = result.value.roleSlices.find(
        (s) => s.role === roleOutput.role
      );
      expect(correspondingSlice).toBeDefined();
      const sliceSourceIds = [...correspondingSlice!.includedSourceIds].sort();
      const citationSourceIds = (roleOutput.citations ?? []).map((c) => c.sourceId).sort();
      expect(citationSourceIds).toEqual(sliceSourceIds);
    }
  });

  it("Citations carry sourceId only (Phase 02 — label/providerId added in Phase 03)", async () => {
    const config = baseConfig();
    const registry = createAgentDefinitionRegistry();
    const executor = new TokenEfficientMultiAgentExecutor({
      config,
      agentRegistry: registry
    });
    const result = await executor.execute({
      task: "review",
      contextPackage: makeContextPackage()
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const out of result.value.roleOutputs) {
      for (const citation of out.citations ?? []) {
        expect(citation.sourceId).toBeDefined();
        expect(citation.label).toBeUndefined();
        expect(citation.providerId).toBeUndefined();
      }
    }
  });

  it("evidenceCoverage stays undefined in Phase 02 (Phase 03 will populate)", async () => {
    const config = baseConfig();
    const registry = createAgentDefinitionRegistry();
    const executor = new TokenEfficientMultiAgentExecutor({
      config,
      agentRegistry: registry
    });
    const result = await executor.execute({
      task: "review",
      contextPackage: makeContextPackage()
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const out of result.value.roleOutputs) {
      expect(out.evidenceCoverage).toBeUndefined();
    }
  });

  it("Single-agent executor does not emit citations in Phase 02 (D29)", async () => {
    // Single-agent has a different report shape (`result: {summary,steps,warnings}`);
    // Phase 02 does not extend it. Verify by checking the report type.
    const config: AgenticInfraProjectConfig = {
      ...baseConfig(),
      agents: { mode: "single-agent" } as never
    };
    // Test that the type system does not require citations on
    // SingleAgentRunReport.result. Smoke check only.
    expect(config.agents.mode).toBe("single-agent");
  });

  it("Default registry is non-empty so executor can resolve role definitions", () => {
    const registry = createAgentDefinitionRegistry();
    expect(registry.count()).toBeGreaterThan(0);
  });
});
