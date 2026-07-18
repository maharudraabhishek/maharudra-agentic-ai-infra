/**
 * Single-agent eval suite — Stage 25 Phase 05.
 *
 * Runs three deterministic checks on a completed single-agent run, scoped
 * by the agent's `AgentDefinition.evalRules`. Returns a `QualityReport`
 * suitable for `EvalStore.push()`.
 *
 * Separate from `runAgentRuntimeEvals()` because the input shape differs:
 * single-agent reports lack the per-role structure required by the
 * multi-agent suite. D24 locks this separation.
 *
 * Layer 10. Deterministic. No LLM calls. No I/O.
 */

import type {
  AgentDefinition,
  AgentEvalRules,
  EvalResult,
  QualityReport
} from "@maharudra/agentic-ai-infra-core";

/**
 * Minimal shape required by `runSingleAgentEvals`. Adapted from the actual
 * `SingleAgentRunReport`; defined here as a structural interface so the
 * function depends on the smallest surface possible.
 */
export type SingleAgentEvalInput = {
  readonly selectedToolIds: readonly string[];
  readonly tokenUsage: { readonly totalTokens: number };
};

/**
 * Identifier used as `QualityReport.suiteName`. Stable across Stage 25.
 * The dashboard's Stage 26 surface keys off this exact string.
 */
export const SINGLE_AGENT_SUITE_NAME = "single-agent-safety";

/**
 * Runs the three single-agent safety checks for an agent run.
 *
 * If `definition` is undefined or `definition.evalRules` is undefined, the
 * function still returns a `QualityReport` but every check is skipped. The
 * caller is responsible for filtering out empty reports before persisting
 * if junk records are undesirable. `SingleAgentExecutor` does this filter:
 * it only invokes the function when `evalRules` is present.
 *
 * @param report - Minimal run output needed for the three checks.
 * @param definition - Optional agent definition scoping the eval rules.
 * @returns A `QualityReport` with three results. Overall status is "passed"
 *   only when every non-skipped check passes; otherwise "failed".
 */
export function runSingleAgentEvals(
  report: SingleAgentEvalInput,
  definition?: AgentDefinition
): QualityReport {
  const rules: AgentEvalRules = definition?.evalRules ?? {};

  const results: EvalResult[] = [
    checkRequiredTools(report, rules),
    checkForbiddenTools(report, rules),
    checkHardBudget(report, rules)
  ];

  const anyFailed = results.some((r) => r.status === "failed");
  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;

  return {
    suiteName: SINGLE_AGENT_SUITE_NAME,
    status: anyFailed ? "failed" : "passed",
    total: results.length,
    passed,
    failed,
    skipped,
    results
  };
}

// -------------------------------------------------------------------------
// Internal: per-rule checks
// -------------------------------------------------------------------------

/**
 * Verifies every id in `rules.requiredTools` appears in
 * `report.selectedToolIds`. Skipped when `requiredTools` is undefined or empty.
 */
function checkRequiredTools(
  report: SingleAgentEvalInput,
  rules: AgentEvalRules
): EvalResult {
  const required = rules.requiredTools;
  if (required === undefined || required.length === 0) {
    return evalResult("required-tools", "skipped", "No required tools configured.");
  }

  const selected = new Set(report.selectedToolIds);
  const missing = required.filter((id) => !selected.has(id));

  if (missing.length > 0) {
    return evalResult(
      "required-tools",
      "failed",
      `Missing required tool(s): ${missing.join(", ")}.`
    );
  }

  return evalResult(
    "required-tools",
    "passed",
    `All ${required.length} required tool(s) selected.`
  );
}

/**
 * Verifies no id in `rules.forbiddenTools` appears in
 * `report.selectedToolIds`. Skipped when `forbiddenTools` is undefined or empty.
 */
function checkForbiddenTools(
  report: SingleAgentEvalInput,
  rules: AgentEvalRules
): EvalResult {
  const forbidden = rules.forbiddenTools;
  if (forbidden === undefined || forbidden.length === 0) {
    return evalResult("forbidden-tools", "skipped", "No forbidden tools configured.");
  }

  const forbiddenSet = new Set(forbidden);
  const violations = report.selectedToolIds.filter((id) => forbiddenSet.has(id));

  if (violations.length > 0) {
    return evalResult(
      "forbidden-tools",
      "failed",
      `Forbidden tool(s) selected: ${violations.join(", ")}.`
    );
  }

  return evalResult(
    "forbidden-tools",
    "passed",
    `No forbidden tools selected (allowlist of ${forbidden.length} avoided).`
  );
}

/**
 * Verifies `report.tokenUsage.totalTokens <= rules.hardBudget`. Skipped when
 * `hardBudget` is undefined. Distinct from `budgetPolicy.maxTokens` (which
 * CHANGES executor behavior at planning time) — `hardBudget` OBSERVES the
 * result without changing behavior.
 */
function checkHardBudget(
  report: SingleAgentEvalInput,
  rules: AgentEvalRules
): EvalResult {
  const hardBudget = rules.hardBudget;
  if (hardBudget === undefined) {
    return evalResult("hard-budget", "skipped", "No hard budget configured.");
  }

  const used = report.tokenUsage.totalTokens;
  if (used > hardBudget) {
    return evalResult(
      "hard-budget",
      "failed",
      `Used ${used} tokens; hard budget is ${hardBudget}.`
    );
  }

  return evalResult("hard-budget", "passed", `Used ${used} of ${hardBudget} tokens.`);
}

/**
 * Creates one `EvalResult` with a human-readable name derived from the id.
 */
function evalResult(
  id: string,
  status: "passed" | "failed" | "skipped",
  message: string
): EvalResult {
  return {
    id,
    name: id.replaceAll("-", " "),
    status,
    message
  };
}
