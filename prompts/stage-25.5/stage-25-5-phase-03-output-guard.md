# Stage 25.5 Phase 03 — Guardrails: Output Guard + ResponsePolicy + Expanded BudgetPolicy
## Claude Code Prompt — MahaRudra Agentic AI Infra

---

## BEFORE YOU START — READ THIS FIRST

**Platform:** Windows 11, PowerShell, Node >= 20, pnpm only
**CI command:** `pnpm.cmd run ci`
**Current test count:** read from `STATUS.md` head (Phase 02 baseline)
**Expected after this phase:** Phase 02 count + ~12 tests

This phase wires the OUTPUT-side guard. It uses the citation propagation
shipped in Phase 02 and the typed shapes from Phase 01. **Three concerns
land together**: ResponsePolicy (new), expanded BudgetPolicy (3 new fields),
OutputGuard heuristic implementation. They co-ship because they each
exercise the same executor seams.

`AbortController` timeout pattern is lifted from
`runtime/src/llm/anthropic-llm-provider.ts:118`. Do NOT reinvent it.

---

## CONTEXT — WHAT IS DONE

- **D20 (LOCKED):** `allowedTools` is a tightening filter on top of role × category floor (Stage 25). Unchanged.
- **D22 (LOCKED):** non-optional container slots auto-wired from config. Pattern reused.
- **D23 (LOCKED):** default behavior unchanged when policy is absent.
- **D26 (Phase 01):** Input Guard wired; non-fatal.
- **D27 / D28 (Phase 02):** `DeterministicAgentOutput.citations` populated by multi-agent executor.
- **Stage 21 D2:** `checkGroundedness` in `runtime/src/evals/retrieval-evals.ts:84` — REUSED, not modified.
- **AgentBudgetPolicy today:** one field only — `maxTokens: number` (`core/src/agents/types.ts:169–172`).

---

## NEW LOCKED DECISIONS — Stage 25.5 Phase 03

### D30 — `AgentResponsePolicy` shape
Closed-taxonomy enums; no free-form strings. Reuses the response-mode names from `chat-gpt-v2-arch.md` Layer 11 (the source agreed and rejected as a new layer in D0, but the user-facing knob vocabulary stays):

```typescript
export type AgentResponseMode =
  | "freeform"      // default — no constraint
  | "grounded"      // require ≥ 1 citation; warn on weak evidence
  | "strict-cited"  // require every finding to cite; block on weak evidence
  | "json-schema";  // reserved; enforcement deferred to Stage 26 (depends on outputSchema)

export type AgentOnWeakEvidence = "abstain" | "ask" | "warn";

export type AgentGuardTiming =
  | "per-orchestrator"  // default — runs once at AgentOrchestrator return (Stage 26)
  | "per-agent";        // runs after each agent in a multi-agent run

export type AgentResponsePolicy = {
  readonly mode?: AgentResponseMode;
  readonly requireCitations?: boolean;
  readonly minEvidenceCoverage?: number;       // in [0, 1]
  readonly onWeakEvidence?: AgentOnWeakEvidence;
  readonly guardTiming?: AgentGuardTiming;
};
```

`guardTiming = "per-tool"` is **deliberately not in the taxonomy** — Stage 21 D1 forbids Layer 9 from calling Layer 11. If a heuristic-only per-tool guard is later needed, the Input Guard (Phase 01) is the right home, not this taxonomy.

### D31 — `AgentBudgetPolicy` expanded
Three new optional fields with the design-doc defaults:

```typescript
export type AgentBudgetPolicy = {
  readonly maxTokens: number;                  // existing (required)
  readonly maxToolCalls?: number;              // default 8 when policy present
  readonly maxRuntimeMs?: number;              // default 120000 when policy present
  readonly maxIterations?: number;             // no default — Stage 48 SelfCritique consumes it
};
```

When `budgetPolicy` is set on an `AgentDefinition`, missing optional fields default to: `maxToolCalls=8`, `maxRuntimeMs=120000`. `maxIterations` has no default because no in-run iteration exists yet (Stage 48). When `budgetPolicy` is undefined entirely, **no defaults apply** — executor behavior matches Stage 25 (D23).

