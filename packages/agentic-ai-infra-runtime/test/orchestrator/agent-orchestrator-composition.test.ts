import { describe, expect, it } from "vitest";
import {
  DefaultConfigValidator,
  fail,
  ok,
  type AgentDefinition,
  type AgentDefinitionRegistry,
  type AgenticInfraProjectConfig,
  type ContextPackage,
  type FrameworkResult,
  type SupervisorComposition,
  type SupervisorPolicy
} from "@maharudra/agentic-ai-infra-core";
import {
  InMemoryAgentDefinitionRegistry,
  SingleAgentExecutor,
  TokenEfficientMultiAgentExecutor,
  type SingleAgentRunReport
} from "../../src/agents/index.js";
import { AgentOrchestrator } from "../../src/orchestrator/index.js";

const SINGLE_AGENT_CONFIG: AgenticInfraProjectConfig = {
  project: { name: "Orchestrator Composition Test", slug: "orchestrator-composition-test" },
  profiles: ["minimal"]
};

const MANAGER: AgentDefinition = { id: "manager", role: "manager" };
const ARCHITECTURE: AgentDefinition = {
  id: "architecture",
  role: "architecture-reviewer"
};

type RecordingExecutor = Pick<SingleAgentExecutor, "execute"> & {
  readonly calls: () => number;
  readonly tasks: () => readonly string[];
};

/**
 * Resolves test configuration before constructing real executors.
 *
 * @param input - Declarative project configuration used by this fixture.
 * @returns Resolved runtime configuration accepted by both executor classes.
 * @throws Error when the fixture config is invalid, because the test setup
 *   cannot exercise orchestrator behavior in that state.
 */
function resolveConfig(input: AgenticInfraProjectConfig) {
  const result = new DefaultConfigValidator().validate(input);
  if (!result.ok) {
    throw new Error(`Test config failed validation: ${result.error.message}`);
  }
  return result.value;
}

/**
 * Builds a real read-only registry for the supplied agent definitions.
 *
 * @param agents - Agent definitions to register in insertion order.
 * @returns Registry used by the supervisor and executor fixtures.
 */
function registryWith(agents: readonly AgentDefinition[]): InMemoryAgentDefinitionRegistry {
  const registry = new InMemoryAgentDefinitionRegistry();

  for (const agent of agents) {
    registry.register(agent);
  }

  return registry;
}

/**
 * Creates a supervisor policy that returns one fixed route.
 *
 * @param agents - Registered agents returned by the route.
 * @param composition - Composition strategy under test.
 * @returns Deterministic supervisor policy for orchestrator tests.
 */
function supervisorFor(
  agents: readonly AgentDefinition[],
  composition: SupervisorComposition
): SupervisorPolicy {
  return {
    route: () => ok({ agents, composition })
  };
}

/**
 * Builds a real orchestrator with overridable execution seams.
 *
 * @param options - Registry, route, and optional single-agent executor for one test.
 * @returns Constructed orchestrator; its multi-agent executor is intentionally
 *   injected but never called by Stage 26 composition paths.
 */
function createOrchestrator(options: {
  readonly registry: AgentDefinitionRegistry;
  readonly supervisorPolicy: SupervisorPolicy;
  readonly singleAgentExecutor?: Pick<SingleAgentExecutor, "execute">;
  readonly multiAgentExecutor?: TokenEfficientMultiAgentExecutor;
}): AgentOrchestrator {
  const singleAgentExecutor =
    options.singleAgentExecutor ??
    new SingleAgentExecutor({
      config: resolveConfig(SINGLE_AGENT_CONFIG),
      agentRegistry: options.registry
    });
  const multiAgentExecutor =
    options.multiAgentExecutor ??
    new TokenEfficientMultiAgentExecutor({
      config: resolveConfig(SINGLE_AGENT_CONFIG),
      agentRegistry: options.registry
    });

  return new AgentOrchestrator({
    supervisorPolicy: options.supervisorPolicy,
    agentRegistry: options.registry,
    singleAgentExecutor,
    multiAgentExecutor
  });
}

/**
 * Creates a deterministic successful single-agent report for stubbed execution.
 *
 * @param summary - Summary text returned by the fake agent.
 * @param tokenUsage - Optional usage numbers for aggregation assertions.
 * @returns A complete `SingleAgentRunReport` with no external side effects.
 */
