# Stage 25 Phase 05 — Single-Agent Evals via AgentDefinition.evalRules
## Claude Code Prompt — MahaRudra Agentic AI Infra

---

## BEFORE YOU START — READ THIS FIRST

**Platform:** Windows 11, PowerShell, Node >= 20, pnpm only
**CI command:** `pnpm run ci`
**Starting test count:** 464/464 passing (Phase 04 complete)
**Expected test count after this phase:** ~472 passing (+8)

This prompt is self-contained. Do not invent details not stated here.
Do not modify any file not listed in the "FILES TO CHANGE" section.

Phase 04 wired planning-time enforcement. Phase 05 closes the loop by
recording eval outcomes after each single-agent run when the relevant
definition declares `evalRules`.

---

## CONTEXT — WHAT IS DONE (locked from Phases 01–04)

- `AgentEvalRules` type (Phase 01) — three optional fields: `requiredTools`,
  `forbiddenTools`, `hardBudget`
- `EvalStore` interface in core — used to push `EvalRunRecord` (Stage 24)
- `runAgentRuntimeEvals()` in `runtime/src/evals/index.ts` — Stage 24, takes
  `RuntimeMultiAgentRunReport`. **Cannot be reused** for single-agent runs:
  the input shape doesn't match (D17 locked the multi-agent shape).
- `SingleAgentExecutor` (modified in Phase 04) — produces a
  `SingleAgentRunReport` and now consults `manager` definition for
  enforcement.
- `SingleAgentExecutor.options.evalStore?: EvalStore` — already optional;
  used by callers that want eval records pushed.

---

## NEW LOCKED DECISION — D24 (Stage 25)

- **D24** `runSingleAgentEvals(report, definition?)` is a SEPARATE function
  from `runAgentRuntimeEvals()`. Single-agent push happens ONLY when the
  resolved `AgentDefinition` (id `"manager"`) has `evalRules` set AND
  `evalStore` is wired. Without `evalRules`, no record is pushed — avoids
  junk records.

---

## SCOPE

This phase:

1. Adds `runSingleAgentEvals()` function in a new file
2. Adds three deterministic checks: required tools, forbidden tools, hard budget
3. Returns a `QualityReport` with `suiteName: "single-agent-safety"`
4. Wires the push into `SingleAgentExecutor.execute()` — non-fatal (an eval
   push failure never aborts the agent run)
5. Re-exports the new function from `runtime/src/evals/index.ts`
6. Adds 8 unit tests + integration tests

**Check semantics.**

| Check | When skipped | Pass condition |
|---|---|---|
| Required tools | `requiredTools` undefined or `[]` | All listed ids appear in `report.selectedToolIds` |
| Forbidden tools | `forbiddenTools` undefined or `[]` | None of the listed ids appears in `report.selectedToolIds` |
| Hard budget | `hardBudget` undefined | `report.tokenUsage.totalTokens <= hardBudget` |

Skipped checks contribute a status of `"skipped"` to the report, not `"passed"`.
This distinction matters for the dashboard's Stage 26 surface (skipped ≠ green).

---

## FILES TO CHANGE

```
packages/agentic-ai-infra-runtime/src/evals/single-agent-evals.ts     (new — runSingleAgentEvals + 3 check helpers)
packages/agentic-ai-infra-runtime/src/evals/index.ts                  (modify — re-export)
packages/agentic-ai-infra-runtime/src/agents/index.ts                 (modify — wire eval push into SingleAgentExecutor)
packages/agentic-ai-infra-runtime/test/evals/single-agent-evals.test.ts (new — 8 tests)
```

---

## CHANGE 1 — `packages/agentic-ai-infra-runtime/src/evals/single-agent-evals.ts` (NEW)

Create this file:

```typescript
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
  QualityCheck,
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
 * @returns A `QualityReport` with three checks. Overall status is "passed"
 *   only when every non-skipped check passes; otherwise "failed".
 */
export function runSingleAgentEvals(
  report: SingleAgentEvalInput,
  definition?: AgentDefinition
): QualityReport {
  const rules: AgentEvalRules = definition?.evalRules ?? {};

  const checks: QualityCheck[] = [
    checkRequiredTools(report, rules),
    checkForbiddenTools(report, rules),
    checkHardBudget(report, rules)
  ];

  // Overall status — failed if any non-skipped check failed.
  const anyFailed = checks.some((c) => c.status === "failed");

  return {
    suiteName: SINGLE_AGENT_SUITE_NAME,
    status: anyFailed ? "failed" : "passed",
    checks
  };
}

// -------------------------------------------------------------------------
// Internal: per-rule checks
// -------------------------------------------------------------------------

/**
 * Verifies every id in `rules.requiredTools` appears in
 * `report.selectedToolIds`. Skipped when `requiredTools` is undefined or
 * empty.
 */
function checkRequiredTools(
  report: SingleAgentEvalInput,
  rules: AgentEvalRules
): QualityCheck {
  const required = rules.requiredTools;
  if (required === undefined || required.length === 0) {
    return {
      name: "required-tools",
      status: "skipped",
      detail: "No required tools configured."
    };
  }

  const selected = new Set(report.selectedToolIds);
  const missing = required.filter((id) => !selected.has(id));

  if (missing.length > 0) {
    return {
      name: "required-tools",
      status: "failed",
      detail: `Missing required tool(s): ${missing.join(", ")}.`
    };
  }

  return {
    name: "required-tools",
    status: "passed",
    detail: `All ${required.length} required tool(s) selected.`
  };
}

/**
 * Verifies no id in `rules.forbiddenTools` appears in
 * `report.selectedToolIds`. Skipped when `forbiddenTools` is undefined or
 * empty.
 */
function checkForbiddenTools(
  report: SingleAgentEvalInput,
  rules: AgentEvalRules
): QualityCheck {
  const forbidden = rules.forbiddenTools;
  if (forbidden === undefined || forbidden.length === 0) {
    return {
      name: "forbidden-tools",
      status: "skipped",
      detail: "No forbidden tools configured."
    };
  }

  const forbiddenSet = new Set(forbidden);
  const violations = report.selectedToolIds.filter((id) =>
    forbiddenSet.has(id)
  );

  if (violations.length > 0) {
    return {
      name: "forbidden-tools",
      status: "failed",
      detail: `Forbidden tool(s) selected: ${violations.join(", ")}.`
    };
  }

  return {
    name: "forbidden-tools",
    status: "passed",
    detail: `No forbidden tools selected (allowlist of ${forbidden.length} avoided).`
  };
}

/**
 * Verifies `report.tokenUsage.totalTokens <= rules.hardBudget`. Skipped
 * when `hardBudget` is undefined. Distinct from `budgetPolicy.maxTokens`
 * (which CHANGES executor behavior at planning time) — `hardBudget`
 * OBSERVES the result without changing behavior.
 */
function checkHardBudget(
  report: SingleAgentEvalInput,
  rules: AgentEvalRules
): QualityCheck {
  const hardBudget = rules.hardBudget;
  if (hardBudget === undefined) {
    return {
      name: "hard-budget",
      status: "skipped",
      detail: "No hard budget configured."
    };
  }

  const used = report.tokenUsage.totalTokens;
  if (used > hardBudget) {
    return {
      name: "hard-budget",
      status: "failed",
      detail: `Used ${used} tokens; hard budget is ${hardBudget}.`
    };
  }

  return {
    name: "hard-budget",
    status: "passed",
    detail: `Used ${used} of ${hardBudget} tokens.`
  };
}
```

**Note on `QualityCheck` and `QualityReport`.** These types are in
`@maharudra/agentic-ai-infra-core`. If the existing types use a different
field name (e.g. `name` vs `id`, or `detail` vs `message`), adapt the helper
to match the existing types exactly. The principle is: emit the same shape
that other suites emit. Look at `AgentEvaluator` or `RetrievalQualitySuite`
output for the canonical shape.