### D32 — Output Guard runs at per-orchestrator default; per-agent opt-in
Two timing levels are implementable today:
- **per-orchestrator** (default): the orchestrator runs the guard once on its final merged output. Stage 26 wires this entry point. Phase 03 ships the guard module and a callable function; the orchestrator wiring is Stage 26.
- **per-agent** (opt-in): `TokenEfficientMultiAgentExecutor` runs the guard after each role's `DeterministicAgentOutput` is built but before `roleOutputs` is finalized. Phase 03 wires this for the multi-agent path.

Single-agent extension of `responsePolicy` is in scope here: `SingleAgentRunReport` gains an optional `response` field (the per-orchestrator guard runs at SingleAgentExecutor return for single-agent runs, since there is no orchestrator above it).

### D33 — Three new error codes
Added to `core/src/errors/index.ts`:
- `agent.weak-evidence` — when `onWeakEvidence === "abstain"` and evidence coverage < threshold
- `agent.tool-call-exceeded` — when an in-run tool-call counter exceeds `maxToolCalls`
- `agent.timeout` — when `AbortController` fires before agent completes

Phase 04 adds 3 more (retry-related). Do not add the Phase 04 codes here.

### D34 — `AbortController` pattern reused exactly
Mirror `runtime/src/llm/anthropic-llm-provider.ts:118–125`:

```typescript
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), maxRuntimeMs);
try {
  return await op({ signal: controller.signal });
} finally {
  clearTimeout(timer);
}
```

Race-then-mark-as-orphan semantics: if the handler doesn't accept the signal, the wall-clock fires, the executor returns a typed `agent.timeout` error, and any orphaned handler resolves into the void. This is documented behavior — D34 locks it.

---

## ARCHITECTURAL DECISION — WHY POLICY EVAL LIVES IN A HELPER, NOT IN THE GUARD CLASS

The phase ships TWO things:
1. **`evaluateResponsePolicy(output, contextPackage, policy)`** — pure function in `runtime/src/agents/`. Returns a typed `ResponsePolicyDecision`. Used by both executors.
2. **`HeuristicOutputGuard`** — a guard class implementing `OutputGuard` (the interface lands in Phase 05). It wraps the helper and presents the orchestrator-time API.

The helper is the unit of correctness. The guard class is the unit of integration. Splitting them keeps the helper unit-testable in isolation and lets Stage 42's `LlmJudgeOutputGuard` reuse the helper's typed decision shape without re-implementing the policy logic.

`checkGroundedness` from `retrieval-evals.ts` is the underlying truth-test. The helper computes `evidenceCoverage` from `citations.length / sources.length` (Stage 25.5 P02 ensures `citations` is populated) and applies the policy rules.

---

## FILES TO CHANGE — COMPLETE LIST

| # | File | Action |
|---|---|---|
| 1 | `packages/agentic-ai-infra-core/src/agents/types.ts` | MODIFY (add response-policy types; expand budget policy; add response field to SingleAgentRunReport — wait, SingleAgentRunReport is in runtime; only types are in core) |
| 2 | `packages/agentic-ai-infra-core/src/errors/index.ts` | MODIFY (3 new error codes) |
| 3 | `packages/agentic-ai-infra-runtime/src/guardrails/output-guard.ts` | CREATE |
| 4 | `packages/agentic-ai-infra-runtime/src/guardrails/index.ts` | MODIFY (export) |
| 5 | `packages/agentic-ai-infra-runtime/src/agents/index.ts` | MODIFY (evaluateResponsePolicy helper; wire maxToolCalls/maxRuntimeMs/maxIterations enforcement; per-agent guardTiming in multi-agent executor; SingleAgentRunReport.response field) |
| 6 | `packages/agentic-ai-infra-runtime/test/guardrails/output-guard.test.ts` | CREATE (~12 tests) |
| 7 | `docs/internal/learning-notes/stage-25-5-output-guard.md` | CREATE |
| 8 | `docs/internal/v3-architecture-snapshot.md` | MODIFY |
| 9 | `kb.md` | MODIFY |
| 10 | `STATUS.md` | MODIFY |

---

## CHANGE 1 — MODIFY `packages/agentic-ai-infra-core/src/agents/types.ts`

Add the three new closed-taxonomy types BEFORE `AgentResponsePolicy`, then add `AgentResponsePolicy`. Expand `AgentBudgetPolicy`. Add the optional field to `AgentDefinition`.

