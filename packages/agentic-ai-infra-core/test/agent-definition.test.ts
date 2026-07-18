import { describe, expect, it } from "vitest";
import type {
  AgentBudgetPolicy,
  AgentDefinition,
  AgentDefinitionRegistry,
  AgentEvalRules,
  AgentProfile,
  AgentRole,
  ErrorCode
} from "../src/index.js";

describe("AgentDefinition (Stage 25)", () => {
  it("is structurally assignable to AgentProfile", () => {
    // A definition with only the required identity fields must be a valid
    // AgentProfile too. This verifies the intersection-type design.
    const def: AgentDefinition = {
      id: "test-agent",
      role: "manager"
    };
    const profile: AgentProfile = def;
    expect(profile.id).toBe("test-agent");
    expect(profile.role).toBe("manager");
  });

  it("accepts only id and role as required fields", () => {
    // All policy fields are optional. The minimal valid definition is two
    // fields. The compiler verifies this at typecheck time; this test
    // documents the invariant.
    const minimal: AgentDefinition = { id: "x", role: "manager" };
    expect(minimal.allowedTools).toBeUndefined();
    expect(minimal.budgetPolicy).toBeUndefined();
    expect(minimal.evalRules).toBeUndefined();
  });

  it("distinguishes empty allowedTools from undefined", () => {
    // Documented in TSDoc: [] means "no tools allowed", undefined means
    // "no per-agent restriction". Phase 04 enforces this distinction.
    const noPolicy: AgentDefinition = { id: "a", role: "manager" };
    const emptyAllowlist: AgentDefinition = {
      id: "b",
      role: "manager",
      allowedTools: []
    };
    expect(noPolicy.allowedTools).toBeUndefined();
    expect(emptyAllowlist.allowedTools).toBeDefined();
    expect(emptyAllowlist.allowedTools?.length).toBe(0);
  });

  it("budgetPolicy requires maxTokens when set", () => {
    // Type-level test: omitting maxTokens when budgetPolicy is set is a
    // TypeScript error. We can't test that directly at runtime, but we can
    // verify that the field is reachable when present.
    const budget: AgentBudgetPolicy = { maxTokens: 1000 };
    const def: AgentDefinition = {
      id: "with-budget",
      role: "manager",
      budgetPolicy: budget
    };
    expect(def.budgetPolicy?.maxTokens).toBe(1000);
  });

  it("evalRules fields are all optional", () => {
    const empty: AgentEvalRules = {};
    const def: AgentDefinition = {
      id: "with-evals",
      role: "manager",
      evalRules: empty
    };
    expect(def.evalRules).toBeDefined();
    expect(def.evalRules?.requiredTools).toBeUndefined();
    expect(def.evalRules?.forbiddenTools).toBeUndefined();
    expect(def.evalRules?.hardBudget).toBeUndefined();
  });

  it("supports all 13 AgentRole values on a definition", () => {
    const roles: readonly AgentRole[] = [
      "manager",
      "architecture-reviewer",
      "security-reviewer",
      "implementation-planner",
      "eval-reviewer",
      "docs-reviewer",
      "planner",
      "implementer",
      "reviewer",
      "security",
      "retrieval",
      "dashboard",
      "custom"
    ];

    for (const role of roles) {
      const def: AgentDefinition = { id: `id-${role}`, role };
      expect(def.role).toBe(role);
    }
  });
});

describe("AgentDefinitionRegistry interface (Stage 25)", () => {
  it("can be implemented with the four required methods", () => {
    // Compile-time test: a minimal mock implementation must satisfy the
    // interface shape. If the interface grows a method without a default,
    // this test breaks the build and signals the contract change.
    const mock: AgentDefinitionRegistry = {
      list: () => [],
      findById: () => undefined,
      findByRole: () => [],
      count: () => 0
    };
    expect(mock.list()).toEqual([]);
    expect(mock.findById("x")).toBeUndefined();
    expect(mock.findByRole("manager")).toEqual([]);
    expect(mock.count()).toBe(0);
  });
});

describe("Stage 25 error codes", () => {
  it("declares the three new error codes in the ErrorCode union", () => {
    // Type-only test: assignments must compile. This is the typecheck-time
    // guarantee that the codes are present in the union and spelled
    // exactly as documented.
    const codes: readonly ErrorCode[] = [
      "agent.definition-duplicate-id",
      "agent.definition-invalid-role",
      "agent.tool-not-in-allowlist"
    ];
    expect(codes).toHaveLength(3);
    expect(codes[0]).toBe("agent.definition-duplicate-id");
    expect(codes[1]).toBe("agent.definition-invalid-role");
    expect(codes[2]).toBe("agent.tool-not-in-allowlist");
  });
});

describe("Stage 26 route integrity error codes", () => {
  it("declares stable lookup and route-validation codes", () => {
    const codes: readonly ErrorCode[] = [
      "agent.definition-not-found",
      "agent.invalid-route"
    ];

    expect(codes).toEqual([
      "agent.definition-not-found",
      "agent.invalid-route"
    ]);
  });
});
