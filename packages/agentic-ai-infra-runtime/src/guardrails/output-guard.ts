/**
 * Output Guard — Stage 25.5 Phase 03
 *
 * Heuristic-only output-side guard. Reads `AgentResponsePolicy` from an
 * `AgentDefinition` and inspects `DeterministicAgentOutput` for citation
 * presence and evidence coverage.
 *
 * Position: Layer 10 (per-agent or per-orchestrator depending on `guardTiming`).
 * Stage 21 D1 honored — no LLM call here. The LLM-judge variant lands in
 * Stage 42 and will live in this file alongside `HeuristicOutputGuard`.
 *
 * @umbrella Guardrails — output-side
 */
import type {
  AgentDefinition,
  AgentResponsePolicy,
  ContextPackage,
  DeterministicAgentOutput
} from "@maharudra/agentic-ai-infra-core";

/** Verdict emitted by an OutputGuard. */
export type ResponsePolicyDecision = {
  /** When false, the executor SHOULD adjust the output per `action`. */
  readonly pass: boolean;
  /** What action the executor should take when `pass: false`. */
  readonly action: "pass" | "abstain" | "ask" | "warn";
  /** Free-form human-readable reason for non-pass decisions. */
  readonly reason?: string;
  /** Computed evidence coverage in [0, 1]; undefined when no context package. */
  readonly evidenceCoverage?: number;
  /** Number of citations present on the output. */
  readonly citationCount: number;
};

/**
 * Pure helper: evaluate a `DeterministicAgentOutput` against a response policy.
 *
 * @param output - The agent's output (citations may be undefined).
 * @param contextPackage - Original context. May be undefined for context-less runs.
 * @param policy - The agent's response policy. When undefined, returns pass (D23).
 * @returns Typed decision. The executor decides how to react (abstain, ask, warn).
 */
export function evaluateResponsePolicy(
  output: DeterministicAgentOutput,
  contextPackage: ContextPackage | undefined,
  policy: AgentResponsePolicy | undefined
): ResponsePolicyDecision {
  // D23: no policy → no guard.
  if (!policy) {
    return {
      pass: true,
      action: "pass",
      citationCount: output.citations?.length ?? 0
    };
  }

  const citations = output.citations ?? [];
  const sources = contextPackage?.sources ?? [];

  // Evidence coverage is undefined when no sources are available.
  const evidenceCoverage =
    sources.length === 0 ? undefined : citations.length / sources.length;

  // requireCitations check
  if (policy.requireCitations === true && citations.length === 0) {
    return decision(false, policy, "Output has no citations.", evidenceCoverage, citations.length);
  }

  // strict-cited mode requires ≥ 1 citation regardless of the explicit flag
  if (policy.mode === "strict-cited" && citations.length === 0) {
    return decision(false, policy, "strict-cited mode requires at least one citation.", evidenceCoverage, citations.length);
  }

  // grounded mode requires ≥ 1 citation only when context sources were available
  if (policy.mode === "grounded" && sources.length > 0 && citations.length === 0) {
    return decision(false, policy, "grounded mode requires citing retrieved evidence.", evidenceCoverage, citations.length);
  }

  // minEvidenceCoverage check — only when coverage is computable
  if (
    policy.minEvidenceCoverage !== undefined &&
    evidenceCoverage !== undefined &&
    evidenceCoverage < policy.minEvidenceCoverage
  ) {
    return decision(
      false,
      policy,
      `Evidence coverage ${evidenceCoverage.toFixed(2)} below threshold ${policy.minEvidenceCoverage.toFixed(2)}.`,
      evidenceCoverage,
      citations.length
    );
  }

  return {
    pass: true,
    action: "pass",
    evidenceCoverage,
    citationCount: citations.length
  };
}

/**
 * Builds a typed policy decision from a failed check.
 *
 * The `action` is taken from `policy.onWeakEvidence` when present; defaults
 * to `"warn"` so a missing `onWeakEvidence` is never silent.
 */
function decision(
  pass: boolean,
  policy: AgentResponsePolicy,
  reason: string,
  evidenceCoverage: number | undefined,
  citationCount: number
): ResponsePolicyDecision {
  const action: ResponsePolicyDecision["action"] =
    !pass && policy.onWeakEvidence ? policy.onWeakEvidence : pass ? "pass" : "warn";

  return { pass, action, reason, evidenceCoverage, citationCount };
}

/**
 * Read-only interface for output guards.
 *
 * Phase 05 extracts this into a core type. Phase 03 ships a concrete heuristic
 * implementation that follows the same shape, ready for Phase 05's extraction.
 */
export interface OutputGuard {
  inspect(
    output: DeterministicAgentOutput,
    contextPackage: ContextPackage | undefined,
    agent: AgentDefinition | undefined
  ): ResponsePolicyDecision;
}

/**
 * Heuristic implementation of `OutputGuard` backed by `evaluateResponsePolicy`.
 *
 * Reads `agent.responsePolicy` and evaluates the output against it. Returns a
 * passing decision when the agent has no `responsePolicy` (D23 backwards-compat).
 */
export class HeuristicOutputGuard implements OutputGuard {
  inspect(
    output: DeterministicAgentOutput,
    contextPackage: ContextPackage | undefined,
    agent: AgentDefinition | undefined
  ): ResponsePolicyDecision {
    return evaluateResponsePolicy(output, contextPackage, agent?.responsePolicy);
  }
}

/**
 * No-op guard used when no policy is configured.
 *
 * Always returns pass, zero cost. Used as the default when no `responsePolicy`
 * is set on the executor or the resolved agent definition.
 */
export class NoopOutputGuard implements OutputGuard {
  inspect(output: DeterministicAgentOutput): ResponsePolicyDecision {
    return {
      pass: true,
      action: "pass",
      citationCount: output.citations?.length ?? 0
    };
  }
}