```typescript
/** Closed enum: response mode for an agent (Stage 25.5 D30). */
export type AgentResponseMode = "freeform" | "grounded" | "strict-cited" | "json-schema";

/** Closed enum: behavior when evidence is insufficient (Stage 25.5 D30). */
export type AgentOnWeakEvidence = "abstain" | "ask" | "warn";

/**
 * Closed enum: when the Output Guard runs (Stage 25.5 D32).
 *
 * `per-tool` is intentionally not in this taxonomy — Stage 21 D1 forbids
 * Layer 9 (Harness) from calling Layer 11 (SmartRouter), which would be
 * required for LLM-judge guards. Heuristic-only per-tool checking lives in
 * the Input Guard (Stage 25.5 Phase 01).
 */
export type AgentGuardTiming = "per-orchestrator" | "per-agent";

/**
 * Per-agent response (output guard) policy.
 *
 * @umbrella Guardrails — output-side
 *
 * Stage 25.5 Phase 03 wires `requireCitations`, `minEvidenceCoverage`, and
 * `onWeakEvidence` against the heuristic OutputGuard. `mode = "json-schema"`
 * is reserved for Stage 26 (depends on `outputSchema`).
 *
 * @example
 * const def: AgentDefinition = {
 *   id: "security-strict",
 *   role: "security-reviewer",
 *   responsePolicy: {
 *     mode: "strict-cited",
 *     requireCitations: true,
 *     minEvidenceCoverage: 0.75,
 *     onWeakEvidence: "abstain",
 *     guardTiming: "per-agent"
 *   }
 * };
 */
export type AgentResponsePolicy = {
  readonly mode?: AgentResponseMode;
  readonly requireCitations?: boolean;
  readonly minEvidenceCoverage?: number;
  readonly onWeakEvidence?: AgentOnWeakEvidence;
  readonly guardTiming?: AgentGuardTiming;
};
```

Modify `AgentBudgetPolicy` (around line 169):

```typescript
export type AgentBudgetPolicy = {
  /** Hard ceiling on input + output tokens. Must be a positive integer. */
  readonly maxTokens: number;
  /**
   * Maximum number of tool calls per agent execution. Default 8 when
   * `budgetPolicy` is set on an `AgentDefinition`. Stage 25.5 Phase 03.
   *
   * @guardrail
   */
  readonly maxToolCalls?: number;
  /**
   * Wall-clock ceiling in milliseconds. Default 120000 (2 minutes) when
   * `budgetPolicy` is set on an `AgentDefinition`. Stage 25.5 Phase 03 wires
   * the `AbortController` race; orphaned handlers continue to completion
   * and their results are discarded (D34).
   *
   * @guardrail
   */
  readonly maxRuntimeMs?: number;
  /**
   * Maximum critique iterations (SelfCritiqueLoop, Stage 48). No default
   * today; the field is declared so Stage 48 implementations can read it
   * without further core changes. Stage 25.5 Phase 03 only types the field.
   *
   * @feedback-loop
   */
  readonly maxIterations?: number;
};
```

Add `responsePolicy?: AgentResponsePolicy` to the `AgentDefinition` type (the intersection at line 287). Position it alphabetically after `retrievalPolicy`:

```typescript
export type AgentDefinition = AgentProfile & {
  // ... existing fields ...
  readonly retrievalPolicy?: AgentRetrievalPolicy;
  readonly responsePolicy?: AgentResponsePolicy;     // NEW — Stage 25.5 Phase 03
  // ... rest unchanged ...
};
```

**Do NOT** rename existing fields. **Do NOT** change `maxTokens` to optional — it's the one required field on `AgentBudgetPolicy`.

---

## CHANGE 2 — MODIFY `packages/agentic-ai-infra-core/src/errors/index.ts`

Add three new error codes to the `ErrorCode` union, placed after the existing `agent.tool-not-in-allowlist`:

```typescript
  | "agent.tool-not-in-allowlist"   // existing
  | "agent.weak-evidence"            // NEW — Stage 25.5 P03
  | "agent.tool-call-exceeded"       // NEW — Stage 25.5 P03
  | "agent.timeout"                  // NEW — Stage 25.5 P03
```

**Do NOT** add Phase 04's codes here. Three only.

---

## CHANGE 3 — CREATE `packages/agentic-ai-infra-runtime/src/guardrails/output-guard.ts`

