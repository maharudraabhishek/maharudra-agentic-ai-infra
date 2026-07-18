import { describe, expect, it } from "vitest";
import type { AgentDefinition } from "@maharudra/agentic-ai-infra-core";
import {
  SINGLE_AGENT_SUITE_NAME,
  runSingleAgentEvals
} from "../../src/evals/single-agent-evals.js";

describe("runSingleAgentEvals — required tools check", () => {
  it("skips check when requiredTools is undefined", () => {
    const result = runSingleAgentEvals(
      { selectedToolIds: [], tokenUsage: { totalTokens: 0 } },
      { id: "manager", role: "manager", evalRules: {} }
    );
    const check = result.results.find((c) => c.id === "required-tools");
    expect(check?.status).toBe("skipped");
  });

  it("passes when all required tools are selected", () => {
    const definition: AgentDefinition = {
      id: "manager",
      role: "manager",
      evalRules: { requiredTools: ["agentic.retrieval.search"] }
    };
    const result = runSingleAgentEvals(
      {
        selectedToolIds: ["agentic.retrieval.search", "agentic.context.build"],
        tokenUsage: { totalTokens: 100 }
      },
      definition
    );
    const check = result.results.find((c) => c.id === "required-tools");
    expect(check?.status).toBe("passed");
  });

  it("fails when a required tool is missing", () => {
    const definition: AgentDefinition = {
      id: "manager",
      role: "manager",
      evalRules: { requiredTools: ["agentic.retrieval.search"] }
    };
    const result = runSingleAgentEvals(
      { selectedToolIds: [], tokenUsage: { totalTokens: 0 } },
      definition
    );
    const check = result.results.find((c) => c.id === "required-tools");
    expect(check?.status).toBe("failed");
    expect(result.status).toBe("failed");
  });
});

describe("runSingleAgentEvals — forbidden tools check", () => {
  it("skips check when forbiddenTools is undefined", () => {
    const result = runSingleAgentEvals(
      { selectedToolIds: ["any.tool"], tokenUsage: { totalTokens: 0 } },
      { id: "manager", role: "manager", evalRules: {} }
    );
    const check = result.results.find((c) => c.id === "forbidden-tools");
    expect(check?.status).toBe("skipped");
  });

  it("fails when a forbidden tool is selected", () => {
    const definition: AgentDefinition = {
      id: "manager",
      role: "manager",
      evalRules: { forbiddenTools: ["agentic.write.propose"] }
    };
    const result = runSingleAgentEvals(
      {
        selectedToolIds: ["agentic.write.propose"],
        tokenUsage: { totalTokens: 0 }
      },
      definition
    );
    const check = result.results.find((c) => c.id === "forbidden-tools");
    expect(check?.status).toBe("failed");
    expect(result.status).toBe("failed");
  });
});

describe("runSingleAgentEvals — hard budget check", () => {
  it("skips check when hardBudget is undefined", () => {
    const result = runSingleAgentEvals(
      { selectedToolIds: [], tokenUsage: { totalTokens: 9999 } },
      { id: "manager", role: "manager", evalRules: {} }
    );
    const check = result.results.find((c) => c.id === "hard-budget");
    expect(check?.status).toBe("skipped");
  });

  it("passes when usage is at or below hardBudget", () => {
    const definition: AgentDefinition = {
      id: "manager",
      role: "manager",
      evalRules: { hardBudget: 1000 }
    };
    const result = runSingleAgentEvals(
      { selectedToolIds: [], tokenUsage: { totalTokens: 999 } },
      definition
    );
    const check = result.results.find((c) => c.id === "hard-budget");
    expect(check?.status).toBe("passed");
  });

  it("fails when usage exceeds hardBudget", () => {
    const definition: AgentDefinition = {
      id: "manager",
      role: "manager",
      evalRules: { hardBudget: 1000 }
    };
    const result = runSingleAgentEvals(
      { selectedToolIds: [], tokenUsage: { totalTokens: 1001 } },
      definition
    );
    const check = result.results.find((c) => c.id === "hard-budget");
    expect(check?.status).toBe("failed");
    expect(result.status).toBe("failed");
  });
});

describe("runSingleAgentEvals — overall report shape", () => {
  it("returns suiteName 'single-agent-safety'", () => {
    const result = runSingleAgentEvals(
      { selectedToolIds: [], tokenUsage: { totalTokens: 0 } },
      undefined
    );
    expect(result.suiteName).toBe(SINGLE_AGENT_SUITE_NAME);
    expect(result.suiteName).toBe("single-agent-safety");
  });
});
