import { describe, expect, it } from "vitest";
import {
  DefaultConfigValidator,
  fail,
  ok,
  type AgentDefinitionRegistry,
  type AgenticInfraProjectConfig,
  type ContentGuard,
  type FeedbackHook,
  type SupervisorPolicy
} from "@maharudra/agentic-ai-infra-core";
import {
  createAgentDefinitionRegistry,
  InMemoryAgentDefinitionRegistry,
  SingleAgentExecutor,
  TokenEfficientMultiAgentExecutor
} from "../../src/agents/index.js";
import {
  AgentOrchestrator,
  DefaultSupervisorPolicy
} from "../../src/orchestrator/index.js";

const SINGLE_AGENT_CONFIG: AgenticInfraProjectConfig = {
  project: { name: "Orchestrator Test", slug: "orchestrator-test" },
  profiles: ["minimal"]
};

/**
 * Resolves test configuration before executor construction so each test uses
 * the same validated runtime settings as production callers.
 *
 * @param input Declarative project configuration used by a test fixture.
 * @returns The validated resolved configuration for executor construction.
 * @throws Error when the fixture itself is invalid, because the test cannot
 *   exercise orchestration meaningfully in that state.
 */
function resolveConfig(input: AgenticInfraProjectConfig) {
  const result = new DefaultConfigValidator().validate(input);
  if (!result.ok) {
    throw new Error(`Test config failed validation: ${result.error.message}`);
  }
  return result.value;
}

/**
 * Creates a real single-agent orchestration stack with optional seams for one
 * focused test. The registry is supplied to both routing and execution so
 * policy selection and executor enforcement observe one definition source.
 *
 * @param options Optional registry, policy, executor, and guard implementations.
 * @returns A constructed orchestrator ready for a deterministic local run.
 */
function createOrchestrator(options: {
  readonly registry?: AgentDefinitionRegistry;
  readonly supervisorPolicy?: SupervisorPolicy;
  readonly singleAgentExecutor?: Pick<SingleAgentExecutor, "execute">;
  readonly multiAgentExecutor?: TokenEfficientMultiAgentExecutor;
  readonly contentGuard?: ContentGuard;
  readonly feedbackHook?: FeedbackHook;
} = {}): AgentOrchestrator {
  const registry = options.registry ?? createAgentDefinitionRegistry();
  const singleAgentExecutor =
    options.singleAgentExecutor ??
    new SingleAgentExecutor({
      config: resolveConfig(SINGLE_AGENT_CONFIG),
      agentRegistry: registry
    });

  return new AgentOrchestrator({
    supervisorPolicy: options.supervisorPolicy ?? new DefaultSupervisorPolicy(),
    singleAgentExecutor,
    multiAgentExecutor: options.multiAgentExecutor ?? new TokenEfficientMultiAgentExecutor({
      config: resolveConfig(SINGLE_AGENT_CONFIG),
      agentRegistry: registry
    }),
    agentRegistry: registry,
    contentGuard: options.contentGuard,
    feedbackHook: options.feedbackHook
  });
}