```typescript
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
 * @param policy - The agent's response policy. When undefined, returns pass.
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

  // Compute evidence coverage. When no sources are available, coverage is undefined.
  const evidenceCoverage =
    sources.length === 0 ? undefined : citations.length / sources.length;

  // requireCitations check
  if (policy.requireCitations === true && citations.length === 0) {
    return decision(false, policy, "Output has no citations.", evidenceCoverage, citations.length);
  }

  // strict-cited mode: same as requireCitations:true, regardless of explicit flag
  if (policy.mode === "strict-cited" && citations.length === 0) {
    return decision(false, policy, "strict-cited mode requires at least one citation.", evidenceCoverage, citations.length);
  }

  // grounded mode: require ≥ 1 citation when sources were available
  if (policy.mode === "grounded" && sources.length > 0 && citations.length === 0) {
    return decision(false, policy, "grounded mode requires citing retrieved evidence.", evidenceCoverage, citations.length);
  }

  // minEvidenceCoverage check
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
 * Read-only interface for output guards (Phase 05 lands the core type;
 * Phase 03 ships a concrete heuristic implementation that follows the same
 * shape, ready for Phase 05's interface extraction).
 */
export interface OutputGuard {
  inspect(
    output: DeterministicAgentOutput,
    contextPackage: ContextPackage | undefined,
    agent: AgentDefinition | undefined
  ): ResponsePolicyDecision;
}

/** Heuristic implementation backed by `evaluateResponsePolicy`. */
export class HeuristicOutputGuard implements OutputGuard {
  inspect(
    output: DeterministicAgentOutput,
    contextPackage: ContextPackage | undefined,
    agent: AgentDefinition | undefined
  ): ResponsePolicyDecision {
    return evaluateResponsePolicy(output, contextPackage, agent?.responsePolicy);
  }
}

/** Default no-op guard used when no policy is configured. */
export class NoopOutputGuard implements OutputGuard {
  inspect(output: DeterministicAgentOutput): ResponsePolicyDecision {
    return {
      pass: true,
      action: "pass",
      citationCount: output.citations?.length ?? 0
    };
  }
}
```

---

## CHANGE 4 — MODIFY `packages/agentic-ai-infra-runtime/src/guardrails/index.ts`

Add the new module to the barrel:

```typescript
export * from "./input-guard.js";
export * from "./output-guard.js";
```

---

## CHANGE 5 — MODIFY `packages/agentic-ai-infra-runtime/src/agents/index.ts`

Five additive changes.

### 5.1 — Import the new helper
At the top:

```typescript
import {
  evaluateResponsePolicy,
  type ResponsePolicyDecision
} from "../guardrails/output-guard.js";
```

### 5.2 — `SingleAgentRunReport.response` field (D32)
Find `SingleAgentRunReport` (around line 47). Add an optional `response` field after `threadId`:

```typescript
export type SingleAgentRunReport = {
  // ... existing fields ...
  readonly threadId?: string;
  /**
   * Output-guard verdict (Stage 25.5 Phase 03).
   *
   * Populated when the resolved manager `AgentDefinition` has a
   * `responsePolicy`. Undefined otherwise. D23 backwards-compat.
   *
   * @guardrail
   */
  readonly response?: ResponsePolicyDecision;
};
```

### 5.3 — `RuntimeRoleOutput.response` field (D32 per-agent path)
Find `RuntimeRoleOutput` (around line 74). Add optional `response`:

```typescript
export type RuntimeRoleOutput = DeterministicAgentOutput & {
  readonly selectedToolIds: readonly string[];
  /** Output-guard verdict when `responsePolicy.guardTiming === "per-agent"`. */
  readonly response?: ResponsePolicyDecision;
};
```

### 5.4 — `SingleAgentExecutor.execute()` enforces budget extensions and runs the guard
Inside `execute()`, after `managerDefinition` is fetched (around line 469):

Add a `maxToolCalls` check immediately after `selectedToolIds` is computed:

```typescript
const maxToolCalls = managerDefinition?.budgetPolicy?.maxToolCalls
  ?? (managerDefinition?.budgetPolicy ? 8 : Infinity);
if (selectedToolIds.length > maxToolCalls) {
  return fail({
    code: "agent.tool-call-exceeded",
    message: `Agent ${managerDefinition?.id ?? "manager"} selected ${selectedToolIds.length} tools; budgetPolicy.maxToolCalls=${maxToolCalls}.`,
    severity: "recoverable"
  });
}
```

Add a `maxRuntimeMs` `AbortController` wrap. **Today the single-agent
`execute()` is fast and doesn't perform long-running tool calls** — the
timeout in this phase is documented but inert for the deterministic path.
Wire the AbortController so future phases can race on it. Pattern (lifted
from `anthropic-llm-provider.ts:118`):

