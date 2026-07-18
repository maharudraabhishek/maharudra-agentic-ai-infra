# Stage 24 — Phase 1: Core types and validator
## Claude Code Prompt — MahaRudra Agentic AI Infra

---

## BEFORE YOU START

**Platform:** Windows 11, PowerShell, Node >= 20, **pnpm only**
**CI command:** `pnpm run ci` (build → typecheck → test → lint)
**Read first:** `AGENTS.md`, `STATUS.md`, `kb.md` (per session protocol)
**Current test count:** 341/341 passing
**Expected after this phase:** ~360 passing

This prompt is self-contained. Do not invent details. Do not modify any file outside the "Files to change" list. Run `pnpm run ci` at the end.

---

## SCOPE — Phase 1 only

Add the core type contracts and validator that all later phases depend on. No runtime code, no MCP tools, no dashboard work. Pure types + one validator function.

---

## FILES TO CHANGE

```
packages/agentic-ai-infra-core/src/evals/types.ts                MODIFY (append)
packages/agentic-ai-infra-core/src/evals/validator.ts            NEW
packages/agentic-ai-infra-core/src/config/types.ts               MODIFY (append + extend)
packages/agentic-ai-infra-core/src/config/validator.ts           MODIFY (add eval validation)
packages/agentic-ai-infra-core/src/errors/index.ts               MODIFY (extend ErrorCode union)
packages/agentic-ai-infra-core/src/index.ts                      MODIFY (re-export validator)
packages/agentic-ai-infra-core/test/eval-types.test.ts           NEW
packages/agentic-ai-infra-core/test/eval-validator.test.ts       NEW
packages/agentic-ai-infra-core/test/config-validator.test.ts     MODIFY (add eval tests)
packages/agentic-ai-infra-core/test/exports.test.ts              MODIFY (assert new export)
```

---

## CHANGE 1 — `core/src/evals/types.ts`

The file currently contains `EvalStatus`, `EvalResult`, `QualityReport`, `EvalSuiteContract`. Keep all existing content unchanged. Append the following types at the end of the file:

