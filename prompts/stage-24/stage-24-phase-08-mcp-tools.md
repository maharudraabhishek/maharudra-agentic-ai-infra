# Stage 24 — Phase 8: MCP eval tools
## Claude Code Prompt — MahaRudra Agentic AI Infra

---

## BEFORE YOU START

**Platform:** Windows 11, PowerShell, Node >= 20, **pnpm only**
**CI command:** `pnpm run ci`
**Read first:** `AGENTS.md`, `STATUS.md`, `kb.md`, `packages/agentic-ai-infra-runtime/src/tools/index.ts` (find `agentic.evals.run` contract at ~line 97 and handler at ~line 417), `packages/agentic-ai-infra-runtime/test/tools-evals-handler.test.ts` (note the existing `makeContext` helper and assertions on `output.total`, `output.skipped`)
**Prerequisite:** Phases 3, 4 complete (`EvalHarness`, suites available); CI green at ~405 tests
**Expected after this phase:** ~410 tests passing

---

## SCOPE — Phase 8 only

1. Upgrade `agentic.evals.run` to return the normalized `AggregateQualityReport` shape (D13)
2. Add new MCP tool `agentic.evals.agent-eval` that surfaces agent-evaluator history
3. Add optional `evalHarness?: EvalHarness` parameter to `createFrameworkToolHandlers()`
4. Update existing tests in `tools-evals-handler.test.ts` to assert the new aggregate shape
5. Add new test file `agent-eval-handler.test.ts` with ≥4 tests

`agentic.evals.run` continues to work without an `evalHarness` (back-compat path runs the static functions with empty input — preserves Stage 21 behavior).

---

## FILES TO CHANGE

```
packages/agentic-ai-infra-runtime/src/tools/index.ts                     MODIFY
packages/agentic-ai-infra-runtime/test/tools-evals-handler.test.ts       MODIFY (update assertions)
packages/agentic-ai-infra-runtime/test/tools/agent-eval-handler.test.ts  NEW
```

---

## CHANGE 1 — `runtime/src/tools/index.ts`

### 1a. Imports

Add at the top of the file (where existing eval imports live):

```typescript
import { EvalHarness, aggregateReports } from "../harness/eval-harness.js";
import type { AggregateQualityReport } from "@maharudra/agentic-ai-infra-core";
```

### 1b. Add the contract for `agentic.evals.agent-eval`

Locate `createFrameworkToolContracts()`. The existing block ends with the `agentic.evals.run` contract (~line 97) inside the returned array. Add a new contract entry immediately after `agentic.evals.run`:

```typescript
    {
      id: "agentic.evals.agent-eval",
      name: "Run Agent Eval",
      description:
        "Runs the agent-evaluator suite via the wired EvalHarness. " +
        "Returns the AggregateQualityReport. When no EvalHarness or " +
        "agent-evaluator suite is registered, returns an aggregate with " +
        "status='skipped'.",
      category: "eval",
      riskLevel: "low",
      outputPolicy: { remoteSafe: true, maxBytes: 16384 },
      runtimePolicy: { allowedModes: sharedModes, remoteSafe: true }
    }
```

### 1c. Update `createFrameworkToolHandlers` signature

Current signature (~line 130):

```typescript
export function createFrameworkToolHandlers(
  retrievalRouter?: RetrievalRouter,
  smartRouter?: SmartRouter,
  embeddingProvider?: EmbeddingProvider
): ReadonlyMap<string, ToolExecutionHandler>
```