```typescript
const maxRuntimeMs = managerDefinition?.budgetPolicy?.maxRuntimeMs
  ?? (managerDefinition?.budgetPolicy ? 120000 : undefined);
const controller = maxRuntimeMs !== undefined ? new AbortController() : undefined;
const timer = controller && maxRuntimeMs !== undefined
  ? setTimeout(() => controller.abort(), maxRuntimeMs)
  : undefined;

try {
  // existing execute() body — no signal threading required this phase
  // ...
} finally {
  if (timer) clearTimeout(timer);
}
```

Note: this phase wires the controller but does NOT thread the signal into
tool handlers. Stage 26 / Stage 27 may extend handlers to accept signals.
The wall-clock timer fires and `controller.abort()` is called, but the
deterministic single-agent path completes before the default 120s. The
test for `agent.timeout` exercises a `maxRuntimeMs: 1` to force the race.

Replace the final return with response-guard evaluation. Just before the
existing `return ok({...})` (around line 574):

```typescript
const responseDecision = managerDefinition?.responsePolicy
  ? evaluateResponsePolicy(
      {
        role: "manager",
        summary,
        findings: [],
        sourceCount: input.contextPackage?.sources.length ?? 0,
        citations: input.contextPackage?.sources.map((s) => ({
          sourceId: s.sourceId,
          label: s.label,
          providerId: s.providerId
        }))
      },
      input.contextPackage,
      managerDefinition.responsePolicy
    )
  : undefined;

if (responseDecision && responseDecision.action === "abstain") {
  return fail({
    code: "agent.weak-evidence",
    message: responseDecision.reason ?? "Agent abstained due to weak evidence.",
    severity: "recoverable"
  });
}

return ok({
  // ... existing fields ...
  threadId: activeThreadId,
  response: responseDecision
});
```

### 5.5 — `TokenEfficientMultiAgentExecutor` per-agent guard timing
Inside the `roleOutputs.map(...)` block (around line 773–791), after
`selectedToolIds` and `tokenUsage` are computed but before returning the
role output, add:

```typescript
const responseDecision =
  roleDefinition?.responsePolicy?.guardTiming === "per-agent"
    ? evaluateResponsePolicy(baseOutput, contextPackage, roleDefinition.responsePolicy)
    : undefined;

return { ...baseOutput, selectedToolIds, tokenUsage, response: responseDecision };
```

The per-orchestrator timing (default) lands in Stage 26's
`AgentOrchestrator`. Phase 03 ships the helper; Stage 26 calls it.

Add the `maxToolCalls` check inside the same map iteration:

```typescript
const maxToolCalls =
  roleDefinition?.budgetPolicy?.maxToolCalls
  ?? (roleDefinition?.budgetPolicy ? 8 : Infinity);
if (selectedToolIds.length > maxToolCalls) {
  // soft signal: not all roles share the same policy; we record but don't fail
  // the whole run. Stage 26 will treat this as a per-role failure when policy
  // says so. For Phase 03, surface as a warning in the report.warnings.
  // Append to the outer `warnings` array (find it; if not present, create one).
}
```

Implementation note for the above: if `maxToolCalls` would be violated,
add a warning string to the eventual `runReport.warnings` (e.g.
`"role=${slice.role} exceeded maxToolCalls=${maxToolCalls}"`). Do NOT fail
the whole multi-agent run — per-role failures will land in Stage 26's
orchestrator with proper isolation. Phase 03 keeps the warning surface.

---

## CHANGE 6 — CREATE `packages/agentic-ai-infra-runtime/test/guardrails/output-guard.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import type {
  AgentDefinition,
  AgentResponsePolicy,
  ContextPackage,
  DeterministicAgentOutput
} from "@maharudra/agentic-ai-infra-core";
import {
  HeuristicOutputGuard,
  NoopOutputGuard,
  evaluateResponsePolicy
} from "../../src/guardrails/output-guard.js";

const baseOutput = (
  overrides: Partial<DeterministicAgentOutput> = {}
): DeterministicAgentOutput => ({
  role: "security-reviewer",
  summary: "ok",
  findings: ["finding-1"],
  sourceCount: 0,
  ...overrides
});

const pkg = (sourceIds: readonly string[]): ContextPackage => ({
  id: "ctx-1",
  task: "t",
  sources: sourceIds.map((id) => ({ sourceId: id, label: id })),
  contextText: "",
  tokenEstimate: 0
});

