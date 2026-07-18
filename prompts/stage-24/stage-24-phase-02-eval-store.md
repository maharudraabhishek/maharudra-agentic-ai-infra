# Stage 24 — Phase 2: EvalStore (in-memory ring buffer)
## Claude Code Prompt — MahaRudra Agentic AI Infra

---

## BEFORE YOU START

**Platform:** Windows 11, PowerShell, Node >= 20, **pnpm only**
**CI command:** `pnpm run ci`
**Read first:** `AGENTS.md`, `STATUS.md`, `kb.md`
**Prerequisite:** Phase 1 complete (core types and validator), CI green at ~360 tests
**Expected after this phase:** ~370 tests passing

---

## SCOPE — Phase 2 only

Implement `InMemoryEvalStore` — the runtime-side ring buffer satisfying core's `EvalStore` interface. Single new component, no integration with executors or MCP tools (those come in later phases).

---

## FILES TO CHANGE

```
packages/agentic-ai-infra-runtime/src/evals/eval-store.ts        NEW
packages/agentic-ai-infra-runtime/src/evals/index.ts             MODIFY (export)
packages/agentic-ai-infra-runtime/test/evals/eval-store.test.ts  NEW
```

---

## CHANGE 1 — `runtime/src/evals/eval-store.ts` (NEW)

```typescript
import type { EvalRunRecord, EvalStore } from "@maharudra/agentic-ai-infra-core";

/**
 * Default capacity for the in-memory eval record buffer.
 *
 * Configurable via `config.evals.store.capacity`. Records are dropped in
 * insertion order when capacity is exceeded.
 */
export const DEFAULT_EVAL_STORE_CAPACITY = 100;

/**
 * In-memory ring buffer implementation of `EvalStore`.
 *
 * Single-threaded Node — no concurrency primitives needed. Order is insertion
 * order; wall-clock time is not used for sorting.
 *
 * Records are stored newest-last. `getHistory()` returns oldest-first to match
 * timeline expectations of the dashboard.
 *
 * Stage 27 will introduce `PostgresEvalStore` implementing the same `EvalStore`
 * interface. Consumers (suites, MCP tools, dashboard provider) will not change.
 *
 * @example
 * const store = new InMemoryEvalStore({ capacity: 50 });
 * store.push({
 *   runId: "r1",
 *   traceId: "t1",
 *   recordedAt: new Date().toISOString(),
 *   report
 * });
 * const latest = store.getLatest();
 * const last10 = store.getHistory(10);
 */
export class InMemoryEvalStore implements EvalStore {
  private readonly buffer: EvalRunRecord[] = [];
  private readonly capacity: number;

  /**
   * Creates an in-memory store with the given capacity.
   *
   * @param options - Optional config; `capacity` defaults to
   *   `DEFAULT_EVAL_STORE_CAPACITY`. Invalid capacity (non-integer, zero,
   *   negative) is silently replaced with the default — the constructor
   *   never throws.
   */
  constructor(options?: { readonly capacity?: number }) {
    const requested = options?.capacity;
    this.capacity =
      typeof requested === "number" && Number.isInteger(requested) && requested > 0
        ? requested
        : DEFAULT_EVAL_STORE_CAPACITY;
  }

  /**
   * Appends a record. Drops the oldest when capacity is exceeded.
   */
  push(record: EvalRunRecord): void {
    this.buffer.push(record);
    while (this.buffer.length > this.capacity) {
      this.buffer.shift();
    }
  }

  /**
   * Returns the most recently pushed record, or undefined when empty.
   */
  getLatest(): EvalRunRecord | undefined {
    return this.buffer.length > 0 ? this.buffer[this.buffer.length - 1] : undefined;
  }

  /**
   * Returns records in chronological (oldest-first) order, up to `limit`.
   *
   * - `limit` undefined or larger than buffer → all records.
   * - `limit <= 0` → empty array.
   * - Otherwise → last `limit` records.
   *
   * Returns a shallow copy — mutating it does not affect the store.
   */
  getHistory(limit?: number): readonly EvalRunRecord[] {
    if (limit === undefined || limit >= this.buffer.length) {
      return [...this.buffer];
    }
    if (limit <= 0) {
      return [];
    }
    return this.buffer.slice(-limit);
  }

  /**
   * Returns the current count of records.
   */
  size(): number {
    return this.buffer.length;
  }

  /**
   * Empties the store. Used by tests; not exposed via MCP.
   */
  clear(): void {
    this.buffer.length = 0;
  }
}
```

---

## CHANGE 2 — `runtime/src/evals/index.ts`

Add to the existing exports (existing file already does `export * from "./retrieval-evals.js"` and contains `runAgentRuntimeEvals`):

```typescript
export * from "./eval-store.js";
```

Do not reorder or remove existing exports.

---

## CHANGE 3 — `runtime/test/evals/eval-store.test.ts` (NEW)

Create the directory `runtime/test/evals/` if it does not exist.