---

## CHANGE 2 — `packages/agentic-ai-infra-runtime/src/evals/index.ts`

Add re-exports at the end of the file:

```typescript
// Stage 25 — Single-agent evaluation.
export {
  SINGLE_AGENT_SUITE_NAME,
  runSingleAgentEvals
} from "./single-agent-evals.js";

export type { SingleAgentEvalInput } from "./single-agent-evals.js";
```

---

## CHANGE 3 — `packages/agentic-ai-infra-runtime/src/agents/index.ts`

### 3a. Add import

Add to the existing imports from `../evals/index.js` (or create the import
if it doesn't yet exist):

```typescript
import { runSingleAgentEvals } from "../evals/index.js";
```

If there is no existing import from `../evals/index.js`, add this as a
new import line.

### 3b. Wire the push into `SingleAgentExecutor.execute()`

Find `SingleAgentExecutor.execute()`. Locate the point where the run
report is fully constructed and the executor is about to return
`ok({ ... })`. The existing code in Phase 04 looks up `managerDefinition`
near the top of the function. Reuse that variable.

IMMEDIATELY BEFORE the final `return ok({...});` statement, add:

```typescript
    // Stage 25 — single-agent eval push. Only when (a) caller wired an
    // evalStore, and (b) the resolved manager definition declares
    // evalRules. Otherwise no record is pushed (D24 — avoids junk).
    if (this.options.evalStore && managerDefinition?.evalRules) {
      try {
        const qualityReport = runSingleAgentEvals(
          {
            selectedToolIds: enforcedToolIds,
            tokenUsage: { totalTokens: /* the totalTokens you computed */ }
          },
          managerDefinition
        );

        this.options.evalStore.push({
          runId: /* the existing runId variable in scope */,
          traceId: /* the existing traceId variable in scope */,
          threadId: /* the active thread id in scope, may be undefined */,
          recordedAt: new Date().toISOString(),
          report: qualityReport
        });
      } catch (error) {
        // Eval push is non-fatal — log via observability if available,
        // otherwise swallow. Never abort the agent run because of an
        // eval store failure.
        this.options.observability?.log({
          level: "warn",
          message: "[SingleAgentExecutor] Eval push failed; continuing.",
          metadata: { error: error instanceof Error ? error.message : String(error) }
        }).catch(() => { /* observability sink failure is also non-fatal */ });
      }
    }
```

Fill in the placeholders with the actual variable names from the existing
executor body:
- `totalTokens` — whatever the executor computed for total tokens
- `runId` — the existing run identifier variable
- `traceId` — the existing trace identifier variable
- `threadId` — the existing thread identifier variable (may be undefined)

The exact `EvalRunRecord` shape is defined in `core/src/evals/types.ts`.
Match it precisely — the fields above are the canonical Stage 24 shape.
If a field name differs in the actual type, adjust.

---

## CHANGE 4 — `packages/agentic-ai-infra-runtime/test/evals/single-agent-evals.test.ts` (NEW)

Create this file with the parent directory if it doesn't exist:

```typescript
import { describe, expect, it } from "vitest";
import type { AgentDefinition } from "@maharudra/agentic-ai-infra-core";
import {
  SINGLE_AGENT_SUITE_NAME,
  runSingleAgentEvals
} from "../../src/evals/single-agent-evals.js";

describe("runSingleAgentEvals — required tools check", () => {
  it("skips check when requiredTools is undefined", () => {
    const result = runSingleAgentEvals(
      { selectedToolIds: [], tokenUsage: { totalTokens: 0 } },
      { id: "manager", role: "manager", evalRules: {} }
    );
    const check = result.checks.find((c) => c.name === "required-tools");
    expect(check?.status).toBe("skipped");
  });

  it("passes when all required tools are selected", () => {
    const definition: AgentDefinition = {
      id: "manager",
      role: "manager",
      evalRules: { requiredTools: ["agentic.retrieval.search"] }
    };
    const result = runSingleAgentEvals(
      {
        selectedToolIds: ["agentic.retrieval.search", "agentic.context.build"],
        tokenUsage: { totalTokens: 100 }
      },
      definition
    );
    const check = result.checks.find((c) => c.name === "required-tools");
    expect(check?.status).toBe("passed");
  });

  it("fails when a required tool is missing", () => {
    const definition: AgentDefinition = {
      id: "manager",
      role: "manager",
      evalRules: { requiredTools: ["agentic.retrieval.search"] }
    };
    const result = runSingleAgentEvals(
      { selectedToolIds: [], tokenUsage: { totalTokens: 0 } },
      definition
    );
    const check = result.checks.find((c) => c.name === "required-tools");
    expect(check?.status).toBe("failed");
    expect(result.status).toBe("failed");
  });
});

describe("runSingleAgentEvals — forbidden tools check", () => {
  it("skips check when forbiddenTools is undefined", () => {
    const result = runSingleAgentEvals(
      { selectedToolIds: ["any.tool"], tokenUsage: { totalTokens: 0 } },
      { id: "manager", role: "manager", evalRules: {} }
    );
    const check = result.checks.find((c) => c.name === "forbidden-tools");
    expect(check?.status).toBe("skipped");
  });

  it("fails when a forbidden tool is selected", () => {
    const definition: AgentDefinition = {
      id: "manager",
      role: "manager",
      evalRules: { forbiddenTools: ["agentic.write.propose"] }
    };
    const result = runSingleAgentEvals(
      {
        selectedToolIds: ["agentic.write.propose"],
        tokenUsage: { totalTokens: 0 }
      },
      definition
    );
    const check = result.checks.find((c) => c.name === "forbidden-tools");
    expect(check?.status).toBe("failed");
    expect(result.status).toBe("failed");
  });
});

describe("runSingleAgentEvals — hard budget check", () => {
  it("skips check when hardBudget is undefined", () => {
    const result = runSingleAgentEvals(
      { selectedToolIds: [], tokenUsage: { totalTokens: 9999 } },
      { id: "manager", role: "manager", evalRules: {} }
    );
    const check = result.checks.find((c) => c.name === "hard-budget");
    expect(check?.status).toBe("skipped");
  });

  it("passes when usage is at or below hardBudget", () => {
    const definition: AgentDefinition = {
      id: "manager",
      role: "manager",
      evalRules: { hardBudget: 1000 }
    };
    const result = runSingleAgentEvals(
      { selectedToolIds: [], tokenUsage: { totalTokens: 999 } },
      definition
    );
    const check = result.checks.find((c) => c.name === "hard-budget");
    expect(check?.status).toBe("passed");
  });

  it("fails when usage exceeds hardBudget", () => {
    const definition: AgentDefinition = {
      id: "manager",
      role: "manager",
      evalRules: { hardBudget: 1000 }
    };
    const result = runSingleAgentEvals(
      { selectedToolIds: [], tokenUsage: { totalTokens: 1001 } },
      definition
    );
    const check = result.checks.find((c) => c.name === "hard-budget");
    expect(check?.status).toBe("failed");
    expect(result.status).toBe("failed");
  });
});

describe("runSingleAgentEvals — overall report shape", () => {
  it("returns suiteName 'single-agent-safety'", () => {
    const result = runSingleAgentEvals(
      { selectedToolIds: [], tokenUsage: { totalTokens: 0 } },
      undefined
    );
    expect(result.suiteName).toBe(SINGLE_AGENT_SUITE_NAME);
    expect(result.suiteName).toBe("single-agent-safety");
  });
});
```

---

## VERIFICATION

```powershell
pnpm.cmd typecheck
pnpm.cmd build
pnpm.cmd test
pnpm.cmd lint
```

All must pass. Test count should be ~472.

Common pitfalls:
- `QualityCheck`/`QualityReport` field names may differ slightly from the
  draft above (e.g. `message` instead of `detail`). Read the existing
  types in `core/src/evals/types.ts` and match them exactly.
- The `EvalRunRecord` push must include `recordedAt: new Date().toISOString()`
  — that's the canonical pattern from Stage 24.
- The push is in a `try/catch` because the executor's contract is that
  business logic completes even if observability fails. Do not change that
  invariant.

---

## SELF-REVIEW CHECKLIST

- [ ] `runtime/src/evals/single-agent-evals.ts` created with `runSingleAgentEvals`, `SINGLE_AGENT_SUITE_NAME`, `SingleAgentEvalInput` type
- [ ] Three check helpers: `checkRequiredTools`, `checkForbiddenTools`, `checkHardBudget`
- [ ] Each helper returns `status: "skipped"` when its rule is undefined or `[]`
- [ ] `runSingleAgentEvals` returns overall `status: "failed"` if any check failed
- [ ] `runSingleAgentEvals` returns `status: "passed"` when every non-skipped check passed (skipped checks don't fail the overall report)
- [ ] `runtime/src/evals/index.ts` re-exports the new symbols
- [ ] `SingleAgentExecutor.execute()` pushes ONLY when `evalStore` AND `managerDefinition.evalRules` are both present
- [ ] Push is wrapped in `try/catch`; failure does not abort the agent run
- [ ] Push uses `recordedAt: new Date().toISOString()` (Stage 24 convention)
- [ ] New test file has 8 tests across 4 describe blocks
- [ ] `pnpm.cmd typecheck` passes
- [ ] `pnpm.cmd build` passes
- [ ] `pnpm.cmd test` reports ~472 passing
- [ ] `pnpm.cmd lint` passes

---

## WHAT NOT TO DO

- ❌ Do NOT modify `runAgentRuntimeEvals()` — it's locked by D17, single-agent has its own path (D24)
- ❌ Do NOT push to `evalStore` when `evalRules` is undefined — produces junk records, violates D24
- ❌ Do NOT make `runSingleAgentEvals` throw — return a report with `status: "failed"` instead
- ❌ Do NOT swallow the agent run's `ok` result if the eval push fails — the run completes regardless (eval is observation, not gating)
- ❌ Do NOT add eval push to `TokenEfficientMultiAgentExecutor` — multi-agent already uses `runAgentRuntimeEvals()` via the AgentEvaluator suite
- ❌ Do NOT introduce a new `EvalRunRecord` shape — reuse the Stage 24 type from core
- ❌ Do NOT change the `suiteName` from `"single-agent-safety"` — the dashboard's Stage 26 surface keys off this string
- ❌ Do NOT add LLM calls or any I/O in the eval helpers — they are deterministic, synchronous, pure-ish (one timestamp aside)
- ❌ Do NOT bypass `try/catch` around the push — observability sink failures must never abort the agent run

---

## DONE SIGNAL

```
Stage 25 Phase 05 complete. Test count: [N]/[N] passing.
CI: build ✓ typecheck ✓ test ✓ lint ✓.
Files changed:
  packages/agentic-ai-infra-runtime/src/evals/single-agent-evals.ts (new — runSingleAgentEvals + 3 check helpers + SINGLE_AGENT_SUITE_NAME)
  packages/agentic-ai-infra-runtime/src/evals/index.ts (modified — 2 re-exports + 1 type re-export)
  packages/agentic-ai-infra-runtime/src/agents/index.ts (modified — SingleAgentExecutor pushes EvalRunRecord when evalRules + evalStore present, non-fatal)
  packages/agentic-ai-infra-runtime/test/evals/single-agent-evals.test.ts (new — 8 tests across 4 describe blocks)
Next: Phase 06 — validator + docs (final phase of Stage 25).
```

Do not add commentary after this block.
