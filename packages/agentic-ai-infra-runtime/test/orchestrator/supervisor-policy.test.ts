import { describe, expect, it } from "vitest";
import type { SafeTaskMetadata } from "@maharudra/agentic-ai-infra-core";
import {
  createAgentDefinitionRegistry,
  InMemoryAgentDefinitionRegistry
} from "../../src/agents/registry.js";
import { DefaultSupervisorPolicy } from "../../src/orchestrator/supervisor-policy.js";

const SAFE_TASK: SafeTaskMetadata = {
  taskHash: "task-hash",
  taskType: "implementation"
};

describe("DefaultSupervisorPolicy", () => {
  it("routes to the canonical manager definition by id", () => {
    const registry = createAgentDefinitionRegistry();
    const result = new DefaultSupervisorPolicy().route({ task: SAFE_TASK, registry });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.agents).toHaveLength(1);
    expect(result.value.agents[0]?.id).toBe("manager");
    expect(result.value.composition).toBe("single");
  });

  it("falls back to the first manager-role definition when canonical id is absent", () => {
    const registry = new InMemoryAgentDefinitionRegistry()
      .register({ id: "coordination-lead", role: "manager" })
      .register({ id: "coordination-backup", role: "manager" });
    const result = new DefaultSupervisorPolicy().route({ task: SAFE_TASK, registry });

    expect(registry.findById("manager")).toBeUndefined();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.agents[0]?.id).toBe("coordination-lead");
    expect(result.value.composition).toBe("single");
  });

  it("fails closed when no manager definition is registered", () => {
    const registry = new InMemoryAgentDefinitionRegistry().register({
      id: "security-review",
      role: "security-reviewer"
    });
    const result = new DefaultSupervisorPolicy().route({ task: SAFE_TASK, registry });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("agent.no-manager-registered");
    expect(result.error.severity).toBe("fatal");
  });

  it("returns deterministic plans without mutating the registry", () => {
    const registry = createAgentDefinitionRegistry();
    const policy = new DefaultSupervisorPolicy();
    const countBefore = registry.count();
    const first = policy.route({ task: SAFE_TASK, registry });
    const second = policy.route({ task: SAFE_TASK, registry });

    expect(first).toEqual(second);
    expect(registry.count()).toBe(countBefore);
  });
});
