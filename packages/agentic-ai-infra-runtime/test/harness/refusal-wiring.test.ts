import { describe, expect, it } from "vitest";
import {
  DefaultProfileResolver,
  ok,
  type AgenticInfraProjectConfig,
  type PermissionGate,
  type ResolvedProjectConfig,
  type ToolContract,
  type ToolExecutionHandler
} from "@maharudra/agentic-ai-infra-core";
import {
  InMemoryAgentDefinitionRegistry,
  SingleAgentExecutor
} from "../../src/agents/index.js";
import {
  AgentHarness,
  DefaultApprovalPolicy,
  DefaultPermissionGate
} from "../../src/harness/index.js";
import { InMemoryTrajectoryRecorder } from "../../src/trajectory/index.js";

function resolved(config: AgenticInfraProjectConfig): ResolvedProjectConfig {
  const result = new DefaultProfileResolver().resolve(config);

  if (!result.ok) {
    throw new Error(result.error.message);
  }

  return result.value;
}

function tool(overrides: Partial<ToolContract> = {}): ToolContract {
  return {
    id: overrides.id ?? "agentic.safe.read",
    name: overrides.name ?? "Safe read",
    description: overrides.description ?? "Bounded safe read tool.",
    category: overrides.category ?? "read",
    riskLevel: overrides.riskLevel ?? "low",
    outputPolicy: {
      remoteSafe: true,
      maxBytes: 2048,
      ...overrides.outputPolicy
    },
    runtimePolicy: {
      allowedModes: ["local-stdio-mcp"],
      remoteSafe: true,
      ...overrides.runtimePolicy
    }
  };
}

const successHandler: ToolExecutionHandler = async (_input, context) =>
  ok({
    toolId: context.tool.id,
    output: { ok: true }
  });

