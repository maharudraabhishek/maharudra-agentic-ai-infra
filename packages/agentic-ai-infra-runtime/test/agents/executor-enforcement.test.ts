import { describe, expect, it } from "vitest";
import { DefaultConfigValidator } from "@maharudra/agentic-ai-infra-core";
import type { AgenticInfraProjectConfig, ToolContract } from "@maharudra/agentic-ai-infra-core";
import {
  InMemoryAgentDefinitionRegistry,
  SingleAgentExecutor,
  TokenEfficientMultiAgentExecutor
} from "../../src/agents/index.js";
import { InMemoryTrajectoryRecorder } from "../../src/trajectory/index.js";
import { InMemorySessionManager } from "../../src/session/index.js";

/** A minimal context-category tool used to drive single-agent selection tests. */
const SEARCH_TOOL: ToolContract = {
  id: "agentic.retrieval.search",
  name: "Retrieval Search",
  description: "Searches the knowledge base.",
  category: "context",
  riskLevel: "low",
  outputPolicy: { remoteSafe: true, returnsRawFiles: false },
  runtimePolicy: { allowedModes: ["local-stdio-mcp"], remoteSafe: true, localFilesystem: false }
};

/**
 * Helper: resolve and validate an AgenticInfraProjectConfig into a
 * ResolvedProjectConfig. Throws if validation fails (test setup error).
 */
function resolveConfig(input: AgenticInfraProjectConfig) {
  const result = new DefaultConfigValidator().validate(input);
  if (!result.ok) {
    throw new Error(`Test config failed validation: ${result.error.message}`);
  }
  return result.value;
}

const SINGLE_AGENT_CONFIG: AgenticInfraProjectConfig = {
  project: { name: "Enforcement Test", slug: "enforcement-test" },
  profiles: ["minimal"]
};

const MULTI_AGENT_CONFIG: AgenticInfraProjectConfig = {
  project: { name: "Multi Enforcement", slug: "multi-enforcement" },
  profiles: ["full-agentic-context"]
};