```typescript
/**
 * Aggregated quality report covering one or more eval suites.
 *
 * Returned by `EvalHarness.runAll()` and by both MCP eval tools
 * (`agentic.evals.run`, `agentic.evals.agent-eval`). Single-suite results
 * appear as `suites: [report]`. Multi-suite results contain one entry per
 * registered suite that produced output.
 *
 * `status` is the worst-of across child reports:
 *   - any "failed" → "failed"
 *   - else any "passed" → "passed"
 *   - else "skipped"
 *
 * `total`, `passed`, `failed`, `skipped` are sums across all `suites[*]`.
 */
export type AggregateQualityReport = {
  readonly status: EvalStatus;
  readonly suites: readonly QualityReport[];
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
};

/**
 * One persisted eval record stored by the `EvalStore`.
 *
 * Holds the `QualityReport` produced after an agent run, plus correlation IDs
 * so dashboards and Stage 27 trajectory views can join eval data to runs and
 * threads. `report.suiteName` carries the suite identity — do not duplicate
 * it here.
 */
export type EvalRunRecord = {
  readonly runId: string;
  readonly traceId: string;
  /** Thread id when a session manager is wired; undefined otherwise. */
  readonly threadId?: string;
  /** ISO-8601 wall-clock timestamp at the moment of push. */
  readonly recordedAt: string;
  readonly report: QualityReport;
};

/**
 * In-memory registry interface for eval run records.
 *
 * `EvalStore` is a runtime registry, NOT persistent storage. D6 (StorageProvider
 * for persistence) does not apply — this is the same category as
 * `TokenUsageRecorder`. Stage 27 will introduce a Postgres-backed implementation
 * via this same interface.
 *
 * Order semantics: insertion order. Node is single-threaded so concurrent async
 * pushes resolve sequentially.
 */
export interface EvalStore {
  /** Appends a record. Drops oldest when capacity is exceeded. */
  push(record: EvalRunRecord): void;
  /** Returns the most recently pushed record, or undefined when empty. */
  getLatest(): EvalRunRecord | undefined;
  /**
   * Returns records in chronological (oldest-first) order, up to `limit`.
   * When `limit` is undefined, returns all records.
   */
  getHistory(limit?: number): readonly EvalRunRecord[];
  /** Returns the current count of records. */
  size(): number;
  /** Empties the store. Used by tests; not exposed via MCP. */
  clear(): void;
}

/**
 * Match mode for `EvalDatasetItem.expectedAnswer` checking.
 *
 * - `"substring"` (default): case-insensitive substring match after whitespace
 *   normalization. Deterministic, no provider calls.
 * - `"exact"`: case-sensitive exact match after trim. Deterministic.
 * - `"semantic"`: delegated to `LlmJudgeEvaluator`. When the LLM judge is
 *   disabled (default), items with this match mode return "skipped".
 */
export type EvalAnswerMatchMode = "substring" | "exact" | "semantic";

/**
 * One item in an eval dataset.
 *
 * The minimum required fields (`id`, `question`, `expectedChunks`,
 * `expectedAnswer`, `expectedToolCalls`) match the P3 design doc spec.
 * Optional fields enable stratified evaluation and per-item budgeting.
 */
export type EvalDatasetItem = {
  readonly id: string;
  readonly question: string;
  readonly expectedChunks: readonly string[];
  readonly expectedAnswer: string;
  readonly expectedToolCalls: readonly string[];
  readonly tags?: readonly string[];
  readonly difficulty?: "easy" | "medium" | "hard";
  readonly matchMode?: EvalAnswerMatchMode;
  readonly tokenBudget?: number;
  readonly metadata?: {
    readonly source?: string;
    readonly createdAt?: string;
  };
};

/**
 * A complete versioned eval dataset.
 *
 * `version` is required from v1 onward so the loader can evolve the schema
 * without breaking existing files.
 */
export type EvalDataset = {
  readonly version: 1;
  readonly name: string;
  readonly description?: string;
  readonly items: readonly EvalDatasetItem[];
};
```

---

## CHANGE 2 — `core/src/evals/validator.ts` (NEW)

Hand-rolled validator. No external schema libraries. Mirrors the style of `core/src/config/validator.ts`.