describe("Stage 25.5 Phase 03 — evaluateResponsePolicy", () => {
  it("returns pass when policy is undefined (D23)", () => {
    const d = evaluateResponsePolicy(baseOutput(), pkg(["s-1"]), undefined);
    expect(d.pass).toBe(true);
    expect(d.action).toBe("pass");
  });

  it("fails when requireCitations:true and citations are empty", () => {
    const policy: AgentResponsePolicy = { requireCitations: true, onWeakEvidence: "warn" };
    const d = evaluateResponsePolicy(baseOutput(), pkg(["s-1"]), policy);
    expect(d.pass).toBe(false);
    expect(d.action).toBe("warn");
  });

  it("passes when requireCitations:true and citations present", () => {
    const policy: AgentResponsePolicy = { requireCitations: true };
    const d = evaluateResponsePolicy(
      baseOutput({ citations: [{ sourceId: "s-1" }] }),
      pkg(["s-1"]),
      policy
    );
    expect(d.pass).toBe(true);
    expect(d.citationCount).toBe(1);
  });

  it("computes evidenceCoverage as citationCount / sources.length", () => {
    const policy: AgentResponsePolicy = {};
    const d = evaluateResponsePolicy(
      baseOutput({ citations: [{ sourceId: "s-1" }, { sourceId: "s-2" }] }),
      pkg(["s-1", "s-2", "s-3", "s-4"]),
      policy
    );
    expect(d.evidenceCoverage).toBeCloseTo(0.5);
  });

  it("fails when evidenceCoverage < minEvidenceCoverage", () => {
    const policy: AgentResponsePolicy = {
      minEvidenceCoverage: 0.75,
      onWeakEvidence: "abstain"
    };
    const d = evaluateResponsePolicy(
      baseOutput({ citations: [{ sourceId: "s-1" }] }),
      pkg(["s-1", "s-2", "s-3", "s-4"]),
      policy
    );
    expect(d.pass).toBe(false);
    expect(d.action).toBe("abstain");
  });

  it("passes when evidenceCoverage >= minEvidenceCoverage", () => {
    const policy: AgentResponsePolicy = { minEvidenceCoverage: 0.5 };
    const d = evaluateResponsePolicy(
      baseOutput({ citations: [{ sourceId: "s-1" }, { sourceId: "s-2" }] }),
      pkg(["s-1", "s-2", "s-3"]),
      policy
    );
    // 2/3 = 0.667 >= 0.5
    expect(d.pass).toBe(true);
  });

  it("strict-cited mode fails when no citations regardless of requireCitations flag", () => {
    const policy: AgentResponsePolicy = { mode: "strict-cited", onWeakEvidence: "warn" };
    const d = evaluateResponsePolicy(baseOutput(), pkg(["s-1"]), policy);
    expect(d.pass).toBe(false);
  });

  it("grounded mode passes when sources are empty (nothing to cite)", () => {
    const policy: AgentResponsePolicy = { mode: "grounded", onWeakEvidence: "abstain" };
    const d = evaluateResponsePolicy(baseOutput(), undefined, policy);
    expect(d.pass).toBe(true);
  });

  it("grounded mode fails when sources present but citations empty", () => {
    const policy: AgentResponsePolicy = { mode: "grounded", onWeakEvidence: "ask" };
    const d = evaluateResponsePolicy(baseOutput(), pkg(["s-1", "s-2"]), policy);
    expect(d.pass).toBe(false);
    expect(d.action).toBe("ask");
  });

  it("evidenceCoverage is undefined when contextPackage is undefined", () => {
    const policy: AgentResponsePolicy = {};
    const d = evaluateResponsePolicy(baseOutput(), undefined, policy);
    expect(d.evidenceCoverage).toBeUndefined();
  });

  it("HeuristicOutputGuard delegates to evaluateResponsePolicy", () => {
    const guard = new HeuristicOutputGuard();
    const policy: AgentResponsePolicy = { requireCitations: true, onWeakEvidence: "warn" };
    const agent: AgentDefinition = {
      id: "security",
      role: "security-reviewer",
      responsePolicy: policy
    };
    const d = guard.inspect(baseOutput(), pkg(["s-1"]), agent);
    expect(d.pass).toBe(false);
  });

  it("NoopOutputGuard always returns pass", () => {
    const guard = new NoopOutputGuard();
    const d = guard.inspect(baseOutput(), pkg([]), undefined);
    expect(d.pass).toBe(true);
    expect(d.action).toBe("pass");
  });
});
```

Target: 12 passing tests.

---

## CHANGE 7 — CREATE `docs/internal/learning-notes/stage-25-5-output-guard.md`

```markdown
# Stage 25.5 Phase 03 — Output Guard (Internal Note)

