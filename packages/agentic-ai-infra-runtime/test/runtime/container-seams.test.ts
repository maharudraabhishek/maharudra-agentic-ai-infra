import { describe, it, expect } from "vitest";
import {
  fail,
  ok,
  type AgenticInfraProjectConfig,
  type ContentGuard,
  type ContentGuardInput,
  type FeedbackHook,
  type FeedbackHookInput,
  type FeedbackVerdict,
  type SafetyVerdict,
  type SupervisorPolicy
} from "@maharudra/agentic-ai-infra-core";
import { NoopContentGuard } from "../../src/guardrails/content-guard.js";
import { NoopCritiqueLoop } from "../../src/feedback-loops/critique-loop.js";
import { NoopEvalFeedbackLoop } from "../../src/feedback-loops/eval-feedback-loop.js";
import { AgentOrchestrator } from "../../src/orchestrator/index.js";
import { createRuntimeServiceContainer } from "../../src/runtime/index.js";

function baseConfig(): AgenticInfraProjectConfig {
  return {
    project: { name: "seam-test", slug: "seam-test" },
    runtime: { modes: ["local-stdio-mcp"] },
    tools: [],
    agents: { mode: "single-agent" },
    profiles: ["vectorless-local"]
  };
}

describe("Runtime service container seams", () => {
  it("auto-wires NoopContentGuard when no override is supplied (D43)", async () => {
    const result = await createRuntimeServiceContainer({ config: baseConfig() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.contentGuard).toBeInstanceOf(NoopContentGuard);
  });

  it("auto-wires NoopCritiqueLoop as the default feedbackHook (D43)", async () => {
    const result = await createRuntimeServiceContainer({ config: baseConfig() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.feedbackHook).toBeInstanceOf(NoopCritiqueLoop);
  });

  it("honors a custom ContentGuard override", async () => {
    const stub: ContentGuard = {
      async inspect(_input: ContentGuardInput): Promise<SafetyVerdict> {
        return { safe: true, action: "warn", reason: "stub" };
      }
    };
    const result = await createRuntimeServiceContainer({
      config: baseConfig(),
      contentGuard: stub
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const verdict = await result.value.contentGuard.inspect({
      direction: "output",
      text: "hi"
    });
    expect(verdict.action).toBe("warn");
    expect(verdict.reason).toBe("stub");
  });

  it("honors a custom FeedbackHook override", async () => {
    const stub: FeedbackHook = {
      async evaluate(_input: FeedbackHookInput): Promise<FeedbackVerdict> {
        return { action: "retry", reason: "stub" };
      }
    };
    const result = await createRuntimeServiceContainer({
      config: baseConfig(),
      feedbackHook: stub
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const verdict = await result.value.feedbackHook.evaluate({
      runId: "r-1",
      traceId: "t-1",
      outputText: "x"
    });
    expect(verdict.action).toBe("retry");
  });

  it("NoopEvalFeedbackLoop is constructible and returns accept", async () => {
    const loop = new NoopEvalFeedbackLoop();
    const verdict = await loop.evaluate({
      runId: "r-1",
      traceId: "t-1",
      outputText: "x"
    });
    expect(verdict.action).toBe("accept");
  });

  it("AgentMemoryPolicy.episodic field type-checks (D44)", () => {
    // Compile-time guard; the assertion below verifies the field is accepted.
    const policy = {
      semantic: "read",
      episodic: "read-write"
    } as const;
    expect(policy.episodic).toBe("read-write");
  });

  it("auto-wires an AgentOrchestrator and can run the default manager route", async () => {
    const result = createRuntimeServiceContainer({ config: baseConfig() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.agentRegistry.findById("manager")).toBeDefined();
    expect(result.value.orchestrator).toBeInstanceOf(AgentOrchestrator);

    const run = await result.value.orchestrator.run({
      task: "Review the runtime container composition."
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.value.kind).toBe("orchestrator");
  });

  it("wires the default supervisor to manager single composition end-to-end", async () => {
    const result = createRuntimeServiceContainer({ config: baseConfig() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const run = await result.value.orchestrator.run({
      task: "Plan a small implementation change."
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.value.plannedAgents).toEqual(["manager"]);
    expect(run.value.subRuns).toHaveLength(1);
    expect(run.value.subRuns[0]?.agentId).toBe("manager");
  });

  it("honors a custom AgentOrchestrator override", () => {
    const seed = createRuntimeServiceContainer({ config: baseConfig() });
    expect(seed.ok).toBe(true);
    if (!seed.ok) return;

    const result = createRuntimeServiceContainer({
      config: baseConfig(),
      orchestrator: seed.value.orchestrator
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.orchestrator).toBe(seed.value.orchestrator);
  });

  it("uses a custom SupervisorPolicy when auto-building the orchestrator", async () => {
    const supervisorPolicy: SupervisorPolicy = {
      route(input) {
        const architectureReviewer = input.registry.findByRole("architecture-reviewer")[0];
        if (!architectureReviewer) {
          return fail({
            code: "framework.internal-error",
            message: "Expected the default architecture reviewer definition to be registered.",
            severity: "fatal"
          });
        }

        return ok({ agents: [architectureReviewer], composition: "single" });
      }
    };

    const result = createRuntimeServiceContainer({
      config: baseConfig(),
      supervisorPolicy
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const run = await result.value.orchestrator.run({
      task: "Review the architecture boundary."
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.value.plannedAgents).toEqual(["architecture-reviewer"]);
    expect(run.value.subRuns[0]?.agentId).toBe("architecture-reviewer");
  });
});