function singleReport(
  summary: string,
  tokenUsage = { inputTokens: 1, outputTokens: 2, totalTokens: 3 }
): SingleAgentRunReport {
  return {
    runId: `run-${summary}`,
    traceId: `trace-${summary}`,
    agentId: "manager",
    role: "manager",
    task: { taskHash: `hash-${summary}`, taskType: "test" },
    mode: "single-agent",
    selectedToolIds: [],
    contextSourceCount: 0,
    tokenUsage,
    result: {
      summary,
      steps: [],
      warnings: []
    }
  };
}

/**
 * Creates a typed executor stub that returns queued results in call order.
 *
 * @param results - Results to return; after the queue is exhausted, the last
 *   result repeats so tests remain deterministic.
 * @returns Executor plus call/task inspectors for assertions.
 */
function recordingExecutor(
  results: readonly FrameworkResult<SingleAgentRunReport>[]
): RecordingExecutor {
  let callCount = 0;
  const tasks: string[] = [];

  return {
    calls: () => callCount,
    tasks: () => tasks,
    execute: async (input) => {
      tasks.push(input.task);
      const result = results[callCount] ?? results[results.length - 1];
      callCount += 1;

      if (!result) {
        return fail({
          code: "framework.internal-error",
          message: "Recording executor was constructed without results.",
          severity: "fatal"
        });
      }

      if (!result.ok) {
        return result;
      }

      return ok({
        ...result.value,
        agentId: input.agentId ?? result.value.agentId,
        role: input.agentId === "architecture" ? "architecture-reviewer" : result.value.role,
        traceId: input.traceId ?? result.value.traceId
      });
    }
  };
}

/**
 * Creates a context package with one available, but not cited, source.
 *
 * @returns Bounded context package used to prove availability is not attribution.
 */
function contextPackage(): ContextPackage {
  return {
    id: "ctx-1",
    task: "Grounded task",
    sources: [{ sourceId: "source-1", label: "source.md", providerId: "test" }],
    contextText: "source evidence",
    tokenEstimate: 4
  };
}

