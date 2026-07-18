import { describe, expect, it } from "vitest";
import type { SafeTaskMetadata } from "@maharudra/agentic-ai-infra-core";
import type {
  RuntimeMultiAgentRunReport,
  SingleAgentRunReport
} from "../../src/agents/index.js";
import type {
  OrchestratorReport,
  OrchestratorSubRun
} from "../../src/orchestrator/index.js";

const SAFE_TASK: SafeTaskMetadata = {
  taskHash: "task-hash",
  taskType: "implementation"
};

const SINGLE_REPORT: SingleAgentRunReport = {
  runId: "single-run",
  traceId: "single-trace",
  agentId: "manager",
  role: "manager",
  task: SAFE_TASK,
  mode: "single-agent",
  selectedToolIds: [],
  contextSourceCount: 0,
  tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  result: { summary: "single summary", steps: [], warnings: [] }
};

const MULTI_REPORT: RuntimeMultiAgentRunReport = {
  runId: "multi-run",
  traceId: "multi-trace",
  task: SAFE_TASK,
  routedRoles: ["manager"],
  sharedContextPacketId: "packet-1",
  roleSlices: [],
  outputs: [],
  synthesis: "multi synthesis",
  tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  naiveTokenEstimate: 0,
  sharedContextTokenEstimate: 0,
  estimatedTokenSavings: 0,
  contextBuildCount: 1,
  noNetworkCalls: true,
  roleOutputs: []
};

describe("OrchestratorReport", () => {
  it("narrows a single executor sub-run to its single-agent report", () => {
    const subRun: OrchestratorSubRun = {
      agentId: "manager",
      role: "manager",
      attemptCount: 1,
      executorReport: { kind: "single", report: SINGLE_REPORT }
    };

    if (subRun.executorReport.kind !== "single") return;

    expect(subRun.executorReport.report.result.summary).toBe("single summary");
    expect("synthesis" in subRun.executorReport.report).toBe(false);
  });

  it("narrows a multi executor sub-run to its multi-agent report", () => {
    const subRun: OrchestratorSubRun = {
      agentId: "manager",
      role: "manager",
      attemptCount: 1,
      executorReport: { kind: "multi", report: MULTI_REPORT }
    };

    if (subRun.executorReport.kind !== "multi") return;

    expect(subRun.executorReport.report.synthesis).toBe("multi synthesis");
    expect(subRun.executorReport.report.roleOutputs).toEqual([]);
  });

  it("accepts the minimal aggregate report while optional details remain omittable", () => {
    const report: OrchestratorReport = {
      kind: "orchestrator",
      runId: "orchestrator-run",
      traceId: "orchestrator-trace",
      task: SAFE_TASK,
      plannedAgents: ["manager"],
      subRuns: [],
      synthesis: "aggregate synthesis",
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      contentVerdict: { safe: true, action: "pass" },
      feedback: { action: "accept" }
    };

    expect(report.kind).toBe("orchestrator");
    expect(report.contentVerdict.safe).toBe(true);
    expect(report.feedback.action).toBe("accept");
    expect(report.response).toBeUndefined();
    expect(report.refusals).toBeUndefined();
    expect(report.warnings).toBeUndefined();
  });

  it("allows both initial and retried sub-run attempt counts", () => {
    // Retry visibility stays as an invocation count; no extra retry-result shape is needed.
    const initialAttempt: OrchestratorSubRun = {
      agentId: "manager",
      role: "manager",
      attemptCount: 1,
      executorReport: { kind: "single", report: SINGLE_REPORT }
    };
    const retriedAttempt: OrchestratorSubRun = {
      ...initialAttempt,
      attemptCount: 2
    };

    expect(initialAttempt.attemptCount).toBe(1);
    expect(retriedAttempt.attemptCount).toBe(2);
  });
});