```typescript
import type { EvalDataset, EvalDatasetItem } from "./types.js";
import { fail, ok, type FrameworkResult } from "../errors/index.js";

/**
 * Validates an unknown value against the `EvalDataset` schema (version 1).
 *
 * Returns `FrameworkResult<EvalDataset>` — no throws. Validation errors carry
 * recoverable severity so callers can decide whether to abort or skip the file.
 *
 * @example
 * const raw = JSON.parse(jsonText);
 * const result = validateEvalDataset(raw);
 * if (result.ok) {
 *   const dataset: EvalDataset = result.value;
 * }
 */
export function validateEvalDataset(value: unknown): FrameworkResult<EvalDataset> {
  if (!isRecord(value)) {
    return fail({
      code: "evals.invalid-dataset",
      message: "Eval dataset must be a JSON object.",
      severity: "recoverable"
    });
  }

  if (value.version !== 1) {
    return fail({
      code: "evals.invalid-dataset-version",
      message: `Unsupported eval dataset version: ${String(value.version)}. Expected 1.`,
      severity: "recoverable"
    });
  }

  if (typeof value.name !== "string" || value.name.trim().length === 0) {
    return fail({
      code: "evals.invalid-dataset",
      message: "Eval dataset must have a non-empty 'name' field.",
      severity: "recoverable"
    });
  }

  if (!Array.isArray(value.items)) {
    return fail({
      code: "evals.invalid-dataset",
      message: "Eval dataset 'items' must be an array.",
      severity: "recoverable"
    });
  }

  const items: EvalDatasetItem[] = [];

  for (let i = 0; i < value.items.length; i += 1) {
    const itemResult = validateItem(value.items[i], i);
    if (!itemResult.ok) {
      return itemResult;
    }
    items.push(itemResult.value);
  }

  return ok({
    version: 1,
    name: value.name,
    description: typeof value.description === "string" ? value.description : undefined,
    items
  });
}

function validateItem(raw: unknown, index: number): FrameworkResult<EvalDatasetItem> {
  if (!isRecord(raw)) {
    return fail({
      code: "evals.invalid-dataset-item",
      message: `Item at index ${index} is not an object.`,
      severity: "recoverable"
    });
  }

  if (typeof raw.id !== "string" || raw.id.trim().length === 0) {
    return fail({
      code: "evals.invalid-dataset-item",
      message: `Item at index ${index} is missing a non-empty 'id' field.`,
      severity: "recoverable"
    });
  }

  if (typeof raw.question !== "string") {
    return fail({
      code: "evals.invalid-dataset-item",
      message: `Item '${raw.id}' is missing a string 'question' field.`,
      severity: "recoverable"
    });
  }

  if (!isStringArray(raw.expectedChunks)) {
    return fail({
      code: "evals.invalid-dataset-item",
      message: `Item '${raw.id}' must have 'expectedChunks' as an array of strings.`,
      severity: "recoverable"
    });
  }

  if (typeof raw.expectedAnswer !== "string") {
    return fail({
      code: "evals.invalid-dataset-item",
      message: `Item '${raw.id}' must have a string 'expectedAnswer' field.`,
      severity: "recoverable"
    });
  }

  if (!isStringArray(raw.expectedToolCalls)) {
    return fail({
      code: "evals.invalid-dataset-item",
      message: `Item '${raw.id}' must have 'expectedToolCalls' as an array of strings.`,
      severity: "recoverable"
    });
  }

  if (raw.tags !== undefined && !isStringArray(raw.tags)) {
    return fail({
      code: "evals.invalid-dataset-item",
      message: `Item '${raw.id}' has invalid 'tags' — must be array of strings.`,
      severity: "recoverable"
    });
  }

  const difficulty = raw.difficulty;
  if (
    difficulty !== undefined &&
    difficulty !== "easy" &&
    difficulty !== "medium" &&
    difficulty !== "hard"
  ) {
    return fail({
      code: "evals.invalid-dataset-item",
      message: `Item '${raw.id}' has invalid 'difficulty'.`,
      severity: "recoverable"
    });
  }

  const matchMode = raw.matchMode;
  if (
    matchMode !== undefined &&
    matchMode !== "substring" &&
    matchMode !== "exact" &&
    matchMode !== "semantic"
  ) {
    return fail({
      code: "evals.invalid-dataset-item",
      message: `Item '${raw.id}' has invalid 'matchMode'.`,
      severity: "recoverable"
    });
  }

  if (
    raw.tokenBudget !== undefined &&
    (typeof raw.tokenBudget !== "number" || raw.tokenBudget <= 0)
  ) {
    return fail({
      code: "evals.invalid-dataset-item",
      message: `Item '${raw.id}' has invalid 'tokenBudget' — must be positive number.`,
      severity: "recoverable"
    });
  }

  return ok({
    id: raw.id,
    question: raw.question,
    expectedChunks: raw.expectedChunks,
    expectedAnswer: raw.expectedAnswer,
    expectedToolCalls: raw.expectedToolCalls,
    tags: raw.tags,
    difficulty: difficulty as EvalDatasetItem["difficulty"],
    matchMode: matchMode as EvalDatasetItem["matchMode"],
    tokenBudget: raw.tokenBudget as number | undefined,
    metadata: isRecord(raw.metadata)
      ? {
          source: typeof raw.metadata.source === "string" ? raw.metadata.source : undefined,
          createdAt: typeof raw.metadata.createdAt === "string" ? raw.metadata.createdAt : undefined
        }
      : undefined
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}
```

---

## CHANGE 3 — `core/src/config/types.ts`