describe("AgentOrchestrator", () => {
  it("composes a single-agent run end to end", async () => {
    const result = await createOrchestrator().run({
      task: "Plan the local runtime architecture"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.kind).toBe("orchestrator");
    expect(result.value.subRuns).toHaveLength(1);
    expect(result.value.subRuns[0]?.executorReport.kind).toBe("single");
    expect(result.value.plannedAgents).toEqual(["manager"]);
  });

  it("uses the single executor summary as the orchestration synthesis", async () => {
    const result = await createOrchestrator().run({
      task: "Plan an implementation"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const subRun = result.value.subRuns[0];
    expect(subRun?.executorReport.kind).toBe("single");
    if (!subRun || subRun.executorReport.kind !== "single") return;
    expect(result.value.synthesis).toBe(subRun.executorReport.report.result.summary);
  });

  it("records one attempt when retry composition is not enabled", async () => {
    const result = await createOrchestrator().run({
      task: "Review the security boundary"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.subRuns[0]?.attemptCount).toBe(1);
  });

  it("reports the default content guard pass-through verdict", async () => {
    const result = await createOrchestrator().run({
      task: "Write an architecture plan"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.contentVerdict).toEqual({ safe: true, action: "pass" });
  });

  it("reports the default feedback hook pass-through verdict", async () => {
    const result = await createOrchestrator().run({
      task: "Write an implementation plan"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.feedback).toEqual({ action: "accept" });
  });

  it("propagates the supervisor failure when no manager is registered", async () => {
    const registry = new InMemoryAgentDefinitionRegistry().register({
      id: "security-review",
      role: "security-reviewer"
    });
    const result = await createOrchestrator({ registry }).run({
      task: "Review the security boundary"
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("agent.no-manager-registered");
  });

  it("normalizes a returned executor failure to stable fields", async () => {
    const expectedError = {
      code: "agent.invalid-mode" as const,
      message: "Injected executor failure.",
      severity: "recoverable" as const
    };
    const singleAgentExecutor = {
      execute: async () => fail(expectedError)
    };
    const result = await createOrchestrator({ singleAgentExecutor }).run({
      task: "Plan an implementation"
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error).toEqual({
      code: expectedError.code,
      message: "Agent execution returned a failure.",
      severity: expectedError.severity
    });
  });

  it("normalizes returned supervisor and executor error payloads", async () => {
    const unsafeError = {
      code: "runtime.permission-denied" as const,
      message: "C:\\private\\secret-message",
      severity: "fatal" as const,
      refusalReason: "agent-allowlist" as const,
      cause: new Error("secret cause"),
      issues: [{
        path: "C:\\private",
        code: "runtime.permission-denied" as const,
        message: "secret issue",
        severity: "fatal" as const
      }]
    };
    const supervisorFailure = await createOrchestrator({
      supervisorPolicy: { route: () => fail(unsafeError) }
    }).run({ task: "Review returned errors" });
    const executorFailure = await createOrchestrator({
      singleAgentExecutor: { execute: async () => fail(unsafeError) }
    }).run({ task: "Review returned errors" });

    expect(supervisorFailure.ok).toBe(false);
    expect(executorFailure.ok).toBe(false);
    if (!supervisorFailure.ok && !executorFailure.ok) {
      expect(supervisorFailure.error).toEqual({
        code: "runtime.permission-denied",
        message: "Supervisor routing returned a failure.",
        severity: "fatal",
        refusalReason: "agent-allowlist"
      });
      expect(executorFailure.error).toEqual({
        code: "runtime.permission-denied",
        message: "Agent execution returned a failure.",
        severity: "fatal",
        refusalReason: "agent-allowlist"
      });
      expect(JSON.stringify(supervisorFailure.error)).not.toContain("private");
      expect(JSON.stringify(executorFailure.error)).not.toContain("secret");
    }
  });

  it("replaces an unknown injected error code with the canonical fallback", async () => {
    const result = await createOrchestrator({
      singleAgentExecutor: {
        execute: async () => fail({
          code: "evil.code",
          message: "C:\\private\\secret-message",
          severity: "fatal"
        } as never)
      }
    }).run({ task: "Review unknown error normalization" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        code: "framework.internal-error",
        message: "Agent execution returned a failure.",
        severity: "fatal"
      });
    }
  });

  it("preserves a supplied trace id and generates one when it is omitted", async () => {
    const orchestrator = createOrchestrator();
    const supplied = await orchestrator.run({
      task: "Plan an implementation",
      traceId: "trace-from-caller"
    });
    const generated = await orchestrator.run({ task: "Plan an implementation" });

    expect(supplied.ok).toBe(true);
    expect(generated.ok).toBe(true);
    if (!supplied.ok || !generated.ok) return;

    expect(supplied.value.traceId).toBe("trace-from-caller");
    expect(generated.value.traceId.length).toBeGreaterThan(0);
  });

  it("uses an injected content guard verdict", async () => {
    const registry = new InMemoryAgentDefinitionRegistry()
      .register({ id: "manager", role: "manager" })
      .register({ id: "architecture", role: "architecture-reviewer" });
    const manager = registry.findById("manager");
    const architecture = registry.findById("architecture");
    if (!manager || !architecture) {
      throw new Error("Orchestrator test fixture must contain both planned agents.");
    }
    const supervisorPolicy: SupervisorPolicy = {
      route: () => ok({ agents: [manager, architecture], composition: "sequential" })
    };
    let inspected = false;
    const contentGuard: ContentGuard = {
      inspect: async (input) => {
        inspected = true;
        expect(input.direction).toBe("output");
        return { safe: false, action: "warn", reason: "x" };
      }
    };
    const result = await createOrchestrator({
      registry,
      supervisorPolicy,
      contentGuard
    }).run({
      task: "Plan an implementation"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(inspected).toBe(true);
    expect(result.value.contentVerdict).toEqual({ safe: false, action: "warn" });
    expect(result.value.plannedAgents).toEqual(["manager", "architecture-reviewer"]);
    expect(result.value.subRuns).toHaveLength(2);
    expect(result.value.warnings).toBeUndefined();
  });

  it("uses an injected feedback hook verdict", async () => {
    let evaluated = false;
    const feedbackHook: FeedbackHook = {
      evaluate: async (input) => {
        evaluated = true;
        expect(input.runId.length).toBeGreaterThan(0);
        expect(input.traceId.length).toBeGreaterThan(0);
        return { action: "escalate" };
      }
    };
    const result = await createOrchestrator({ feedbackHook }).run({
      task: "Plan an implementation"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(evaluated).toBe(true);
    expect(result.value.feedback.action).toBe("escalate");
  });

  it("canonicalizes a forged supervisor definition by registered id", async () => {
    const registry = new InMemoryAgentDefinitionRegistry().register({
      id: "manager",
      role: "manager"
    });
    const supervisorPolicy: SupervisorPolicy = {
      route: () => ok({
        agents: [{
          id: "manager",
          role: "security-reviewer",
          allowedTools: [],
          responsePolicy: { requireCitations: true, onWeakEvidence: "abstain" }
        }],
        composition: "single"
      })
    };
    const result = await createOrchestrator({ registry, supervisorPolicy }).run({
      task: "Review route identity",
      traceId: "trace-canonical"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.plannedAgents).toEqual(["manager"]);
    expect(result.value.subRuns[0]?.agentId).toBe("manager");
    expect(result.value.subRuns[0]?.role).toBe("manager");
    expect(result.value.subRuns[0]?.executorReport.kind).toBe("single");
    if (result.value.subRuns[0]?.executorReport.kind === "single") {
      expect(result.value.subRuns[0].executorReport.report.traceId).toBe("trace-canonical");
      expect(result.value.subRuns[0].executorReport.report.agentId).toBe("manager");
      expect(result.value.subRuns[0].executorReport.report.role).toBe("manager");
    }
  });

  it("fails closed when a supervisor selects an unregistered definition", async () => {
    const supervisorPolicy: SupervisorPolicy = {
      route: () => ok({
        agents: [{ id: "forged", role: "manager" }],
        composition: "single"
      })
    };
    const result = await createOrchestrator({ supervisorPolicy }).run({
      task: "Review route identity"
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("agent.definition-not-found");
    }
  });

  it("sanitizes thrown supervisor and executor failures", async () => {
    const supervisorFailure = await createOrchestrator({
      supervisorPolicy: {
        route: () => {
          throw new Error("C:\\private\\supervisor-secret");
        }
      }
    }).run({ task: "Review failure handling" });
    const executorFailure = await createOrchestrator({
      singleAgentExecutor: {
        execute: async () => {
          throw new Error("C:\\private\\executor-secret");
        }
      }
    }).run({ task: "Review failure handling" });

    expect(supervisorFailure.ok).toBe(false);
    expect(executorFailure.ok).toBe(false);
    if (!supervisorFailure.ok && !executorFailure.ok) {
      expect(supervisorFailure.error.message).not.toContain("private");
      expect(supervisorFailure.error.cause).toBeUndefined();
      expect(executorFailure.error.message).not.toContain("private");
      expect(executorFailure.error.cause).toBeUndefined();
    }
  });

  it("rejects executor reports that spoof canonical identity or trace", async () => {
    const result = await createOrchestrator({
      singleAgentExecutor: {
        execute: async () => ok({
          runId: "forged-run",
          traceId: "forged-trace",
          agentId: "forged-agent",
          role: "security-reviewer",
          task: { taskHash: "hash", taskType: "test" },
          mode: "single-agent" as const,
          selectedToolIds: [],
          contextSourceCount: 0,
          tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          result: { summary: "forged", steps: [], warnings: [] }
        })
      }
    }).run({ task: "Review report identity", traceId: "expected-trace" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("agent.invalid-route");
    }
  });

  it("sanitizes thrown guard and feedback failures", async () => {
    const guardFailure = await createOrchestrator({
      contentGuard: {
        inspect: async () => {
          throw new Error("C:\\private\\guard-secret");
        }
      }
    }).run({ task: "Review guard handling" });
    const feedbackFailure = await createOrchestrator({
      feedbackHook: {
        evaluate: async () => {
          throw new Error("C:\\private\\feedback-secret");
        }
      }
    }).run({ task: "Review feedback handling" });

    expect(guardFailure.ok).toBe(false);
    expect(feedbackFailure.ok).toBe(false);
    if (!guardFailure.ok && !feedbackFailure.ok) {
      expect(guardFailure.error.message).not.toContain("private");
      expect(guardFailure.error.cause).toBeUndefined();
      expect(feedbackFailure.error.message).not.toContain("private");
      expect(feedbackFailure.error.cause).toBeUndefined();
    }
  });

  it("rejects invalid seam verdicts and strips free-form reasons", async () => {
    const invalidGuard = await createOrchestrator({
      contentGuard: {
        inspect: async () => ({ safe: true, action: "invalid" }) as never
      }
    }).run({ task: "Review guard output" });
    const invalidFeedback = await createOrchestrator({
      feedbackHook: {
        evaluate: async () => ({ action: "invalid" }) as never
      }
    }).run({ task: "Review feedback output" });
    const normalized = await createOrchestrator({
      contentGuard: {
        inspect: async () => ({
          safe: true,
          action: "warn",
          reason: "C:\\private\\guard-secret"
        })
      },
      feedbackHook: {
        evaluate: async () => ({
          action: "accept",
          reason: "C:\\private\\feedback-secret"
        })
      }
    }).run({ task: "Review normalized output" });

    expect(invalidGuard.ok).toBe(false);
    expect(invalidFeedback.ok).toBe(false);
    expect(normalized.ok).toBe(true);
    if (normalized.ok) {
      expect(normalized.value.contentVerdict.reason).toBeUndefined();
      expect(normalized.value.feedback.reason).toBeUndefined();
    }
  });

  it("rejects unsafe caller trace identifiers", async () => {
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
      const result = await createOrchestrator().run({ task: "Review trace", traceId });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("agent.invalid-route");
      }
    }
  });

  it("enforces content block and rewrite actions", async () => {
    const blocked = await createOrchestrator({
      contentGuard: {
        inspect: async () => ({ safe: false, action: "block", reason: "Unsafe output." })
      }
    }).run({ task: "Create a plan" });
    const rewritten = await createOrchestrator({
      contentGuard: {
        inspect: async () => ({
          safe: true,
          action: "rewrite",
          rewrittenText: "Sanitized plan."
        })
      }
    }).run({ task: "Create a plan" });

    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.error.code).toBe("output.unsafe");
    }
    expect(rewritten.ok).toBe(true);
    if (rewritten.ok) {
      expect(rewritten.value.synthesis).toBe("Sanitized plan.");
    }
  });
});