describe("Stage 26 Phase 04 — refusal wiring and agent identity", () => {
  it("checks exact approval after permission policy and preserves the typed refusal", async () => {
    const registry = new InMemoryAgentDefinitionRegistry().register({
      id: "manager",
      role: "manager",
      approvalPolicy: { requiresApproval: true }
    });
    const gate = new DefaultPermissionGate(registry);
    const mutatingTool = tool({
      id: "agentic.write.propose",
      category: "write",
      riskLevel: "high",
      runtimePolicy: {
        allowedModes: ["local-stdio-mcp"],
        mutatesState: true,
        requiresApproval: true
      }
    });

    const decision = gate.decide({
      runtimeMode: "local-stdio-mcp",
      tool: mutatingTool,
      requestedCapability: "write",
      agentId: "manager"
    });

    const harness = new AgentHarness({
      tools: [mutatingTool],
      handlers: new Map([[mutatingTool.id, successHandler]]),
      permissionGate: gate
    });
    const missingApproval = await harness.executeTool({
      toolId: mutatingTool.id,
      runtimeMode: "local-stdio-mcp",
      agentId: "manager",
      agentRole: "manager"
    });
    const approved = await harness.executeTool({
      toolId: mutatingTool.id,
      runtimeMode: "local-stdio-mcp",
      agentId: "manager",
      agentRole: "manager",
      approvalText: `APPROVE_${mutatingTool.id}`
    });

    expect(decision.allowed).toBe(true);
    expect(decision.requiredApproval).toEqual({
      mode: "explicit-approval",
      exactApprovalRequired: true
    });
    expect(missingApproval.ok).toBe(false);
    if (!missingApproval.ok) {
      expect(missingApproval.error.code).toBe("runtime.approval-required");
      expect(missingApproval.error.refusalReason).toBe("approval-required");
    }
    expect(approved.ok).toBe(true);
  });

  it("normalizes sensitive approval policy ids on success and denial", async () => {
    const sensitiveTool = tool({
      id: "agentic.write.propose",
      category: "write",
      riskLevel: "high",
      runtimePolicy: {
        allowedModes: ["local-stdio-mcp"],
        mutatesState: true,
        requiresApproval: true,
        approvalPolicyId: "secret-token-APPROVE_agentic.write.propose"
      }
    });
    const policy = new DefaultApprovalPolicy();
    const approved = policy.check(
      sensitiveTool,
      `APPROVE_${sensitiveTool.id}`
    );
    const trajectory = new InMemoryTrajectoryRecorder();
    const harness = new AgentHarness({
      tools: [sensitiveTool],
      handlers: new Map([[sensitiveTool.id, successHandler]]),
      trajectoryRecorder: trajectory
    });
    const denied = await harness.executeTool({
      toolId: sensitiveTool.id,
      runtimeMode: "local-stdio-mcp"
    });
    const denialEvent = trajectory.list().find((event) => event.stepType === "approval");

    expect(approved.ok).toBe(true);
    if (approved.ok) {
      expect(approved.value.policyId).toBe("tool-exact-approval");
    }
    expect(denied.ok).toBe(false);
    expect(denialEvent?.metadata?.policyId).toBe("tool-exact-approval");
    expect(JSON.stringify(denialEvent)).not.toContain("secret-token");
    expect(JSON.stringify(denialEvent)).not.toContain("APPROVE_agentic");
  });

  it("allows the same approval-gated agent to use a non-mutating tool", () => {
    const registry = new InMemoryAgentDefinitionRegistry().register({
      id: "manager",
      role: "manager",
      approvalPolicy: { requiresApproval: true }
    });
    const gate = new DefaultPermissionGate(registry);

    const decision = gate.decide({
      runtimeMode: "local-stdio-mcp",
      tool: tool(),
      requestedCapability: "read",
      agentId: "manager"
    });

    expect(decision.allowed).toBe(true);
    expect(decision.refusalReason).toBeUndefined();
  });

  it("keeps the approval branch inert without a registry and threads agentId through the harness", async () => {
    const mutatingTool = tool({
      id: "agentic.write.propose",
      category: "write",
      riskLevel: "high",
      runtimePolicy: {
        allowedModes: ["local-stdio-mcp"],
        mutatesState: true,
        requiresApproval: true
      }
    });
    const directDecision = new DefaultPermissionGate().decide({
      runtimeMode: "local-stdio-mcp",
      tool: mutatingTool,
      requestedCapability: "write",
      agentId: "manager"
    });
    let forwardedAgentId: string | undefined;
    const permissionGate: PermissionGate = {
      decide(input) {
        forwardedAgentId = input.agentId;

        return {
          allowed: true,
          reason: "test gate allowed the tool."
        };
      }
    };
    const readTool = tool();
    const harness = new AgentHarness({
      tools: [readTool],
      handlers: new Map([[readTool.id, successHandler]]),
      permissionGate
    });
    const harnessResult = await harness.executeTool({
      toolId: readTool.id,
      runtimeMode: "local-stdio-mcp",
      agentId: "manager"
    });

    expect(directDecision.allowed).toBe(true);
    expect(directDecision.refusalReason).toBeUndefined();
    expect(harnessResult.ok).toBe(true);
    expect(forwardedAgentId).toBe("manager");
  });

  it("returns agent-allowlist when an agent calls a tool outside its allowedTools", () => {
    const registry = new InMemoryAgentDefinitionRegistry().register({
      id: "manager",
      role: "manager",
      allowedTools: ["other.tool"]
    });
    const gate = new DefaultPermissionGate(registry);

    const decision = gate.decide({
      runtimeMode: "local-stdio-mcp",
      tool: tool({ id: "agentic.safe.read" }),
      requestedCapability: "read",
      agentId: "manager"
    });

    expect(decision.allowed).toBe(false);
    expect(decision.refusalReason).toBe("agent-allowlist");
  });

  it("allows a tool that is included in the agent allowedTools", () => {
    const registry = new InMemoryAgentDefinitionRegistry().register({
      id: "manager",
      role: "manager",
      allowedTools: ["agentic.safe.read"]
    });
    const gate = new DefaultPermissionGate(registry);

    const decision = gate.decide({
      runtimeMode: "local-stdio-mcp",
      tool: tool({ id: "agentic.safe.read" }),
      requestedCapability: "read",
      agentId: "manager"
    });

    expect(decision.allowed).toBe(true);
    expect(decision.refusalReason).toBeUndefined();
  });

  it("skips the agent allowlist branch when allowedTools is undefined", () => {
    const registry = new InMemoryAgentDefinitionRegistry().register({
      id: "manager",
      role: "manager"
    });
    const gate = new DefaultPermissionGate(registry);

    const decision = gate.decide({
      runtimeMode: "local-stdio-mcp",
      tool: tool({ id: "agentic.safe.read" }),
      requestedCapability: "read",
      agentId: "manager"
    });

    expect(decision.allowed).toBe(true);
    expect(decision.refusalReason).toBeUndefined();
  });

  it("keeps planning-time allowedTools and execution-time gate decisions aligned", async () => {
    const blockedTool = tool({
      id: "agentic.safe.read",
      category: "read"
    });
    const allowedTool = tool({
      id: "agentic.context.build",
      category: "context"
    });
    const registry = new InMemoryAgentDefinitionRegistry().register({
      id: "manager",
      role: "manager",
      allowedTools: [allowedTool.id]
    });
    const executor = new SingleAgentExecutor({
      config: resolved({
        project: { name: "Allowed Tools", slug: "allowed-tools" },
        profiles: ["minimal"]
      }),
      agentRegistry: registry
    });

    const result = await executor.execute({
      task: "Summarize project status.",
      tools: [blockedTool, allowedTool]
    });
    const gateDecision = new DefaultPermissionGate(registry).decide({
      runtimeMode: "local-stdio-mcp",
      tool: blockedTool,
      requestedCapability: blockedTool.category,
      agentId: "manager"
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.selectedToolIds).toEqual([allowedTool.id]);
    }
    expect(gateDecision.allowed).toBe(false);
    expect(gateDecision.refusalReason).toBe("agent-allowlist");
  });

  it("keeps original permission decisions identical when agentId is absent", () => {
    const registry = new InMemoryAgentDefinitionRegistry().register({
      id: "manager",
      role: "manager",
      approvalPolicy: { requiresApproval: true },
      allowedTools: []
    });
    const legacyGate = new DefaultPermissionGate();
    const registryGate = new DefaultPermissionGate(registry);
    const cases = [
      {
        runtimeMode: "remote-http-mcp" as const,
        tool: tool({ runtimePolicy: { allowedModes: ["local-stdio-mcp"] } }),
        requestedCapability: "read"
      },
      {
        runtimeMode: "local-stdio-mcp" as const,
        tool: tool({ category: "write" }),
        requestedCapability: "write",
        agentRole: "docs-reviewer" as const
      },
      {
        runtimeMode: "local-stdio-mcp" as const,
        tool: tool(),
        requestedCapability: "read"
      }
    ];

    for (const input of cases) {
      expect(registryGate.decide(input)).toEqual(legacyGate.decide(input));
    }
  });
});