Locate the existing `ContextConfig` type. AFTER it (before `ProjectIdentityConfig`), add:

```typescript
/**
 * Eval system configuration.
 *
 * Controls in-memory `EvalStore` capacity and the optional `LlmJudgeEvaluator`.
 * All fields are optional; defaults are conservative.
 */
export type EvalsConfig = {
  /**
   * `EvalStore` configuration.
   */
  readonly store?: {
    /**
     * Ring buffer capacity in records. Default: 100.
     * Older records are dropped when capacity is exceeded.
     */
    readonly capacity?: number;
  };
  /**
   * Optional LLM-judge evaluator. Disabled by default.
   *
   * When `enabled === true` AND a SmartRouter is wired into the runtime
   * container, the `LlmJudgeEvaluator` is registered into the `EvalHarness`.
   */
  readonly llmJudge?: {
    readonly enabled?: boolean;
    /**
     * Reserved for future use. Stage 24 does not honor this field —
     * provider selection is policy-driven inside SmartRouter via
     * `LlmRoutingPolicy`.
     */
    readonly providerId?: string;
  };
};
```

In `AgenticInfraProjectConfig`, after `readonly context?: ContextConfig;` add:

```typescript
  /**
   * Eval system configuration.
   *
   * When absent, defaults apply: store capacity 100, LLM judge disabled.
   */
  readonly evals?: EvalsConfig;
```

In `ResolvedProjectConfig`, add the same `readonly evals?: EvalsConfig;` field in the same relative position.

---

## CHANGE 4 — `core/src/errors/index.ts`

Locate the existing `ErrorCode` string-literal union (starts at line 8 with `export type ErrorCode =`). Add the following entries BEFORE the final `| "framework.internal-error";` line:

```typescript
  // Eval errors (Stage 24)
  | "evals.invalid-dataset"
  | "evals.invalid-dataset-version"
  | "evals.invalid-dataset-item"
  | "evals.dataset-not-found"
  | "evals.dataset-path-traversal"
  | "evals.suite-not-registered"
  | "evals.empty-store"
  | "config.invalid-evals-store-capacity"
  | "config.llm-judge-requires-llm-config"
```

Do not duplicate existing codes. Do not reorder pre-existing entries.

---

## CHANGE 5 — `core/src/config/validator.ts`

Locate `DefaultConfigValidator.validate()`. Add the following block at the same level as the existing validation checks, before the success return:

```typescript
    // evals validation (Stage 24)
    if (config.evals !== undefined) {
      if (config.evals.store?.capacity !== undefined) {
        const cap = config.evals.store.capacity;
        if (typeof cap !== "number" || !Number.isInteger(cap) || cap <= 0) {
          return fail({
            code: "config.invalid-evals-store-capacity",
            message: "config.evals.store.capacity must be a positive integer.",
            severity: "recoverable"
          });
        }
      }

      if (config.evals.llmJudge?.enabled === true && !config.llm) {
        return fail({
          code: "config.llm-judge-requires-llm-config",
          message:
            "config.evals.llmJudge.enabled requires config.llm to be configured.",
          severity: "recoverable"
        });
      }
    }
```

If `fail` is not already imported in `validator.ts`, add it from `../errors/index.js`.

---

## CHANGE 6 — `core/src/index.ts`

After the existing line `export * from "./evals/types.js";` add:

```typescript
export * from "./evals/validator.js";
```

No other changes — the new types are all exported via `evals/types.js` already.

---

## CHANGE 7 — `core/test/eval-types.test.ts` (NEW)

