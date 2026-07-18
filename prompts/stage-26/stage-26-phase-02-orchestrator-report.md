# Stage 26 — Phase 02 — OrchestratorReport + OrchestratorSubRun + OrchestratorRefusal (types only)

ONE phase, ONE session. Types and shape-contract tests only. No orchestrator class yet
(that is Phase 03). No behavior.

---

## BEFORE YOU START — read these from source

1. `packages/agentic-ai-infra-runtime/src/agents/index.ts`:
   - `SingleAgentRunReport` (line ~51) — fields: `runId`, `traceId`, `task`, `mode`,
     `selectedToolIds`, `contextSourceCount`, `tokenUsage`, `result {summary, steps, warnings}`,
     `threadId?`, `response?`. **There is NO `outputs` or `synthesis` on this type** — those
     are multi-agent-only.
   - `RuntimeMultiAgentRunReport` (line ~94) — `MultiAgentRunReport & { contextBuildCount: 1;
     noNetworkCalls: true; roleOutputs }`.
2. `packages/agentic-ai-infra-core/src/agents/types.ts`:
   - `MultiAgentRunReport` (line ~200) — has `synthesis: string`, `tokenUsage: TokenUsageReport`,
     `outputs`, etc.
   - `AgentRole` (line ~9), `SafeTaskMetadata` (line ~25).
3. `packages/agentic-ai-infra-core/src/token/types.ts` — `TokenUsageReport` =
   `{ inputTokens, outputTokens, totalTokens, estimatedCostUsd? }`.
4. `packages/agentic-ai-infra-core/src/guardrails/types.ts` — `SafetyVerdict`
   `{ safe, action: "pass"|"block"|"rewrite"|"warn", reason?, rewrittenText? }`.
5. `packages/agentic-ai-infra-core/src/feedback/types.ts` — `FeedbackVerdict`
   `{ action: "accept"|"retry"|"escalate"|"revise", reason? }`.
6. `packages/agentic-ai-infra-runtime/src/guardrails/output-guard.ts` —
   `ResponsePolicyDecision` `{ pass, action: "pass"|"abstain"|"ask"|"warn", reason?,
   evidenceCoverage?, citationCount }`.
7. `packages/agentic-ai-infra-core/src/security/types.ts` — `RefusalReason` 8-code union
   (line ~21).
8. `packages/agentic-ai-infra-runtime/src/feedback-loops/retry-loop.ts` — **CONFIRM there is
   NO `RetryOutcome` type.** `runWithRetry<T>` returns `Promise<FrameworkResult<T>>`. The
   architectural-design doc referenced a `RetryOutcome` type that does NOT exist — do not
   import or invent it.

---

## LOCKED DECISIONS THIS PHASE HONORS

- **D-A1**: `OrchestratorReport` is a NEW sibling type, NOT an extension of
  `RuntimeMultiAgentRunReport`. Rationale: the executor report's literal-type invariants
  (`contextBuildCount: 1`, `noNetworkCalls: true`) would have to weaken to `1 | n` /
  `true | false` if extended — a real signal loss. The orchestrator may build context per-agent
  and may eventually call SmartRouter, so it gets its own honest shape.
- **OrchestratorReport preserves literal-type invariants** by NOT inheriting the executor's.
- `subRuns[i].executorReport` is a **discriminated union** keyed on `kind: "single" | "multi"`
  so the dashboard can branch cleanly.
- **No `RetryOutcome` type.** Retry visibility is a single `attemptCount: number` on the sub-run
  (1 = no retry, ≥2 = retried). This is the correction vs. the design doc.
- **D23**: types are additive; nothing existing changes. 533 tests pass byte-for-byte.

---

## FILES TO CHANGE

### NEW — `packages/agentic-ai-infra-runtime/src/orchestrator/types.ts`

```typescript
import type {
  AgentRole,
  FeedbackVerdict,
  SafeTaskMetadata,
  SafetyVerdict,
  RefusalReason,
  TokenUsageReport
} from "@maharudra/agentic-ai-infra-core";
import type {
  RuntimeMultiAgentRunReport,
  SingleAgentRunReport
} from "../agents/index.js";
import type { ResponsePolicyDecision } from "../guardrails/output-guard.js";

/**
 * A single agent's sub-run inside an orchestrator run.
 *
 * `executorReport` is a discriminated union so consumers (dashboard, evals)
 * branch on `kind` rather than guessing the shape.
 *
 * `attemptCount` is 1 when the agent ran once; ≥2 when `runWithRetry` retried.
 * (There is intentionally no `RetryOutcome` type — `runWithRetry` returns a
 * plain `FrameworkResult`; the orchestrator counts attempts itself.)
 */
export type OrchestratorSubRun = {
  readonly agentId: string;
  readonly role: AgentRole;
  readonly attemptCount: number;
  readonly executorReport:
    | { readonly kind: "single"; readonly report: SingleAgentRunReport }
    | { readonly kind: "multi"; readonly report: RuntimeMultiAgentRunReport };
};

/** A refusal raised at the orchestrator level (e.g. agent-allowlist, approval-required). */
export type OrchestratorRefusal = {
  readonly agentId?: string;
  readonly toolId?: string;
  readonly refusalReason: RefusalReason;
  readonly message: string;
};

/**
 * Canonical report returned by `AgentOrchestrator.run()` (Phase 03+).
 *
 * Deliberately a SIBLING of `RuntimeMultiAgentRunReport`, not an extension:
 * the executor report's literal invariants (`contextBuildCount: 1`,
 * `noNetworkCalls: true`) do not hold for a composed orchestrator run.
 *
 * @umbrella Guardrails
 */
export type OrchestratorReport = {
  readonly kind: "orchestrator";
  readonly runId: string;
  readonly traceId: string;
  readonly task: SafeTaskMetadata;

  /** Roles the supervisor planned, in route order. */
  readonly plannedAgents: readonly AgentRole[];

  /** One entry per executor invocation. */
  readonly subRuns: readonly OrchestratorSubRun[];

  /** Aggregated synthesis text returned to the caller. */
  readonly synthesis: string;

  /** Aggregated token usage across all sub-runs. */
  readonly tokenUsage: TokenUsageReport;

  /** Per-orchestrator output-guard verdict (D32). Undefined when no policy set. */
  readonly response?: ResponsePolicyDecision;

  /** Content-safety verdict (D40). Pass-through when NoopContentGuard. */
  readonly contentVerdict: SafetyVerdict;

  /** Post-run feedback verdict (D41). Pass-through when NoopCritiqueLoop. */
  readonly feedback: FeedbackVerdict;

  /** Refusals raised at orchestrator level. Undefined/empty when none. */
  readonly refusals?: readonly OrchestratorRefusal[];

  readonly warnings?: readonly string[];
};
```