describe("SingleAgentExecutor — allowedTools enforcement (Stage 25)", () => {
  it("absent agentRegistry → unchanged Stage 24 behavior", async () => {
    const executor = new SingleAgentExecutor({
      config: resolveConfig(SINGLE_AGENT_CONFIG)
    });
    const result = await executor.execute({
      task: "Search the knowledge base for vectorless examples",
      tools: [SEARCH_TOOL]
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Without enforcement, the executor selects its usual ≤4 tools.
    expect(result.value.selectedToolIds.length).toBeGreaterThan(0);
  });

  it("absent allowedTools on manager definition → pass-through", async () => {
    // Registry has the default "manager" with no policy — D23 backwards-compat.
    const registry = new InMemoryAgentDefinitionRegistry().register({
      id: "manager",
      role: "manager"
    });
    const executor = new SingleAgentExecutor({
      config: resolveConfig(SINGLE_AGENT_CONFIG),
      agentRegistry: registry
    });
    const result = await executor.execute({
      task: "Search the knowledge base",
      tools: [SEARCH_TOOL]
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.selectedToolIds.length).toBeGreaterThan(0);
  });

  it("empty allowedTools array → no tools selected", async () => {
    const registry = new InMemoryAgentDefinitionRegistry().register({
      id: "manager",
      role: "manager",
      allowedTools: []
    });
    const executor = new SingleAgentExecutor({
      config: resolveConfig(SINGLE_AGENT_CONFIG),
      agentRegistry: registry
    });
    const result = await executor.execute({
      task: "Search the knowledge base",
      tools: [SEARCH_TOOL]
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.selectedToolIds).toEqual([]);
  });

  it("allowedTools restricts selection to listed ids only", async () => {
    const registry = new InMemoryAgentDefinitionRegistry().register({
      id: "manager",
      role: "manager",
      allowedTools: ["agentic.retrieval.search"]
    });
    const executor = new SingleAgentExecutor({
      config: resolveConfig(SINGLE_AGENT_CONFIG),
      agentRegistry: registry
    });
    const result = await executor.execute({
      task: "Search the knowledge base",
      tools: [SEARCH_TOOL]
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Either the tool was selected (and remains), or it wasn't (empty).
    // The invariant: nothing OUTSIDE the allowlist appears.
    for (const id of result.value.selectedToolIds) {
      expect(id).toBe("agentic.retrieval.search");
    }
  });

  it("budgetPolicy.maxTokens caps the effective budget", async () => {
    const registry = new InMemoryAgentDefinitionRegistry().register({
      id: "manager",
      role: "manager",
      budgetPolicy: { maxTokens: 500 }
    });
    const executor = new SingleAgentExecutor({
      config: resolveConfig(SINGLE_AGENT_CONFIG),
      agentRegistry: registry
    });
    const result = await executor.execute({
      task: "Search the knowledge base"
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The executor's reported budget should not exceed the agent ceiling.
    expect(result.value.tokenUsage.totalTokens).toBeLessThanOrEqual(500);
  });
});

describe("SingleAgentExecutor canonical identity", () => {
  it("uses the requested definition for policy and report attribution", async () => {
    const registry = new InMemoryAgentDefinitionRegistry().register({
      id: "security-specialist",
      role: "security-reviewer",
      allowedTools: []
    });
    const executor = new SingleAgentExecutor({
      config: resolveConfig(SINGLE_AGENT_CONFIG),
      agentRegistry: registry
    });
    const result = await executor.execute({
      task: "Search the knowledge base for security evidence",
      agentId: "security-specialist",
      traceId: "trace-specialist",
      tools: [SEARCH_TOOL]
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.agentId).toBe("security-specialist");
    expect(result.value.role).toBe("security-reviewer");
    expect(result.value.traceId).toBe("trace-specialist");
    expect(result.value.selectedToolIds).toEqual([]);
  });

  it("fails closed for an unknown requested definition", async () => {
    const executor = new SingleAgentExecutor({
      config: resolveConfig(SINGLE_AGENT_CONFIG),
      agentRegistry: new InMemoryAgentDefinitionRegistry()
    });
    const result = await executor.execute({
      task: "Review an unknown route",
      agentId: "missing"
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("agent.definition-not-found");
    }
  });

  it("does not treat available context sources as cited evidence", async () => {
    const registry = new InMemoryAgentDefinitionRegistry().register({
      id: "manager",
      role: "manager",
      responsePolicy: {
        requireCitations: true,
        onWeakEvidence: "warn"
      }
    });
    const executor = new SingleAgentExecutor({
      config: resolveConfig(SINGLE_AGENT_CONFIG),
      agentRegistry: registry
    });
    const result = await executor.execute({
      task: "Review available evidence",
      includeContext: true,
      contextPackage: {
        id: "context-1",
        task: "transient",
        taskHash: "hash",
        taskType: "review",
        sources: [{
          sourceId: "source-1",
          providerId: "test",
          label: "Available but unused",
          content: "Evidence text",
          score: 1
        }],
        contextText: "Evidence text",
        tokenEstimate: 3
      }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.response).toMatchObject({
      pass: false,
      action: "warn",
      citationCount: 0,
      evidenceCoverage: 0
    });
  });

  it("persists only safe task metadata as the session user goal", async () => {
    const baseSessionManager = new InMemorySessionManager();
    let persistedGoal = "";
    const sessionManager = new Proxy(baseSessionManager, {
      get(target, property) {
        if (property === "openThread") {
          return async (sessionId: string, userGoal: string) => {
            persistedGoal = userGoal;
            return target.openThread(sessionId, userGoal);
          };
        }

        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
    const executor = new SingleAgentExecutor({
      config: resolveConfig(SINGLE_AGENT_CONFIG),
      sessionManager
    });
    const sentinel = "RAW_SECRET_TASK prior synthesis must not persist";
    const result = await executor.execute({ task: sentinel });

    expect(result.ok).toBe(true);
    expect(persistedGoal).toContain("taskType=");
    expect(persistedGoal).toContain("taskHash=");
    expect(persistedGoal).not.toContain("RAW_SECRET_TASK");
    expect(persistedGoal).not.toContain("prior synthesis");
  });

  it("rejects unsafe executor trace identifiers before execution", async () => {
    const executor = new SingleAgentExecutor({
      config: resolveConfig(SINGLE_AGENT_CONFIG)
    });
    const unsafeTraceIds = [
      "C:\\private\\trace",
      "secret-token",
      "ghp_1234567890abcdef",
      "AKIA1234567890ABCDEF",
      "sk_live_1234567890abcdef",
      "trace\nforged",
      `trace-${"x".repeat(130)}`
    ];

    for (const traceId of unsafeTraceIds) {
      const result = await executor.execute({ task: "Review trace", traceId });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("agent.invalid-route");
      }
    }
  });
});

describe("TokenEfficientMultiAgentExecutor — per-role enforcement (Stage 25)", () => {
  it("absent agentRegistry → unchanged Stage 24 behavior", async () => {
    const trajectory = new InMemoryTrajectoryRecorder();
    const executor = new TokenEfficientMultiAgentExecutor({
      config: resolveConfig(MULTI_AGENT_CONFIG),
      trajectoryRecorder: trajectory
    });
    const text = "Security architecture docs eval implementation. ".repeat(40);
    const result = await executor.execute({
      task: "Review security architecture and docs",
      contextPackage: {
        id: "ctx",
        task: "transient",
        taskHash: "hash",
        taskType: "security",
        sources: [],
        contextText: text,
        tokenEstimate: Math.ceil(text.length / 4)
      }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Without enforcement, multiple roles produce outputs as before.
    expect(result.value.roleOutputs.length).toBeGreaterThan(0);
  });

  it("per-role allowedTools restricts that role only", async () => {
    const registry = new InMemoryAgentDefinitionRegistry()
      .register({
        id: "security-reviewer",
        role: "security-reviewer",
        allowedTools: ["agentic.retrieval.search"]
      })
      .register({
        id: "architecture-reviewer",
        role: "architecture-reviewer"
        // No allowedTools — unrestricted
      });

    const trajectory = new InMemoryTrajectoryRecorder();
    const executor = new TokenEfficientMultiAgentExecutor({
      config: resolveConfig(MULTI_AGENT_CONFIG),
      trajectoryRecorder: trajectory,
      agentRegistry: registry
    });
    const text = "Security architecture review request. ".repeat(40);
    const result = await executor.execute({
      task: "Review security and architecture",
      contextPackage: {
        id: "ctx",
        task: "transient",
        taskHash: "hash",
        taskType: "security",
        sources: [],
        contextText: text,
        tokenEstimate: Math.ceil(text.length / 4)
      }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Find the security-reviewer's output; any tool ids it lists must be in
    // the allowlist. The architecture-reviewer's output has no such bound.
    const secOutput = result.value.roleOutputs.find(
      (o) => o.role === "security-reviewer"
    );
    if (secOutput) {
      for (const id of secOutput.selectedToolIds) {
        expect(id).toBe("agentic.retrieval.search");
      }
    }
  });

  it("per-role budgetPolicy caps that role's effective budget", async () => {
    const registry = new InMemoryAgentDefinitionRegistry().register({
      id: "security-reviewer",
      role: "security-reviewer",
      budgetPolicy: { maxTokens: 300 }
    });

    const trajectory = new InMemoryTrajectoryRecorder();
    const executor = new TokenEfficientMultiAgentExecutor({
      config: resolveConfig(MULTI_AGENT_CONFIG),
      trajectoryRecorder: trajectory,
      agentRegistry: registry
    });
    const text = "Security review. ".repeat(40);
    const result = await executor.execute({
      task: "Security review",
      contextPackage: {
        id: "ctx",
        task: "transient",
        taskHash: "hash",
        taskType: "security",
        sources: [],
        contextText: text,
        tokenEstimate: Math.ceil(text.length / 4)
      }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const secOutput = result.value.roleOutputs.find(
      (o) => o.role === "security-reviewer"
    );
    if (secOutput) {
      expect(secOutput.tokenUsage.totalTokens).toBeLessThanOrEqual(300);
    }
  });

  it("first findByRole match is used when multiple definitions share a role", async () => {
    const registry = new InMemoryAgentDefinitionRegistry()
      .register({
        id: "sec-strict",
        role: "security-reviewer",
        allowedTools: ["agentic.retrieval.search"]
      })
      .register({
        id: "sec-loose",
        role: "security-reviewer"
      });

    const trajectory = new InMemoryTrajectoryRecorder();
    const executor = new TokenEfficientMultiAgentExecutor({
      config: resolveConfig(MULTI_AGENT_CONFIG),
      trajectoryRecorder: trajectory,
      agentRegistry: registry
    });
    const text = "Security review. ".repeat(40);
    const result = await executor.execute({
      task: "Security review",
      contextPackage: {
        id: "ctx",
        task: "transient",
        taskHash: "hash",
        taskType: "security",
        sources: [],
        contextText: text,
        tokenEstimate: Math.ceil(text.length / 4)
      }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The strict definition was registered first → first match → its
    // allowedTools applies to the security-reviewer slice.
    const secOutput = result.value.roleOutputs.find(
      (o) => o.role === "security-reviewer"
    );
    if (secOutput) {
      for (const id of secOutput.selectedToolIds) {
        expect(id).toBe("agentic.retrieval.search");
      }
    }
  });

  it("a role with no registered definition uses Stage 24 behavior", async () => {
    // Registry intentionally has nothing for docs-reviewer. If the executor
    // routes to docs-reviewer, no enforcement is applied.
    const registry = new InMemoryAgentDefinitionRegistry().register({
      id: "manager",
      role: "manager"
    });

    const trajectory = new InMemoryTrajectoryRecorder();
    const executor = new TokenEfficientMultiAgentExecutor({
      config: resolveConfig(MULTI_AGENT_CONFIG),
      trajectoryRecorder: trajectory,
      agentRegistry: registry
    });
    const text = "Documentation review. ".repeat(40);
    const result = await executor.execute({
      task: "Review documentation",
      contextPackage: {
        id: "ctx",
        task: "transient",
        taskHash: "hash",
        taskType: "documentation",
        sources: [],
        contextText: text,
        tokenEstimate: Math.ceil(text.length / 4)
      }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The run completes; roles without registered definitions still produce
    // outputs (no enforcement applied).
    expect(result.value.roleOutputs.length).toBeGreaterThan(0);
  });
});