```typescript
import { describe, expect, it } from "vitest";
import type {
  AggregateQualityReport,
  EvalRunRecord,
  EvalStore,
  EvalDataset,
  EvalDatasetItem,
  EvalAnswerMatchMode,
  QualityReport
} from "../src/index.js";

describe("Stage 24 eval types", () => {
  it("AggregateQualityReport has the expected shape", () => {
    const report: AggregateQualityReport = {
      status: "passed",
      suites: [],
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0
    };
    expect(report.suites).toEqual([]);
  });

  it("EvalRunRecord includes correlation IDs", () => {
    const inner: QualityReport = {
      suiteName: "test",
      status: "passed",
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      results: []
    };
    const record: EvalRunRecord = {
      runId: "run-1",
      traceId: "trace-1",
      recordedAt: new Date().toISOString(),
      report: inner
    };
    expect(record.runId).toBe("run-1");
    expect(record.traceId).toBe("trace-1");
  });

  it("EvalDataset v1 with minimum fields", () => {
    const dataset: EvalDataset = { version: 1, name: "test", items: [] };
    expect(dataset.version).toBe(1);
  });

  it("EvalDatasetItem required fields", () => {
    const item: EvalDatasetItem = {
      id: "item-1",
      question: "What?",
      expectedChunks: [],
      expectedAnswer: "ok",
      expectedToolCalls: []
    };
    expect(item.id).toBe("item-1");
  });

  it("EvalAnswerMatchMode union values", () => {
    const modes: readonly EvalAnswerMatchMode[] = ["substring", "exact", "semantic"];
    expect(modes).toContain("substring");
  });

  it("EvalStore interface can be implemented", () => {
    class TestStore implements EvalStore {
      private readonly records: EvalRunRecord[] = [];
      push(r: EvalRunRecord): void { this.records.push(r); }
      getLatest(): EvalRunRecord | undefined { return this.records[this.records.length - 1]; }
      getHistory(limit?: number): readonly EvalRunRecord[] {
        return limit === undefined ? [...this.records] : this.records.slice(-limit);
      }
      size(): number { return this.records.length; }
      clear(): void { this.records.length = 0; }
    }
    expect(new TestStore().size()).toBe(0);
  });
});
```

---

## CHANGE 8 — `core/test/eval-validator.test.ts` (NEW)

```typescript
import { describe, expect, it } from "vitest";
import { validateEvalDataset } from "../src/evals/validator.js";

describe("validateEvalDataset", () => {
  it("accepts an empty v1 dataset", () => {
    const r = validateEvalDataset({ version: 1, name: "x", items: [] });
    expect(r.ok).toBe(true);
  });

  it("rejects missing version", () => {
    const r = validateEvalDataset({ name: "x", items: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("evals.invalid-dataset-version");
  });

  it("rejects wrong version", () => {
    const r = validateEvalDataset({ version: 2, name: "x", items: [] });
    expect(r.ok).toBe(false);
  });

  it("rejects missing name", () => {
    const r = validateEvalDataset({ version: 1, items: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("evals.invalid-dataset");
  });

  it("rejects non-array items", () => {
    const r = validateEvalDataset({ version: 1, name: "x", items: "no" });
    expect(r.ok).toBe(false);
  });

  it("rejects item missing id", () => {
    const r = validateEvalDataset({
      version: 1, name: "x",
      items: [{ question: "q", expectedChunks: [], expectedAnswer: "a", expectedToolCalls: [] }]
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("evals.invalid-dataset-item");
  });

  it("rejects item with non-array expectedChunks", () => {
    const r = validateEvalDataset({
      version: 1, name: "x",
      items: [{ id: "i", question: "q", expectedChunks: "no", expectedAnswer: "a", expectedToolCalls: [] }]
    });
    expect(r.ok).toBe(false);
  });

  it("rejects item with invalid difficulty", () => {
    const r = validateEvalDataset({
      version: 1, name: "x",
      items: [{
        id: "i", question: "q", expectedChunks: [], expectedAnswer: "a", expectedToolCalls: [],
        difficulty: "extreme"
      }]
    });
    expect(r.ok).toBe(false);
  });

  it("rejects item with invalid matchMode", () => {
    const r = validateEvalDataset({
      version: 1, name: "x",
      items: [{
        id: "i", question: "q", expectedChunks: [], expectedAnswer: "a", expectedToolCalls: [],
        matchMode: "fuzzy"
      }]
    });
    expect(r.ok).toBe(false);
  });

  it("rejects item with negative tokenBudget", () => {
    const r = validateEvalDataset({
      version: 1, name: "x",
      items: [{
        id: "i", question: "q", expectedChunks: [], expectedAnswer: "a", expectedToolCalls: [],
        tokenBudget: -1
      }]
    });
    expect(r.ok).toBe(false);
  });

  it("accepts an item with all optional fields", () => {
    const r = validateEvalDataset({
      version: 1, name: "x",
      items: [{
        id: "i", question: "q", expectedChunks: ["c"], expectedAnswer: "a", expectedToolCalls: ["t"],
        tags: ["security"], difficulty: "medium", matchMode: "exact", tokenBudget: 4000,
        metadata: { source: "test", createdAt: "2026-05-22" }
      }]
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.items[0].tags).toEqual(["security"]);
      expect(r.value.items[0].matchMode).toBe("exact");
    }
  });

  it("preserves description when present", () => {
    const r = validateEvalDataset({ version: 1, name: "x", description: "y", items: [] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.description).toBe("y");
  });
});
```