## What this phase ships

Three concerns co-ship because they each exercise the same executor seams:

1. **AgentResponsePolicy** — closed-taxonomy policy on `AgentDefinition`
   describing how to validate output before returning. Five fields:
   `mode`, `requireCitations`, `minEvidenceCoverage`, `onWeakEvidence`, `guardTiming`.

2. **Expanded AgentBudgetPolicy** — three new optional fields:
   `maxToolCalls`, `maxRuntimeMs`, `maxIterations`. Design-doc defaults
   apply only when `budgetPolicy` is set on the agent.

3. **HeuristicOutputGuard** — concrete guard implementation backed by
   `evaluateResponsePolicy()`. Stage 21 D1 honored — heuristic only, no
   LLM call.

## Why these co-ship

They each touch:
- `AgentDefinition` shape (`responsePolicy`, expanded `budgetPolicy`)
- `SingleAgentExecutor.execute()` (guard helper + budget enforcement)
- `TokenEfficientMultiAgentExecutor` `roleOutputs.map()` (per-agent guard timing + per-role budget)

Splitting them across phases would mean editing the same executor blocks
three times. Co-shipping them edits once.

## Where the guard runs

- **`per-orchestrator` (default)** — Stage 26's `AgentOrchestrator` runs
  the guard once on the merged output. Phase 03 ships the helper; Stage 26
  calls it.
- **`per-agent` (opt-in)** — `TokenEfficientMultiAgentExecutor` runs the
  guard after each role's `DeterministicAgentOutput` is built. Surfaces as
  `RuntimeRoleOutput.response`.
- For single-agent: `SingleAgentRunReport.response` is populated when
  `managerDefinition.responsePolicy` exists.

`per-tool` is intentionally not in the timing taxonomy. Per-tool LLM-judge
would violate Stage 21 D1 (Layer 9 → Layer 11). Per-tool heuristic checks
belong in the Input Guard (Phase 01).

## AbortController pattern

`maxRuntimeMs` is enforced via `AbortController` wall-clock race, mirroring
`runtime/src/llm/anthropic-llm-provider.ts:118` exactly. Race-then-mark-as-orphan:
the wall-clock fires, the executor returns `agent.timeout`, and the orphaned
handler eventually resolves into the void. D34 locks this behavior.

The signal is NOT threaded into tool handlers in this phase — that's a
Stage 26 / Stage 27 extension. The timer is wired so future phases inherit
the pattern.

## What this phase does NOT ship

- LLM-judge OutputGuard — Stage 42.
- `outputSchema` validation — `mode: "json-schema"` is reserved, enforcement deferred to Stage 26.
- Per-orchestrator wiring — that's Stage 26's `AgentOrchestrator`.
- Signal-threaded tool handlers — Stage 26 / 27.
- Retry on weak-evidence — Phase 04's retry loop is separate.
```

---

## CHANGE 8 — MODIFY `docs/internal/v3-architecture-snapshot.md`

Add rows:
```txt
  AgentResponsePolicy on AgentDefinition  Guardrails — output-side       ✅ Stage 25.5 P03
  expanded AgentBudgetPolicy (3 fields)   Guardrails — bounded loop      ✅ Stage 25.5 P03
  HeuristicOutputGuard + evaluateResponsePolicy  Guardrails — heuristic  ✅ Stage 25.5 P03