Add `evalHarness?: EvalHarness` as the FINAL parameter (last position preserves call sites that don't supply it):

```typescript
export function createFrameworkToolHandlers(
  retrievalRouter?: RetrievalRouter,
  smartRouter?: SmartRouter,
  embeddingProvider?: EmbeddingProvider,
  evalHarness?: EvalHarness
): ReadonlyMap<string, ToolExecutionHandler>
```

Update the JSDoc to mention `evalHarness`:

```typescript
/**
 * ...
 * @param evalHarness - Optional `EvalHarness` for live eval dispatch. When set,
 *   `agentic.evals.run` and `agentic.evals.agent-eval` route through the
 *   harness; when absent, both fall back to a "skipped" aggregate response.
 */
```

### 1d. Extend `LIVE_TOOL_IDS`

Add the new tool id:

```typescript
const LIVE_TOOL_IDS = new Set([
  "agentic.retrieval.search",
  "agentic.context.build",
  "agentic.evals.run",
  "agentic.evals.agent-eval"
]);
```

### 1e. Replace the `agentic.evals.run` handler body

Locate the existing handler (~line 417). Replace the entire block:

```typescript
  handlers.set("agentic.evals.run", async (input, context) => {
    const rawInput = input as Record<string, unknown> | null | undefined;
    const suite =
      typeof rawInput?.suite === "string" ? rawInput.suite : "retrieval-quality";

    let report: QualityReport;

    // 1) Try the wired EvalHarness first (Stage 24 path).
    if (evalHarness) {
      const harnessResult = await evalHarness.runSuite(suite);
      if (harnessResult.ok) {
        report = harnessResult.value;
        const aggregate: AggregateQualityReport = aggregateReports([report]);
        return ok({
          toolId: "agentic.evals.run",
          output: aggregate as unknown as Record<string, unknown>,
          tokenUsage: { inputTokens: 1, outputTokens: 12, totalTokens: 13 },
          metadata: { safeSummary: true }
        });
      }
      // Harness present but suite not registered → fall through to static path
      // so the old behavior is preserved.
    }

    // 2) Back-compat static fallback (no harness or unknown suite).
    if (suite === "agent-runtime") {
      report = runAgentRuntimeEvals({});
    } else {
      report = runRetrievalQualityEvals({});
    }

    const aggregate: AggregateQualityReport = aggregateReports([report]);
    return ok({
      toolId: "agentic.evals.run",
      output: aggregate as unknown as Record<string, unknown>,
      tokenUsage: { inputTokens: 1, outputTokens: 12, totalTokens: 13 },
      metadata: { safeSummary: true }
    });
  });
```

### 1f. Add the new `agentic.evals.agent-eval` handler

Place this AFTER the `agentic.evals.run` handler block, BEFORE the final `return handlers;` line in the function:

```typescript
  // ---------------------------------------------------------------------------
  // agentic.evals.agent-eval — agent eval suite handler (Stage 24)
  // ---------------------------------------------------------------------------

  /**
   * Runs the `agent-evaluator` suite via the wired `EvalHarness`.
   *
   * When `evalHarness` is absent or the `agent-evaluator` suite is not
   * registered, returns an aggregate with `status: "skipped"`. This keeps the
   * tool always callable regardless of wiring state — same pattern as
   * `agentic.retrieval.search` returning "not-configured".
   */
  handlers.set("agentic.evals.agent-eval", async (_input, context) => {
    if (!evalHarness) {
      const aggregate: AggregateQualityReport = {
        status: "skipped",
        suites: [],
        total: 1,
        passed: 0,
        failed: 0,
        skipped: 1
      };
      return ok({
        toolId: "agentic.evals.agent-eval",
        output: aggregate as unknown as Record<string, unknown>,
        tokenUsage: { inputTokens: 1, outputTokens: 12, totalTokens: 13 },
        metadata: { safeSummary: true }
      });
    }

    const result = await evalHarness.runSuite("agent-evaluator");

    if (!result.ok) {
      // Suite not registered. Return a skipped aggregate rather than fail so
      // the tool is always usable.
      const aggregate: AggregateQualityReport = {
        status: "skipped",
        suites: [],
        total: 1,
        passed: 0,
        failed: 0,
        skipped: 1
      };
      return ok({
        toolId: "agentic.evals.agent-eval",
        output: aggregate as unknown as Record<string, unknown>,
        tokenUsage: { inputTokens: 1, outputTokens: 12, totalTokens: 13 },
        metadata: { safeSummary: true }
      });
    }

    const aggregate = aggregateReports([result.value]);
    return ok({
      toolId: "agentic.evals.agent-eval",
      output: aggregate as unknown as Record<string, unknown>,
      tokenUsage: { inputTokens: 1, outputTokens: 12, totalTokens: 13 },
      metadata: { safeSummary: true }
    });
  });
```

---

## CHANGE 2 — `runtime/test/tools-evals-handler.test.ts`

The existing tests assert `output.total === 6` and `output.results.length === 6`. The new aggregate shape preserves `output.total` (sums across suites — equal to the single suite's total when there's one suite). But `output.results` no longer exists at the top level — it lives at `output.suites[0].results`.

Update assertions in BOTH existing test bodies:

### Test "returns QualityReport shape with correct total for retrieval-quality suite"

Replace:
```typescript
expect(typeof output.suite).toBe("string");
expect(output.total).toBe(6);
expect(Array.isArray(output.results)).toBe(true);
expect((output.results as unknown[]).length).toBe(6);
```

With:
```typescript
expect(typeof output.status).toBe("string");
expect(output.total).toBe(6);
expect(Array.isArray(output.suites)).toBe(true);
const suites = output.suites as Array<{ suiteName: string; results: unknown[] }>;
expect(suites.length).toBe(1);
expect(suites[0].suiteName).toBe("retrieval-quality");
expect(suites[0].results.length).toBe(6);
```

### Test "retrieval-quality suite with empty input: all 6 checks are skipped"

The existing assertions reference `output.status`, `output.skipped`, `output.passed`, `output.failed` — these all remain on `AggregateQualityReport`. No change needed there. But add one line confirming the new shape:

```typescript
expect(Array.isArray(output.suites)).toBe(true);
```

### Test "agent-runtime suite skipped without report or trajectory"

If the existing test asserts on `output.results`, update to `output.suites[0].results` following the same pattern.

Use a tree search of the file to find every `output.results` reference and update it.

---

## CHANGE 3 — `runtime/test/tools/agent-eval-handler.test.ts` (NEW)

Create the directory `runtime/test/tools/` if it does not exist. Mirror the `makeContext()` helper from `tools-evals-handler.test.ts` — copy it locally rather than refactor the existing test.

```typescript
import { describe, expect, it } from "vitest";
import type { ToolContract, ToolExecutionContext, EvalRunRecord, QualityReport } from "@maharudra/agentic-ai-infra-core";
import { createFrameworkToolHandlers } from "../../src/index.js";
import { EvalHarness } from "../../src/harness/eval-harness.js";
import { InMemoryEvalStore } from "../../src/evals/eval-store.js";
import { AgentEvaluator } from "../../src/evals/agent-evaluator.js";

function makeContext(toolId: string): ToolExecutionContext {
  const contract: ToolContract = {
    id: toolId,
    name: toolId,
    description: "Test tool",
    category: "eval",
    riskLevel: "low",
    outputPolicy: { remoteSafe: true, maxBytes: 16384 },
    runtimePolicy: { allowedModes: ["local-stdio-mcp"], remoteSafe: true }
  };
  return {
    runtimeMode: "local-stdio-mcp",
    traceId: "trace-test",
    runId: "run-test",
    tool: contract,
    approvalMatched: true
  } as ToolExecutionContext;
}

function pushOneRecord(store: InMemoryEvalStore): void {
  const report: QualityReport = {
    suiteName: "agent-runtime-safety",
    status: "passed",
    total: 1,
    passed: 1,
    failed: 0,
    skipped: 0,
    results: [{ id: "x", name: "x", status: "passed" }]
  };
  const record: EvalRunRecord = {
    runId: "run-1",
    traceId: "trace-1",
    recordedAt: new Date().toISOString(),
    report
  };
  store.push(record);
}

describe("agentic.evals.agent-eval handler", () => {
  it("exists in the tool map", () => {
    const handlers = createFrameworkToolHandlers();
    expect(handlers.get("agentic.evals.agent-eval")).toBeDefined();
  });

  it("returns skipped aggregate when no EvalHarness is wired", async () => {
    const handlers = createFrameworkToolHandlers();
    const handler = handlers.get("agentic.evals.agent-eval")!;
    const result = await handler({}, makeContext("agentic.evals.agent-eval"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const output = result.value.output as Record<string, unknown>;
      expect(output.status).toBe("skipped");
      expect(Array.isArray(output.suites)).toBe(true);
      expect((output.suites as unknown[]).length).toBe(0);
    }
  });

  it("returns skipped aggregate when harness has no agent-evaluator suite", async () => {
    const harness = new EvalHarness();
    const handlers = createFrameworkToolHandlers(undefined, undefined, undefined, harness);
    const handler = handlers.get("agentic.evals.agent-eval")!;
    const result = await handler({}, makeContext("agentic.evals.agent-eval"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const output = result.value.output as Record<string, unknown>;
      expect(output.status).toBe("skipped");
    }
  });

  it("returns aggregated report when agent-evaluator suite is registered", async () => {
    const store = new InMemoryEvalStore();
    pushOneRecord(store);

    const harness = new EvalHarness();
    harness.registerSuite(new AgentEvaluator(store, () => ({})));

    const handlers = createFrameworkToolHandlers(undefined, undefined, undefined, harness);
    const handler = handlers.get("agentic.evals.agent-eval")!;
    const result = await handler({}, makeContext("agentic.evals.agent-eval"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const output = result.value.output as Record<string, unknown>;
      expect(output.status).toBe("passed");
      expect(Array.isArray(output.suites)).toBe(true);
      const suites = output.suites as Array<{ suiteName: string }>;
      expect(suites.length).toBe(1);
      expect(suites[0].suiteName).toBe("agent-evaluator");
    }
  });

  it("returns the AggregateQualityReport shape — top-level totals + suites array", async () => {
    const handlers = createFrameworkToolHandlers();
    const handler = handlers.get("agentic.evals.agent-eval")!;
    const result = await handler({}, makeContext("agentic.evals.agent-eval"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const output = result.value.output as Record<string, unknown>;
      expect(typeof output.total).toBe("number");
      expect(typeof output.passed).toBe("number");
      expect(typeof output.failed).toBe("number");
      expect(typeof output.skipped).toBe("number");
      expect(Array.isArray(output.suites)).toBe(true);
    }
  });
});
```

---

## SELF-REVIEW CHECKLIST

- [ ] `createFrameworkToolContracts()` includes the new `agentic.evals.agent-eval` entry with `category: "eval"`, `riskLevel: "low"`, `outputPolicy.maxBytes: 16384`, `remoteSafe: true`, `allowedModes: sharedModes`
- [ ] `LIVE_TOOL_IDS` includes `"agentic.evals.agent-eval"`
- [ ] `createFrameworkToolHandlers` accepts `evalHarness?: EvalHarness` as the final parameter
- [ ] `agentic.evals.run` handler returns `AggregateQualityReport` shape (not the old flattened shape)
- [ ] `agentic.evals.run` back-compat fallback still works (no harness → runs static `runRetrievalQualityEvals({})` / `runAgentRuntimeEvals({})`)
- [ ] `agentic.evals.agent-eval` handler returns skipped aggregate when harness is absent
- [ ] `agentic.evals.agent-eval` handler routes through `evalHarness.runSuite("agent-evaluator")` when wired
- [ ] Existing `tools-evals-handler.test.ts` assertions updated for the new shape (no more `output.results` at top level — use `output.suites[0].results`)
- [ ] New test file `agent-eval-handler.test.ts` has ≥4 tests, all passing
- [ ] `assertRemoteToolsSafe` does not reject the new tool (it has `remoteSafe: true` and `allowedModes: sharedModes` — passes the existing policy check)
- [ ] `pnpm run ci` passes
- [ ] No new dependencies added
- [ ] JSDoc on new contract, new handler, and updated `createFrameworkToolHandlers` signature

---

## WHAT NOT TO DO

- Do NOT remove the static back-compat path in `agentic.evals.run` — preserves zero-wiring usability
- Do NOT make `evalHarness` a required parameter
- Do NOT add input parameters to `agentic.evals.agent-eval` in Stage 24 — pulls from the harness as-is
- Do NOT return a `fail()` when the harness or suite is missing — return a skipped aggregate (consistency with existing live tools)
- Do NOT cast `output` to `unknown` and back without the `as unknown as Record<string, unknown>` indirection — TypeScript requires the double cast
- Do NOT wire the harness in this phase — Phase 9 handles container wiring

---

## DONE SIGNAL

```
Stage 24 Phase 8 complete.
Test count: [N]/[N] passing (target ~410).
CI: build ✓ typecheck ✓ test ✓ lint ✓
Files changed: 3
Next: Phase 9 — Runtime container wiring
```