---

## CHANGE 9 — `core/test/config-validator.test.ts` (add tests)

Append these tests using the file's existing patterns. Construct the minimal valid config required by the validator before adding the `evals` field.

- `evals.store.capacity = 50` → ok
- `evals.store.capacity = 0` → fail with `config.invalid-evals-store-capacity`
- `evals.store.capacity = -5` → fail
- `evals.store.capacity = 1.5` → fail
- `evals.llmJudge.enabled = true` without `llm` config → fail with `config.llm-judge-requires-llm-config`
- `evals.llmJudge.enabled = true` WITH `llm` config → ok
- `evals.llmJudge.enabled = false` without `llm` config → ok

---

## CHANGE 10 — `core/test/exports.test.ts` (extend)

Add an assertion that `validateEvalDataset` is exported as a function:

```typescript
import { validateEvalDataset } from "../src/index.js";
// ... inside an appropriate test block:
expect(typeof validateEvalDataset).toBe("function");
```

Follow the file's existing assertion pattern exactly.

---

## SELF-REVIEW CHECKLIST

- [ ] `core/src/evals/types.ts` has 6 new types: `AggregateQualityReport`, `EvalRunRecord`, `EvalStore`, `EvalAnswerMatchMode`, `EvalDatasetItem`, `EvalDataset`
- [ ] `core/src/evals/validator.ts` exports `validateEvalDataset`
- [ ] `core/src/config/types.ts` declares `EvalsConfig` and adds `readonly evals?: EvalsConfig` to BOTH `AgenticInfraProjectConfig` and `ResolvedProjectConfig`
- [ ] `core/src/errors/index.ts` adds 9 new entries before `framework.internal-error`
- [ ] `core/src/config/validator.ts` validates `evals.store.capacity` and `evals.llmJudge.enabled` rules
- [ ] `core/src/index.ts` re-exports `./evals/validator.js`
- [ ] All new types have JSDoc blocks
- [ ] `pnpm typecheck` passes
- [ ] All 341 previous tests still pass
- [ ] New tests pass: ≥6 in `eval-types.test.ts`, ≥12 in `eval-validator.test.ts`, ≥7 added to `config-validator.test.ts`, 1 added to `exports.test.ts`
- [ ] `pnpm run ci` passes: build ✓ typecheck ✓ test ✓ lint ✓

---

## WHAT NOT TO DO

- Do NOT add `EvalsConfig` to any profile in `built-in-profiles.ts` (D11)
- Do NOT add new dependencies — hand-roll the validator
- Do NOT extend `EvalSuiteContract` (D14)
- Do NOT touch any package other than core
- Do NOT modify existing types — only append

---

## DONE SIGNAL

```
Stage 24 Phase 1 complete.
Test count: [N]/[N] passing (target ~360).
CI: build ✓ typecheck ✓ test ✓ lint ✓
Files changed: [list]
Next: Phase 2 — EvalStore
```