```typescript
import { describe, expect, it } from "vitest";
import type { EvalRunRecord, QualityReport } from "@maharudra/agentic-ai-infra-core";
import { InMemoryEvalStore, DEFAULT_EVAL_STORE_CAPACITY } from "../../src/evals/eval-store.js";

function makeRecord(id: string): EvalRunRecord {
  const report: QualityReport = {
    suiteName: "test",
    status: "passed",
    total: 1,
    passed: 1,
    failed: 0,
    skipped: 0,
    results: []
  };
  return {
    runId: `run-${id}`,
    traceId: `trace-${id}`,
    recordedAt: new Date().toISOString(),
    report
  };
}

describe("InMemoryEvalStore", () => {
  it("returns undefined from getLatest when empty", () => {
    const store = new InMemoryEvalStore();
    expect(store.getLatest()).toBeUndefined();
    expect(store.size()).toBe(0);
  });

  it("returns the pushed record after a single push", () => {
    const store = new InMemoryEvalStore();
    const r = makeRecord("a");
    store.push(r);
    expect(store.getLatest()).toEqual(r);
    expect(store.size()).toBe(1);
  });

  it("returns records in chronological order from getHistory", () => {
    const store = new InMemoryEvalStore();
    const r1 = makeRecord("1");
    const r2 = makeRecord("2");
    const r3 = makeRecord("3");
    store.push(r1);
    store.push(r2);
    store.push(r3);

    const history = store.getHistory();
    expect(history).toHaveLength(3);
    expect(history[0]).toEqual(r1);
    expect(history[2]).toEqual(r3);
  });

  it("respects the limit parameter and returns the most recent", () => {
    const store = new InMemoryEvalStore();
    store.push(makeRecord("1"));
    store.push(makeRecord("2"));
    store.push(makeRecord("3"));

    const lastOne = store.getHistory(1);
    expect(lastOne).toHaveLength(1);
    expect(lastOne[0].runId).toBe("run-3");
  });

  it("getHistory(0) returns empty array", () => {
    const store = new InMemoryEvalStore();
    store.push(makeRecord("1"));
    expect(store.getHistory(0)).toEqual([]);
  });

  it("getHistory with limit larger than size returns all", () => {
    const store = new InMemoryEvalStore();
    store.push(makeRecord("1"));
    expect(store.getHistory(100)).toHaveLength(1);
  });

  it("drops oldest records when capacity is exceeded", () => {
    const store = new InMemoryEvalStore({ capacity: 3 });
    for (let i = 1; i <= 5; i += 1) {
      store.push(makeRecord(String(i)));
    }
    expect(store.size()).toBe(3);
    const history = store.getHistory();
    expect(history[0].runId).toBe("run-3");
    expect(history[2].runId).toBe("run-5");
  });

  it("clear() empties the store", () => {
    const store = new InMemoryEvalStore();
    store.push(makeRecord("1"));
    store.push(makeRecord("2"));
    store.clear();
    expect(store.size()).toBe(0);
    expect(store.getLatest()).toBeUndefined();
  });

  it("default capacity is DEFAULT_EVAL_STORE_CAPACITY", () => {
    expect(DEFAULT_EVAL_STORE_CAPACITY).toBe(100);
    const store = new InMemoryEvalStore();
    // Fill past default capacity
    for (let i = 0; i < 120; i += 1) {
      store.push(makeRecord(String(i)));
    }
    expect(store.size()).toBe(100);
  });

  it("invalid capacity values fall back to default", () => {
    const cases: ReadonlyArray<number | undefined> = [0, -1, 1.5, NaN];
    for (const cap of cases) {
      const store = new InMemoryEvalStore({ capacity: cap as number });
      // Push 105 and confirm we kept exactly 100
      for (let i = 0; i < 105; i += 1) {
        store.push(makeRecord(String(i)));
      }
      expect(store.size()).toBe(100);
    }
  });

  it("getHistory returns a shallow copy that does not mutate the store", () => {
    const store = new InMemoryEvalStore();
    store.push(makeRecord("1"));
    const history = store.getHistory() as EvalRunRecord[];
    history.length = 0; // mutate copy
    expect(store.size()).toBe(1);
  });
});
```

---

## SELF-REVIEW CHECKLIST

- [ ] `runtime/src/evals/eval-store.ts` exists with `InMemoryEvalStore` and `DEFAULT_EVAL_STORE_CAPACITY` exports
- [ ] `InMemoryEvalStore implements EvalStore` from core — no type errors
- [ ] All 5 methods present: `push`, `getLatest`, `getHistory`, `size`, `clear`
- [ ] Ring buffer drops oldest when capacity exceeded
- [ ] Invalid capacity falls back to default (never throws)
- [ ] `runtime/src/evals/index.ts` exports the new file
- [ ] All ≥10 new tests pass
- [ ] All previous tests still pass (~360 + 10 = ~370)
- [ ] `pnpm run ci` passes: build ✓ typecheck ✓ test ✓ lint ✓
- [ ] JSDoc on `InMemoryEvalStore`, constructor, and every public method

---

## WHAT NOT TO DO

- Do NOT make this a singleton — every container creates its own store
- Do NOT add async methods — `EvalStore` is fully synchronous
- Do NOT throw from `push` — record loss is silent (ring buffer semantics)
- Do NOT add file or DB I/O — this is in-memory only
- Do NOT change the `EvalStore` interface from core — implement as defined

---

## DONE SIGNAL

```
Stage 24 Phase 2 complete.
Test count: [N]/[N] passing (target ~370).
CI: build ✓ typecheck ✓ test ✓ lint ✓
Files changed: 3
Next: Phase 3 — EvalHarness
```