```

Append a bottom section mirroring Phase 01/02 pattern. Mention D30, D31, D32, D33, D34.

---

## CHANGE 9 — MODIFY `kb.md`

Append Phase 03 session entry. Same pattern as P01/P02. List the five new decisions.

---

## CHANGE 10 — MODIFY `STATUS.md`

Update top + new bullet.

---

## VERIFICATION

```bash
pnpm.cmd run ci
```

Plus:
```bash
pnpm.cmd --silent exec rg -n "AgentResponsePolicy" packages/agentic-ai-infra-core/src/agents/types.ts
pnpm.cmd --silent exec rg -n "evaluateResponsePolicy" packages/agentic-ai-infra-runtime/src/agents/index.ts
pnpm.cmd --silent exec rg -n "agent.weak-evidence|agent.tool-call-exceeded|agent.timeout" packages/agentic-ai-infra-core/src/errors/index.ts
```

---

## SELF-REVIEW CHECKLIST

### Invariants
- [ ] D23 — policy-absent path unchanged
- [ ] D20 — `allowedTools` filter and `roleAllowsTool` untouched
- [ ] D17 — `RuntimeMultiAgentRunReport` shape backwards-compat (new optional `response` on role output is additive)
- [ ] D27 — `DeterministicAgentOutput.citations` field unchanged
- [ ] Stage 21 D1 — no LLM call from the guard
- [ ] Stage 21 `checkGroundedness` in retrieval-evals.ts NOT modified

### Type correctness
- [ ] `AgentResponseMode` is a closed union of 4 strings
- [ ] `AgentOnWeakEvidence` is a closed union of 3 strings
- [ ] `AgentGuardTiming` is a closed union of 2 strings (no `per-tool`)
- [ ] `AgentResponsePolicy` has 5 optional fields
- [ ] `AgentBudgetPolicy.maxTokens` is required; 3 new fields optional
- [ ] `AgentDefinition.responsePolicy` is optional
- [ ] `SingleAgentRunReport.response` is optional
- [ ] `RuntimeRoleOutput.response` is optional
- [ ] 3 new error codes added in `core/src/errors/index.ts`

### Wiring
- [ ] `evaluateResponsePolicy` is exported from `runtime/src/guardrails/output-guard.ts`
- [ ] `HeuristicOutputGuard.inspect` delegates to `evaluateResponsePolicy`
- [ ] `NoopOutputGuard.inspect` always returns pass
- [ ] `SingleAgentExecutor` reads `managerDefinition?.responsePolicy` and populates `response`
- [ ] `SingleAgentExecutor` returns `agent.weak-evidence` when `action === "abstain"`
- [ ] `SingleAgentExecutor` returns `agent.tool-call-exceeded` when over budget
- [ ] `SingleAgentExecutor` wraps execution in `AbortController` when `maxRuntimeMs` set
- [ ] `TokenEfficientMultiAgentExecutor` populates `roleOutputs[i].response` when `guardTiming === "per-agent"`
- [ ] `TokenEfficientMultiAgentExecutor` appends warnings (not failures) for per-role `maxToolCalls` overflow

### Tests
- [ ] 12 `it()` blocks in `output-guard.test.ts`
- [ ] All previously passing tests still pass
- [ ] `pnpm.cmd run ci`: build ✓ typecheck ✓ test ✓ lint ✓

### Documentation
- [ ] `docs/internal/learning-notes/stage-25-5-output-guard.md` created
- [ ] v3-architecture-snapshot.md rows + bottom section
- [ ] kb.md Phase 03 entry
- [ ] STATUS.md updated

---

## WHAT NOT TO DO

- Do NOT add `per-tool` to `AgentGuardTiming` — Stage 21 D1 forbids
- Do NOT add LLM call from `HeuristicOutputGuard` — Stage 42's job
- Do NOT make `maxTokens` optional on `AgentBudgetPolicy` — it's the one required field
- Do NOT enforce `outputSchema` for `mode: "json-schema"` — Stage 26
- Do NOT add `outputSchema` to `ToolContract` here — Phase 05 may; this phase doesn't
- Do NOT modify `checkGroundedness` in `retrieval-evals.ts` — reuse via the same helper pattern, don't edit
- Do NOT thread `AbortSignal` into tool handlers — only wrap execute()
- Do NOT add Phase 04's retry codes (`agent.retry-exhausted`, etc.) here
- Do NOT export `evaluateResponsePolicy` from `core/` — it's runtime, not contract
- Do NOT change Stage 25 default definitions — they have no `responsePolicy` (D23)
- Do NOT add MCP tools for response policy — pure type/runtime work this phase

---

## DONE SIGNAL

```
Stage 25.5 Phase 03 complete.
Test count: [N]/[N] passing.
CI: build ✓ typecheck ✓ test ✓ lint ✓
Files changed: [list]
New decisions locked: D30 (responsePolicy taxonomy), D31 (expanded budgetPolicy), D32 (guard timing), D33 (3 error codes), D34 (AbortController pattern)
Next phase: 25.5-04 — Guardrails: Refusal Taxonomy + Feedback Loops: Retry Loop
```
