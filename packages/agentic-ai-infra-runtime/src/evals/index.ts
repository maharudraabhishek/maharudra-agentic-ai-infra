import type {
  AgentRole,
  EvalResult,
  EvalStatus,
  QualityReport,
  SafeTrajectoryEvent
} from "@maharudra/agentic-ai-infra-core";

export * from "./retrieval-evals.js";
export * from "./eval-store.js";
export * from "./retrieval-quality-suite.js";
export * from "./agent-evaluator.js";
export * from "./dataset-loader.js";
export * from "./dataset-evaluator.js";
export * from "./llm-judge-evaluator.js";
import type { RuntimeMultiAgentRunReport } from "../agents/index.js";

/**
 * Input for deterministic trajectory and token-efficiency eval helpers.
 */
export type AgentRuntimeEvalInput = {
  readonly report?: RuntimeMultiAgentRunReport;
  readonly trajectory?: readonly SafeTrajectoryEvent[];
  readonly requiredRoles?: readonly AgentRole[];
  readonly forbiddenTools?: readonly string[];
  readonly hardBudget?: number;
};

/**
 * Builds deterministic framework-level eval results for agent runtime behavior.
 */
export function runAgentRuntimeEvals(input: AgentRuntimeEvalInput): QualityReport {
  const results: EvalResult[] = [
    checkRequiredRoles(input),
    checkForbiddenTools(input),
    checkNoContextDuplication(input),
    checkBudget(input),
    checkSafeTrajectory(input)
  ];
  const failed = results.filter((result) => result.status === "failed").length;
  const skipped = results.filter((result) => result.status === "skipped").length;
  const passed = results.filter((result) => result.status === "passed").length;

  return {
    suiteName: "agent-runtime-safety",
    status: failed > 0 ? "failed" : skipped === results.length ? "skipped" : "passed",
    total: results.length,
    passed,
    failed,
    skipped,
    results
  };
}

/**
 * Checks that expected roles were routed.
 */
function checkRequiredRoles(input: AgentRuntimeEvalInput): EvalResult {
  if (!input.report || !input.requiredRoles?.length) {
    return skipped("required-roles", "No report or required roles were supplied.");
  }

  const routed = new Set(input.report.routedRoles);
  const missing = input.requiredRoles.filter((role) => !routed.has(role));

  return missing.length
    ? failed("required-roles", `Missing required roles: ${missing.join(", ")}.`)
    : passed("required-roles", "All required roles were routed.");
}

/**
 * Checks that forbidden tools were not used.
 */
function checkForbiddenTools(input: AgentRuntimeEvalInput): EvalResult {
  if (!input.trajectory?.length || !input.forbiddenTools?.length) {
    return skipped("forbidden-tools", "No trajectory or forbidden tool list was supplied.");
  }

  const used = input.trajectory
    .map((event) => event.toolName)
    .filter((toolName): toolName is string => Boolean(toolName));
  const forbidden = used.filter((toolName) => input.forbiddenTools?.includes(toolName));

  return forbidden.length
    ? failed("forbidden-tools", `Forbidden tools were used: ${forbidden.join(", ")}.`)
    : passed("forbidden-tools", "No forbidden tools were used.");
}

/**
 * Checks that role slices did not duplicate full shared context.
 */
function checkNoContextDuplication(input: AgentRuntimeEvalInput): EvalResult {
  if (!input.report) {
    return skipped("context-duplication", "No multi-agent report was supplied.");
  }

  const duplicated = input.report.roleSlices.some(
    (slice) => (slice.tokenEstimate ?? 0) >= input.report!.sharedContextTokenEstimate
  );

  return duplicated
    ? failed("context-duplication", "A role slice duplicated the full shared context.")
    : passed("context-duplication", "Role slices stayed smaller than shared context.");
}

/**
 * Checks hard token budget behavior.
 */
function checkBudget(input: AgentRuntimeEvalInput): EvalResult {
  if (!input.report || !input.hardBudget) {
    return skipped("token-budget", "No report or hard budget was supplied.");
  }

  return input.report.tokenUsage.totalTokens > input.hardBudget
    ? failed("token-budget", "Token usage exceeded the hard budget.")
    : passed("token-budget", "Token usage stayed within the hard budget.");
}

/**
 * Checks trajectory records for unsafe metadata field names.
 */
function checkSafeTrajectory(input: AgentRuntimeEvalInput): EvalResult {
  if (!input.trajectory?.length) {
    return skipped("safe-trajectory", "No trajectory records were supplied.");
  }

  const serialized = JSON.stringify(input.trajectory);
  const unsafePattern = /approvalText|rawTaskText|taskText|"task"\s*:|vector|rawSql|stackTrace|commandOutput/i;

  return unsafePattern.test(serialized)
    ? failed("safe-trajectory", "Trajectory contains unsafe metadata.")
    : passed("safe-trajectory", "Trajectory contains safe metadata only.");
}

/**
 * Creates a passed eval result.
 */
function passed(id: string, message: string): EvalResult {
  return result(id, "passed", message);
}

/**
 * Creates a failed eval result.
 */
function failed(id: string, message: string): EvalResult {
  return result(id, "failed", message);
}

/**
 * Creates a skipped eval result.
 */
function skipped(id: string, message: string): EvalResult {
  return result(id, "skipped", message);
}

/**
 * Creates one eval result with a stable display name.
 */
function result(id: string, status: EvalStatus, message: string): EvalResult {
  return {
    id,
    name: id.replaceAll("-", " "),
    status,
    message
  };
}

// Stage 25 — Single-agent evaluation.
export {
  SINGLE_AGENT_SUITE_NAME,
  runSingleAgentEvals
} from "./single-agent-evals.js";

export type { SingleAgentEvalInput } from "./single-agent-evals.js";