> Confirm `RefusalReason`, `SafetyVerdict`, `FeedbackVerdict`, `SafeTaskMetadata`,
> `AgentRole`, `TokenUsageReport` are all re-exported from the **core barrel**
> (`@maharudra/agentic-ai-infra-core`). If any is not (e.g. `ResponsePolicyDecision` lives in
> runtime, not core), import it from its real location — grep before importing.

### MODIFY — `packages/agentic-ai-infra-runtime/src/orchestrator/index.ts`

Add the types barrel line ABOVE the existing supervisor-policy export:

```typescript
export * from "./types.js";
export * from "./supervisor-policy.js";
```

---

## TESTS TO ADD (+4) — `packages/agentic-ai-infra-runtime/test/orchestrator/orchestrator-report.test.ts`

These are **shape/type-contract tests** — they construct literal objects of each type and
assert structural properties. (Read an existing shape-contract test in the repo first;
Stage 25.5 P02 `response-packet.test.ts` is the closest precedent for "type-shape contract"
tests.)

1. **Discriminated union — single branch** — build an `OrchestratorSubRun` with
   `executorReport.kind === "single"` and assert TypeScript narrows `.report` to a
   `SingleAgentRunReport` (assert presence of `result.summary`, absence of `synthesis`).
2. **Discriminated union — multi branch** — `kind === "multi"`, assert `.report.synthesis`
   and `.report.roleOutputs` are accessible.
3. **OrchestratorReport literal contract** — build a minimal valid `OrchestratorReport` with
   `kind: "orchestrator"`, empty `subRuns`, a pass-through `contentVerdict` (`{safe:true,
   action:"pass"}`) and `feedback` (`{action:"accept"}`); assert each required field is present
   and `response`/`refusals`/`warnings` are legitimately omittable (optional).
4. **attemptCount semantics** — assert a sub-run with `attemptCount: 1` and one with
   `attemptCount: 2` are both valid; (documents the "no RetryOutcome type" decision in a test
   comment).

---

## SELF-REVIEW CHECKLIST

- [ ] No `RetryOutcome` import or reference anywhere.
- [ ] `OrchestratorReport` does NOT extend or intersect `RuntimeMultiAgentRunReport`.
- [ ] `kind: "orchestrator"` literal present (discriminator vs `"single"` / `"multi"` reports).
- [ ] Every imported type resolved from its REAL module (grep each; `ResponsePolicyDecision`
      is runtime-local, the rest are core).
- [ ] `contentVerdict` and `feedback` are NON-optional (orchestrator always runs the no-op
      seam, so a verdict always exists); `response`, `refusals`, `warnings` ARE optional.
- [ ] All `.js` extensions on relative imports.
- [ ] No value imports — this file is types only (`import type` throughout).

## WHAT NOT TO DO

- Do NOT add the orchestrator class or any function — types only.
- Do NOT invent `RetryOutcome`, `OrchestratorOptions`, or any helper not listed.
- Do NOT modify `SingleAgentRunReport` or `RuntimeMultiAgentRunReport`.
- Do NOT reference LangGraph / LangChain / AutoGen / CrewAI / BM25-as-library in any form.
- Do NOT export `OrchestratorReport` types from the **core** barrel — they live in runtime
  (they reference runtime-local `ResponsePolicyDecision` and the executor reports).

## CI + COMMIT

> RUNNER NOTE: `pnpm.cmd` is the Windows/PowerShell form. On a Linux runner (Codex cloud,
> CI container) use `pnpm run ci`. Do ONLY this phase, then STOP — do not begin the next phase
> in the same session, even if context remains.
```
pnpm.cmd run ci         # expect test 537/537 ✓
```
Changelog `changelog/stage-26/stage-26-phase-02-<date>.md`, then:
```
git commit -m "feat(orchestrator): OrchestratorReport + SubRun + Refusal shapes (Stage 26 P02)"
```

## DONE SIGNAL

- Final test count (expect 537).
- Confirmation `OrchestratorReport` is a sibling (no extension of executor report).
- Confirmation no `RetryOutcome` exists or was added.
- 3-line RESULTS_SUMMARY.
