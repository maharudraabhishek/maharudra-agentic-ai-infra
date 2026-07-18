import { describe, expect, it } from "vitest";
import type {
  AgentDefinition,
  AgentProfile,
  AgentRole
} from "@maharudra/agentic-ai-infra-core";
import {
  DEFAULT_AGENT_DEFINITIONS,
  InMemoryAgentDefinitionRegistry,
  createAgentDefinitionRegistry
} from "../../src/agents/registry.js";

describe("InMemoryAgentDefinitionRegistry — registration validation", () => {
  it("throws when id is empty", () => {
    const registry = new InMemoryAgentDefinitionRegistry();
    expect(() =>
      registry.register({ id: "", role: "manager" })
    ).toThrow(/non-empty string/);
  });

  it("throws when id is whitespace only", () => {
    const registry = new InMemoryAgentDefinitionRegistry();
    expect(() =>
      registry.register({ id: "   ", role: "manager" })
    ).toThrow(/non-empty string/);
  });

  it("throws when role is not a valid AgentRole", () => {
    const registry = new InMemoryAgentDefinitionRegistry();
    // Cast through unknown because TS would otherwise refuse to type-check
    // a bogus role literal. Runtime guard catches what compile-time may miss.
    const bogus = { id: "x", role: "ceo" as unknown as AgentRole };
    expect(() => registry.register(bogus)).toThrow(
      /agent\.definition-invalid-role/
    );
  });

  it("throws on duplicate id", () => {
    const registry = new InMemoryAgentDefinitionRegistry();
    registry.register({ id: "dup", role: "manager" });
    expect(() =>
      registry.register({ id: "dup", role: "security-reviewer" })
    ).toThrow(/agent\.definition-duplicate-id/);
  });

  it("returns this for chaining", () => {
    const registry = new InMemoryAgentDefinitionRegistry();
    const returned = registry
      .register({ id: "a", role: "manager" })
      .register({ id: "b", role: "security-reviewer" });
    expect(returned).toBe(registry);
    expect(registry.count()).toBe(2);
  });
});

describe("InMemoryAgentDefinitionRegistry — lookup", () => {
  it("list() returns definitions in insertion order", () => {
    const registry = new InMemoryAgentDefinitionRegistry()
      .register({ id: "first", role: "manager" })
      .register({ id: "second", role: "security-reviewer" })
      .register({ id: "third", role: "docs-reviewer" });

    const ids = registry.list().map((d) => d.id);
    expect(ids).toEqual(["first", "second", "third"]);
  });

  it("findById returns the registered definition", () => {
    const def: AgentDefinition = {
      id: "specific",
      role: "security-reviewer",
      allowedTools: ["agentic.retrieval.search"],
      budgetPolicy: { maxTokens: 1500 }
    };
    const registry = new InMemoryAgentDefinitionRegistry().register(def);
    const found = registry.findById("specific");
    expect(found).toEqual(def);
  });

  it("findById returns undefined for unknown id", () => {
    const registry = new InMemoryAgentDefinitionRegistry().register({
      id: "exists",
      role: "manager"
    });
    expect(registry.findById("missing")).toBeUndefined();
  });

  it("findByRole returns all matching definitions in insertion order", () => {
    const registry = new InMemoryAgentDefinitionRegistry()
      .register({ id: "sec-a", role: "security-reviewer" })
      .register({ id: "mgr", role: "manager" })
      .register({ id: "sec-b", role: "security-reviewer" });

    const ids = registry.findByRole("security-reviewer").map((d) => d.id);
    expect(ids).toEqual(["sec-a", "sec-b"]);
  });

  it("findByRole returns empty array when no match", () => {
    const registry = new InMemoryAgentDefinitionRegistry().register({
      id: "x",
      role: "manager"
    });
    expect(registry.findByRole("security-reviewer")).toEqual([]);
  });

  it("count reflects the registered total", () => {
    const registry = new InMemoryAgentDefinitionRegistry();
    expect(registry.count()).toBe(0);
    registry.register({ id: "a", role: "manager" });
    expect(registry.count()).toBe(1);
    registry.register({ id: "b", role: "security-reviewer" });
    expect(registry.count()).toBe(2);
  });
});

describe("createAgentDefinitionRegistry — factory", () => {
  it("registers the six default definitions when no profiles supplied", () => {
    const registry = createAgentDefinitionRegistry();
    expect(registry.count()).toBe(6);
    expect(registry.findById("manager")).toBeDefined();
    expect(registry.findById("architecture-reviewer")).toBeDefined();
    expect(registry.findById("security-reviewer")).toBeDefined();
    expect(registry.findById("implementation-planner")).toBeDefined();
    expect(registry.findById("eval-reviewer")).toBeDefined();
    expect(registry.findById("docs-reviewer")).toBeDefined();
  });

  it("default definitions carry no policy fields (backwards-compat — D23)", () => {
    const registry = createAgentDefinitionRegistry();
    for (const def of registry.list()) {
      expect(def.allowedTools).toBeUndefined();
      expect(def.budgetPolicy).toBeUndefined();
      expect(def.evalRules).toBeUndefined();
      expect(def.modelPolicy).toBeUndefined();
      expect(def.retrievalPolicy).toBeUndefined();
      expect(def.memoryPolicy).toBeUndefined();
      expect(def.approvalPolicy).toBeUndefined();
    }
  });

  it("caller profile overrides default with same id", () => {
    const callerProfile: AgentProfile = {
      id: "manager",
      role: "manager",
      description: "Custom manager",
      maxContextTokens: 12000
    };
    const registry = createAgentDefinitionRegistry([callerProfile]);
    expect(registry.count()).toBe(6);
    const found = registry.findById("manager");
    expect(found?.description).toBe("Custom manager");
    expect(found?.maxContextTokens).toBe(12000);
  });

  it("new caller profile adds beyond the six defaults", () => {
    const extra: AgentProfile = {
      id: "custom-pentester",
      role: "security-reviewer"
    };
    const registry = createAgentDefinitionRegistry([extra]);
    expect(registry.count()).toBe(7);
    expect(registry.findById("custom-pentester")).toBeDefined();
    const securityRole = registry.findByRole("security-reviewer");
    // Two matches: the default + the caller's extra.
    expect(securityRole.map((d) => d.id)).toEqual([
      "security-reviewer",
      "custom-pentester"
    ]);
  });
});

describe("DEFAULT_AGENT_DEFINITIONS", () => {
  it("contains exactly 6 entries, one per default role", () => {
    expect(DEFAULT_AGENT_DEFINITIONS).toHaveLength(6);
    const roles = DEFAULT_AGENT_DEFINITIONS.map((d) => d.role);
    expect(roles).toEqual([
      "manager",
      "architecture-reviewer",
      "security-reviewer",
      "implementation-planner",
      "eval-reviewer",
      "docs-reviewer"
    ]);
  });
});