describe("AgentOrchestrator composition", () => {
  it("runs a sequential route and merges both role summaries", async () => {
    const registry = registryWith([MANAGER, ARCHITECTURE]);
    const orchestrator = createOrchestrator({
      registry,
      supervisorPolicy: supervisorFor([MANAGER, ARCHITECTURE], "sequential")
    });

    const result = await orchestrator.run({ task: "Plan implementation architecture" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.subRuns).toHaveLength(2);
    expect(result.value.plannedAgents).toEqual(["manager", "architecture-reviewer"]);
    expect(result.value.synthesis).toContain("manager:");
    expect(result.value.synthesis).toContain("architecture-reviewer:");
  });

  it("runs a parallel route through all settled branches", async () => {
    const registry = registryWith([MANAGER, ARCHITECTURE]);
    const executor = recordingExecutor([
      ok(singleReport("manager output")),
      ok(singleReport("architecture output"))
    ]);
    const orchestrator = createOrchestrator({
      registry,
      supervisorPolicy: supervisorFor([MANAGER, ARCHITECTURE], "parallel"),
      singleAgentExecutor: executor
    });

    const result = await orchestrator.run({ task: "Review runtime composition" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(executor.calls()).toBe(2);
    expect(result.value.subRuns).toHaveLength(2);
    expect(result.value.synthesis).toContain("manager: manager output");
    expect(result.value.synthesis).toContain("architecture-reviewer: architecture output");
  });

  it("keeps a parallel run successful when one branch fails", async () => {
    const registry = registryWith([MANAGER, ARCHITECTURE]);
    let calls = 0;
    const executor: Pick<SingleAgentExecutor, "execute"> = {
      execute: async (input) => {
        calls += 1;
        if (calls === 1) {
          throw new Error("C:\\private\\provider failure");
        }

        return ok({
          ...singleReport("architecture survived"),
          agentId: input.agentId ?? "architecture",
          role: "architecture-reviewer",
          traceId: input.traceId ?? "trace-architecture-survived"
        });
      }
    };
    const orchestrator = createOrchestrator({
      registry,
      supervisorPolicy: supervisorFor([MANAGER, ARCHITECTURE], "parallel"),
      singleAgentExecutor: executor
    });

    const result = await orchestrator.run({ task: "Review runtime composition" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.subRuns).toHaveLength(1);
    expect(result.value.warnings?.[0]).toBe("parallel sub-run rejected: framework.internal-error");
    expect(result.value.warnings?.[0]).not.toContain("C:\\private");
    expect(result.value.synthesis).toContain("architecture survived");
  });

  it("records typed refusals from failed partial parallel branches", async () => {
    const registry = registryWith([MANAGER, ARCHITECTURE]);
    const executor = recordingExecutor([
      fail({
        code: "runtime.permission-denied",
        message: "C:\\private\\secret refusal detail",
        severity: "recoverable",
        refusalReason: "agent-allowlist"
      }),
      ok(singleReport("architecture survived"))
    ]);
    const orchestrator = createOrchestrator({
      registry,
      supervisorPolicy: supervisorFor([MANAGER, ARCHITECTURE], "parallel"),
      singleAgentExecutor: executor
    });

    const result = await orchestrator.run({ task: "Review partial refusal reporting" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.refusals).toEqual([{
      agentId: "manager",
      refusalReason: "agent-allowlist",
      message: "Agent execution was refused by policy."
    }]);
    expect(result.value.subRuns).toHaveLength(1);
  });

  it("retains the typed refusal when every parallel branch fails", async () => {
    const registry = registryWith([MANAGER, ARCHITECTURE]);
    const denied = fail({
      code: "runtime.permission-denied",
      message: "Denied by policy.",
      severity: "recoverable",
      refusalReason: "agent-allowlist" as const
    });
    const orchestrator = createOrchestrator({
      registry,
      supervisorPolicy: supervisorFor([MANAGER, ARCHITECTURE], "parallel"),
      singleAgentExecutor: recordingExecutor([denied, denied])
    });

    const result = await orchestrator.run({ task: "Review total refusal reporting" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.refusalReason).toBe("agent-allowlist");
    }
  });

  it("fails a parallel run when every branch fails", async () => {
    const registry = registryWith([MANAGER, ARCHITECTURE]);
    const executor = recordingExecutor([
      fail({
        code: "retrieval.embedding-failed",
        message: "manager failed",
        severity: "recoverable"
      }),
      fail({
        code: "retrieval.embedding-failed",
        message: "architecture failed",
        severity: "recoverable"
      })
    ]);
    const orchestrator = createOrchestrator({
      registry,
      supervisorPolicy: supervisorFor([MANAGER, ARCHITECTURE], "parallel"),
      singleAgentExecutor: executor
    });

    const result = await orchestrator.run({ task: "Review runtime composition" });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("agent.retry-blocked");
  });

  it("reports retry attempt count from the retry callback", async () => {
    const retryingManager: AgentDefinition = {
      ...MANAGER,
      retryPolicy: {
        maxAttempts: 3,
        retryableErrorCodes: ["retrieval.embedding-failed"]
      }
    };
    const registry = registryWith([retryingManager]);
    const executor = recordingExecutor([
      fail({
        code: "retrieval.embedding-failed",
        message: "first failure",
        severity: "recoverable"
      }),
      fail({
        code: "retrieval.embedding-failed",
        message: "second failure",
        severity: "recoverable"
      }),
      ok(singleReport("retry success"))
    ]);
    const orchestrator = createOrchestrator({
      registry,
      supervisorPolicy: supervisorFor([retryingManager], "sequential"),
      singleAgentExecutor: executor
    });

    const result = await orchestrator.run({ task: "Retry retrieval" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.subRuns[0]?.attemptCount).toBe(3);
    expect(executor.calls()).toBe(3);
  });

  it("honors the NEVER_RETRY floor without extra attempts", async () => {
    const blockedManager: AgentDefinition = {
      ...MANAGER,
      retryPolicy: {
        maxAttempts: 3,
        retryableErrorCodes: ["token.budget-exceeded"]
      }
    };
    const registry = registryWith([blockedManager, ARCHITECTURE]);
    const executor = recordingExecutor([
      fail({
        code: "token.budget-exceeded",
        message: "budget exhausted",
        severity: "recoverable"
      }),
      ok(singleReport("architecture still ran"))
    ]);
    const orchestrator = createOrchestrator({
      registry,
      supervisorPolicy: supervisorFor([blockedManager, ARCHITECTURE], "parallel"),
      singleAgentExecutor: executor
    });

    const result = await orchestrator.run({ task: "Review budget handling" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(executor.calls()).toBe(2);
    expect(result.value.warnings?.[0]).toContain("agent.retry-blocked");
    expect(result.value.warnings?.[0]).toContain("1 attempt(s)");
    expect(result.value.warnings?.[0]).not.toContain("budget exhausted");
  });

  it("does not fabricate citations for a merged output", async () => {
    const guardedManager: AgentDefinition = {
      ...MANAGER,
      responsePolicy: {
        mode: "grounded",
        requireCitations: true
      }
    };
    const registry = registryWith([guardedManager, ARCHITECTURE]);
    const executor = recordingExecutor([
      ok(singleReport("manager output")),
      ok(singleReport("architecture output"))
    ]);
    const orchestrator = createOrchestrator({
      registry,
      supervisorPolicy: supervisorFor([guardedManager, ARCHITECTURE], "sequential"),
      singleAgentExecutor: executor
    });

    const result = await orchestrator.run({
      task: "Use grounded evidence",
      contextPackage: contextPackage()
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.response).toEqual({
      pass: false,
      action: "warn",
      reason: "Output has no citations.",
      evidenceCoverage: 0,
      citationCount: 0
    });
    for (const subRun of result.value.subRuns) {
      expect(subRun.executorReport.kind).toBe("single");
      if (subRun.executorReport.kind === "single") {
        expect(subRun.executorReport.report.response).toBeUndefined();
      }
    }
  });

  it("enforces an abstain response action instead of returning synthesis", async () => {
    const guardedManager: AgentDefinition = {
      ...MANAGER,
      responsePolicy: {
        requireCitations: true,
        onWeakEvidence: "abstain"
      }
    };
    const registry = registryWith([guardedManager, ARCHITECTURE]);
    const orchestrator = createOrchestrator({
      registry,
      supervisorPolicy: supervisorFor([guardedManager, ARCHITECTURE], "sequential"),
      singleAgentExecutor: recordingExecutor([
        ok(singleReport("manager output")),
        ok(singleReport("architecture output"))
      ])
    });
    const result = await orchestrator.run({
      task: "Use grounded evidence",
      contextPackage: contextPackage()
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("agent.weak-evidence");
    }
  });

  it("omits report.response when no response policy is configured", async () => {
    const registry = registryWith([MANAGER, ARCHITECTURE]);
    const executor = recordingExecutor([
      ok(singleReport("manager output")),
      ok(singleReport("architecture output"))
    ]);
    const orchestrator = createOrchestrator({
      registry,
      supervisorPolicy: supervisorFor([MANAGER, ARCHITECTURE], "sequential"),
      singleAgentExecutor: executor
    });

    const result = await orchestrator.run({ task: "No response policy" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect("response" in result.value).toBe(false);
  });

  it("aggregates token usage across successful sub-runs", async () => {
    const registry = registryWith([MANAGER, ARCHITECTURE]);
    const executor = recordingExecutor([
      ok(singleReport("manager output", { inputTokens: 2, outputTokens: 3, totalTokens: 5 })),
      ok(singleReport("architecture output", { inputTokens: 7, outputTokens: 11, totalTokens: 18 }))
    ]);
    const orchestrator = createOrchestrator({
      registry,
      supervisorPolicy: supervisorFor([MANAGER, ARCHITECTURE], "sequential"),
      singleAgentExecutor: executor
    });

    const result = await orchestrator.run({ task: "Aggregate usage" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.tokenUsage).toEqual({
      inputTokens: 9,
      outputTokens: 14,
      totalTokens: 23
    });
    expect(executor.tasks()[1]).toContain("manager: manager output");
  });

  it("preserves the single path synthesis and attempt count", async () => {
    const registry = registryWith([MANAGER]);
    const multiAgentExecutor = new TokenEfficientMultiAgentExecutor({
      config: resolveConfig(SINGLE_AGENT_CONFIG),
      agentRegistry: registry
    });
    const report = singleReport("single output", {
      inputTokens: 13,
      outputTokens: 17,
      totalTokens: 30
    });
    const orchestrator = createOrchestrator({
      registry,
      supervisorPolicy: supervisorFor([MANAGER], "single"),
      singleAgentExecutor: recordingExecutor([ok(report)]),
      multiAgentExecutor
    });

    const result = await orchestrator.run({ task: "Single path" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.synthesis).toBe("single output");
    expect(result.value.tokenUsage).toEqual(report.tokenUsage);
    expect(result.value.subRuns).toHaveLength(1);
    expect(result.value.subRuns[0]?.attemptCount).toBe(1);
    expect(orchestrator.multiAgentExecutor).toBe(multiAgentExecutor);
  });
});
