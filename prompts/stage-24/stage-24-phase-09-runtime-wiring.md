# Stage 24 — Phase 9: Runtime container wiring
## Claude Code Prompt — MahaRudra Agentic AI Infra

---

## BEFORE YOU START

**Platform:** Windows 11, PowerShell, Node >= 20, **pnpm only**
**CI command:** `pnpm run ci`
**Read first:** `AGENTS.md`, `STATUS.md`, `kb.md`, `packages/agentic-ai-infra-runtime/src/runtime/index.ts` (find `RuntimeServiceContainer` type at ~line 98 and `createRuntimeServiceContainer` at ~line 235; the final `return ok({...})` is at ~line 450)
**Prerequisite:** Phases 1–8 complete; CI green at ~410 tests
**Expected after this phase:** ~410 tests passing (wiring only)

---

## SCOPE — Phase 9 only

Wire `InMemoryEvalStore` and `EvalHarness` into `createRuntimeServiceContainer()`. Both fields become NON-OPTIONAL on `RuntimeServiceContainer` (D16). Register default suites: `RetrievalQualitySuite` and `AgentEvaluator` always; `LlmJudgeEvaluator` only when `config.evals.llmJudge.enabled === true` AND `smartRouter` exists (D15). DatasetEvaluator is NOT auto-registered (caller-driven).

Update the runtime dashboard provider so its `getSnapshot()` pulls fresh eval reports from the store on every call.

---

## VERIFIED FACTS

- `RuntimeServiceContainer.trajectoryRecorder` and `.tokenRecorder` are non-optional today — `evalStore` and `evalHarness` follow the same pattern
- `createFrameworkToolHandlers` now accepts `evalHarness` as its 4th positional argument (added in Phase 8)
- `runtime/src/dashboard/index.ts` `createRuntimeDashboardDataProvider` already accepts `evalReports?: readonly QualityReport[]` and aggregates them via `summarizeEvals()`. Stage 24 adds an `evalStore?` field so `getSnapshot()` can pull fresh history at request time.
- `DashboardEvalSummary` shape is `{ total, passed, failed, skipped }` — unchanged. Do NOT add `lastRunStatus` or `historyCount` fields.

---

## FILES TO CHANGE

```
packages/agentic-ai-infra-runtime/src/runtime/index.ts        MODIFY
packages/agentic-ai-infra-runtime/src/dashboard/index.ts      MODIFY (add evalStore support)
packages/agentic-ai-infra-runtime/test/runtime.test.ts        MODIFY (container shape assertions)
```

---

## CHANGE 1 — `runtime/src/runtime/index.ts`

### 1a. Imports

Add at the top:

```typescript
import { EvalHarness } from "../harness/eval-harness.js";
import {
  InMemoryEvalStore,
  RetrievalQualitySuite,
  AgentEvaluator,
  LlmJudgeEvaluator
} from "../evals/index.js";
import type { EvalStore } from "@maharudra/agentic-ai-infra-core";
```

### 1b. Extend `RuntimeServiceContainer`

Locate the `RuntimeServiceContainer` type (~line 98). Add two NON-OPTIONAL fields after `tokenRecorder`:

```typescript
  readonly tokenRecorder: TokenUsageRecorder;
  /**
   * In-memory eval record store. Capacity from `config.evals.store.capacity`
   * (default 100). Always wired — Stage 27 will swap in a Postgres-backed
   * implementation behind the same `EvalStore` interface.
   */
  readonly evalStore: EvalStore;
  /**
   * Eval harness with `RetrievalQualitySuite` and `AgentEvaluator` pre-registered.
   * `LlmJudgeEvaluator` is registered only when
   * `config.evals.llmJudge.enabled === true` AND `smartRouter` is set.
   * `DatasetEvaluator` is NOT auto-registered (caller-driven; keeps startup
   * I/O-free).
   */
  readonly evalHarness: EvalHarness;
```

### 1c. Construct and register suites inside `createRuntimeServiceContainer`

Locate the spot immediately before `return ok({...})` (~line 450). Add:

```typescript
  // Stage 24: eval store + harness wiring.
  const evalStore = new InMemoryEvalStore({
    capacity: resolved.value.evals?.store?.capacity
  });
  const evalHarness = new EvalHarness();

  // Always-on suites. Both use lazy options providers so they pull fresh data
  // at run-time.
  evalHarness.registerSuite(
    new RetrievalQualitySuite(() => ({}))
  );
  evalHarness.registerSuite(
    new AgentEvaluator(evalStore, () => ({}))
  );

  // LLM judge — disabled by default. Requires explicit enable + SmartRouter (D15).
  if (resolved.value.evals?.llmJudge?.enabled === true && smartRouter) {
    evalHarness.registerSuite(
      new LlmJudgeEvaluator(smartRouter, () => ({ items: [] }))
    );
  }
```

### 1d. Update the handlers wiring

The `handlers` field today reads:

```typescript
handlers: options.handlers ?? createFrameworkToolHandlers(retrievalRouter, smartRouter, embeddingProvider),
```

Update to pass the harness as the 4th argument:

```typescript
handlers: options.handlers ?? createFrameworkToolHandlers(retrievalRouter, smartRouter, embeddingProvider, evalHarness),
```

### 1e. Add the new fields to the container's `return ok({...})` block

Add `evalStore` and `evalHarness` to the object literal:

```typescript
  return ok({
    config: resolved.value,
    tools: registeredTools,
    handlers: options.handlers ?? createFrameworkToolHandlers(retrievalRouter, smartRouter, embeddingProvider, evalHarness),
    observability: options.observability ?? new StderrObservabilitySink(),
    trajectoryRecorder,
    tokenRecorder: options.tokenRecorder ?? new TokenUsageRecorder(),
    evalStore,
    evalHarness,
    retrievalRouter,
    storageProvider,
    sessionManager,
    traceSink,
    smartRouter,
    embeddingProvider
  });
```

---

## CHANGE 2 — `runtime/src/dashboard/index.ts`

The existing `RuntimeDashboardDataProviderOptions` already has `evalReports?: readonly QualityReport[]`. Add a new `evalStore?: EvalStore` field. When present, `getSnapshot()` pulls reports from the store at request time. The static `evalReports` option remains for callers that prefer pre-computed lists.

### 2a. Extend the options type

```typescript
export type RuntimeDashboardDataProviderOptions = {
  readonly config: ResolvedProjectConfig;
  readonly tokenRecorder?: TokenUsageRecorder;
  readonly trajectoryRecorder?: TrajectoryRecorder;
  /**
   * Pre-computed eval reports for callers that want static input.
   * Mutually exclusive with `evalStore` — when both are set, `evalStore` wins.
   */
  readonly evalReports?: readonly QualityReport[];
  /**
   * Live eval store. When set, `getSnapshot()` resolves reports lazily on each
   * call via `store.getHistory().map(r => r.report)`.
   */
  readonly evalStore?: EvalStore;
  readonly retrievalSourceCount?: number;
  readonly retrievalProviderCount?: number;
  readonly cacheEntries?: number;
  readonly securityWarnings?: readonly string[];
};
```

Also add the import at top:

```typescript
import type { EvalStore } from "@maharudra/agentic-ai-infra-core";
```

### 2b. Update `getSnapshot()` to resolve reports from the store

Inside `createRuntimeDashboardDataProvider`, locate the line:

```typescript
const evalTotals = summarizeEvals(options.evalReports ?? []);
```

Replace with:

```typescript
const evalReports =
  options.evalStore
    ? options.evalStore.getHistory().map((record) => record.report)
    : (options.evalReports ?? []);
const evalTotals = summarizeEvals(evalReports);
```

No other changes in this file — the `DashboardEvalSummary` shape stays `{ total, passed, failed, skipped }`.

---

## CHANGE 3 — `runtime/test/runtime.test.ts`

Add assertions verifying the new container shape. Find the existing tests that destructure the container or assert on its fields. Add tests:

```typescript
it("RuntimeServiceContainer exposes evalStore as a non-optional field", () => {
  // Build container using the existing helper / minimal config used by other tests in this file.
  const result = createRuntimeServiceContainer(minimalConfig);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.evalStore).toBeDefined();
    expect(typeof result.value.evalStore.push).toBe("function");
    expect(result.value.evalStore.size()).toBe(0);
  }
});

it("RuntimeServiceContainer exposes evalHarness with default suites", () => {
  const result = createRuntimeServiceContainer(minimalConfig);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.evalHarness).toBeDefined();
    const names = result.value.evalHarness.listSuiteNames();
    expect(names).toContain("retrieval-quality");
    expect(names).toContain("agent-evaluator");
    // LLM judge NOT registered without explicit enable
    expect(names).not.toContain("llm-judge");
  }
});

it("evalStore capacity honors config.evals.store.capacity", () => {
  const result = createRuntimeServiceContainer({
    ...minimalConfig,
    evals: { store: { capacity: 5 } }
  });
  expect(result.ok).toBe(true);
  if (result.ok) {
    // Push 10 records and verify only 5 are retained
    for (let i = 0; i < 10; i += 1) {
      result.value.evalStore.push({
        runId: `r${i}`,
        traceId: `t${i}`,
        recordedAt: new Date().toISOString(),
        report: {
          suiteName: "x",
          status: "passed",
          total: 1,
          passed: 1,
          failed: 0,
          skipped: 0,
          results: []
        }
      });
    }
    expect(result.value.evalStore.size()).toBe(5);
  }
});
```

If `minimalConfig` is not the variable name used in the file, use whatever the file already does to construct a baseline config.

---

## SELF-REVIEW CHECKLIST

- [ ] `RuntimeServiceContainer.evalStore` is non-optional and typed as `EvalStore`
- [ ] `RuntimeServiceContainer.evalHarness` is non-optional and typed as `EvalHarness`
- [ ] `evalStore` capacity comes from `resolved.value.evals?.store?.capacity` (passes undefined when absent — `InMemoryEvalStore` falls back to its default)
- [ ] `RetrievalQualitySuite` and `AgentEvaluator` always registered
- [ ] `LlmJudgeEvaluator` registered ONLY when `evals.llmJudge.enabled === true` AND `smartRouter` is set
- [ ] `DatasetEvaluator` NOT auto-registered (caller-driven)
- [ ] `createFrameworkToolHandlers` called with `evalHarness` as 4th arg
- [ ] `runtime/src/dashboard/index.ts` `RuntimeDashboardDataProviderOptions` includes `evalStore?: EvalStore`
- [ ] `getSnapshot()` resolves reports from store lazily when `evalStore` is set
- [ ] No new tests broke the existing ~410 count
- [ ] At least 3 new tests in `runtime.test.ts` (container shape + LLM judge gating + capacity)
- [ ] `pnpm run ci` passes
- [ ] JSDoc on the two new container fields
- [ ] No mention of `lastRunStatus` or `historyCount` anywhere — `DashboardEvalSummary` shape is unchanged

---

## WHAT NOT TO DO

- Do NOT make `evalStore` or `evalHarness` optional — they're always wired (D16)
- Do NOT register `DatasetEvaluator` automatically — it requires a base directory and could fail at startup
- Do NOT register `LlmJudgeEvaluator` without both conditions: enabled flag AND SmartRouter
- Do NOT modify `DashboardEvalSummary` — shape stays `{ total, passed, failed, skipped }`
- Do NOT pass the eval reports as a static snapshot when `evalStore` is set — use lazy resolution inside `getSnapshot()`
- Do NOT add a `clear()` call on `evalStore` from the container — store lifetime equals container lifetime

---

## DONE SIGNAL

```
Stage 24 Phase 9 complete.
Test count: [N]/[N] passing (target ~410).
CI: build ✓ typecheck ✓ test ✓ lint ✓
Files changed: 3
Next: Phase 10 — Dashboard /evals route
```
