# Stage 24 — Phase 4: Built-in eval suites
## Claude Code Prompt — MahaRudra Agentic AI Infra

---

## BEFORE YOU START

**Platform:** Windows 11, PowerShell, Node >= 20, **pnpm only**
**CI command:** `pnpm run ci`
**Read first:** `AGENTS.md`, `STATUS.md`, `kb.md`
**Prerequisite:** Phases 1, 2, 3 complete, CI green at ~380 tests
**Expected after this phase:** ~400 tests passing

---

## SCOPE — Phase 4 only

Implement the three deterministic eval suites and the dataset loader:
1. `RetrievalQualitySuite` — adapter wrapping existing `runRetrievalQualityEvals()`
2. `AgentEvaluator` — evaluates last N agent runs from `EvalStore`
3. `DatasetEvaluator` — scores datasets against actual run outputs
4. `DatasetLoader` — safe filesystem loader for JSON eval datasets

All four use the lazy options provider pattern (D14): suites take `() => Options` callbacks; the callback is invoked at `run()` time, not registration time.

`LlmJudgeEvaluator` is NOT in this phase — it's Phase 6.

---

## FILES TO CHANGE

```
packages/agentic-ai-infra-runtime/src/evals/retrieval-quality-suite.ts          NEW
packages/agentic-ai-infra-runtime/src/evals/agent-evaluator.ts                  NEW
packages/agentic-ai-infra-runtime/src/evals/dataset-loader.ts                   NEW
packages/agentic-ai-infra-runtime/src/evals/dataset-evaluator.ts                NEW
packages/agentic-ai-infra-runtime/src/evals/index.ts                            MODIFY (exports)
packages/agentic-ai-infra-runtime/test/evals/retrieval-quality-suite.test.ts    NEW
packages/agentic-ai-infra-runtime/test/evals/agent-evaluator.test.ts            NEW
packages/agentic-ai-infra-runtime/test/evals/dataset-loader.test.ts             NEW
packages/agentic-ai-infra-runtime/test/evals/dataset-evaluator.test.ts          NEW
```

---

## CHANGE 1 — `runtime/src/evals/retrieval-quality-suite.ts` (NEW)

```typescript
import type {
  EvalSuiteContract,
  FrameworkResult,
  QualityReport
} from "@maharudra/agentic-ai-infra-core";
import { ok } from "@maharudra/agentic-ai-infra-core";
import { runRetrievalQualityEvals, type RetrievalQualityEvalInput } from "./retrieval-evals.js";

/**
 * Lazy provider for retrieval-quality eval input.
 *
 * The provider is called inside `run()` so input can change between successive
 * harness runs without re-registering the suite.
 */
export type RetrievalQualityInputProvider = () => RetrievalQualityEvalInput;

/**
 * `EvalSuiteContract` adapter for the existing retrieval-quality eval set.
 *
 * Wraps `runRetrievalQualityEvals()`. The suite name is `"retrieval-quality"`.
 *
 * @example
 * const suite = new RetrievalQualitySuite(() => ({
 *   retrievedResults: lastResults,
 *   expectedChunkIds: ["chunk-1", "chunk-2"]
 * }));
 * harness.registerSuite(suite);
 */
export class RetrievalQualitySuite implements EvalSuiteContract {
  readonly name = "retrieval-quality";

  /**
   * @param inputProvider - Lazy callback returning current input.
   *   Called once per `run()` invocation.
   */
  constructor(private readonly inputProvider: RetrievalQualityInputProvider) {}

  async run(): Promise<FrameworkResult<QualityReport>> {
    const input = this.inputProvider();
    return ok(runRetrievalQualityEvals(input));
  }
}
```

---

## CHANGE 2 — `runtime/src/evals/agent-evaluator.ts` (NEW)

```typescript
import type {
  AgentRole,
  EvalResult,
  EvalStore,
  EvalSuiteContract,
  EvalStatus,
  FrameworkResult,
  QualityReport,
  SafeTrajectoryEvent
} from "@maharudra/agentic-ai-infra-core";
import { ok } from "@maharudra/agentic-ai-infra-core";
import { runAgentRuntimeEvals } from "./index.js";
import type { RuntimeMultiAgentRunReport } from "../agents/index.js";

/**
 * Options consumed by `AgentEvaluator` to drive `runAgentRuntimeEvals`.
 *
 * Stage 24 wires these from the suite-level options provider.
 * Stage 25 will derive them from `AgentDefinition.evalRules` per-agent.
 */
export type AgentEvalSuiteOptions = {
  /** Maximum runs to evaluate per invocation. Default: 10. */
  readonly limit?: number;
  /** Roles that must appear in a run's routed roles for it to pass. */
  readonly requiredRoles?: readonly AgentRole[];
  /** Tool ids that must NOT appear in the trajectory. */
  readonly forbiddenTools?: readonly string[];
  /** Hard token budget for the entire multi-agent run. */
  readonly hardBudget?: number;
  /**
   * Optional trajectory pull function. When provided, the evaluator passes the
   * resulting events into `runAgentRuntimeEvals`. When absent, trajectory-based
   * checks (forbidden tools, safe trajectory) return "skipped".
   */
  readonly trajectoryProvider?: () => readonly SafeTrajectoryEvent[];
  /**
   * Optional report provider. When provided, the evaluator re-runs role and
   * budget checks against this report. When absent, those checks return "skipped".
   *
   * Stage 24 note: `EvalStore` holds `QualityReport`s, not the raw
   * `RuntimeMultiAgentRunReport`. This provider lets callers re-evaluate the
   * most recent run with different rules without re-running the agent.
   */
  readonly reportProvider?: () => RuntimeMultiAgentRunReport | undefined;
};

/**
 * Lazy provider for agent-evaluator options.
 */
export type AgentEvalOptionsProvider = () => AgentEvalSuiteOptions;

/**
 * `EvalSuiteContract` that surfaces the stored eval history alongside re-run
 * checks against the configured rules.
 *
 * The aggregated suite report uses `suiteName = "agent-evaluator"`. It
 * combines:
 *   - the historic per-run reports from `EvalStore` (already evaluated at
 *     run time by the multi-agent executor)
 *   - a fresh `runAgentRuntimeEvals` against the report provider's output
 *     using the current options (so callers can sharpen rules without
 *     re-running the agent)
 *
 * Empty store → single "skipped" result.
 *
 * @example
 * const suite = new AgentEvaluator(store, () => ({
 *   limit: 5,
 *   requiredRoles: ["security-reviewer"],
 *   forbiddenTools: ["agentic.write.file"],
 *   hardBudget: 8000
 * }));
 * harness.registerSuite(suite);
 */
export class AgentEvaluator implements EvalSuiteContract {
  readonly name = "agent-evaluator";

  constructor(
    private readonly store: EvalStore,
    private readonly optionsProvider: AgentEvalOptionsProvider
  ) {}

  async run(): Promise<FrameworkResult<QualityReport>> {
    const options = this.optionsProvider();
    const limit = options.limit ?? 10;
    const history = this.store.getHistory(limit);

    if (history.length === 0) {
      return ok({
        suiteName: this.name,
        status: "skipped",
        total: 1,
        passed: 0,
        failed: 0,
        skipped: 1,
        results: [
          {
            id: "agent-evaluator.no-records",
            name: "agent evaluator no records",
            status: "skipped",
            message: "Eval store is empty — nothing to evaluate."
          }
        ]
      });
    }

    // 1) Surface historic per-run results.
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    const results: EvalResult[] = [];

    for (const record of history) {
      passed += record.report.passed;
      failed += record.report.failed;
      skipped += record.report.skipped;
      for (const r of record.report.results) {
        results.push({
          id: `${record.runId}.${r.id}`,
          name: `${record.runId}: ${r.name}`,
          status: r.status,
          message: r.message,
          metrics: r.metrics
        });
      }
    }

    // 2) Fresh re-eval against current rules using the report provider.
    const currentReport = options.reportProvider?.();
    const currentTrajectory = options.trajectoryProvider?.();

    if (currentReport || currentTrajectory) {
      const freshReport = runAgentRuntimeEvals({
        report: currentReport,
        trajectory: currentTrajectory,
        requiredRoles: options.requiredRoles,
        forbiddenTools: options.forbiddenTools,
        hardBudget: options.hardBudget
      });

      passed += freshReport.passed;
      failed += freshReport.failed;
      skipped += freshReport.skipped;
      for (const r of freshReport.results) {
        results.push({
          id: `current.${r.id}`,
          name: `current: ${r.name}`,
          status: r.status,
          message: r.message,
          metrics: r.metrics
        });
      }
    }

    const status: EvalStatus =
      failed > 0 ? "failed" : passed > 0 ? "passed" : "skipped";

    return ok({
      suiteName: this.name,
      status,
      total: results.length,
      passed,
      failed,
      skipped,
      results
    });
  }
}
```

---

## CHANGE 3 — `runtime/src/evals/dataset-loader.ts` (NEW)

```typescript
import { readFile } from "node:fs/promises";
import { resolve, isAbsolute, sep } from "node:path";
import {
  fail,
  ok,
  validateEvalDataset,
  type EvalDataset,
  type FrameworkResult
} from "@maharudra/agentic-ai-infra-core";

/**
 * Filesystem loader for eval datasets.
 *
 * Reads JSON files from a configured base directory and validates them against
 * the `EvalDataset` schema. Refuses paths that escape the base directory via
 * `..` traversal, absolute paths, or platform-specific separators in the
 * filename.
 *
 * @example
 * const loader = new DatasetLoader("examples/eval-data");
 * const result = await loader.load("retrieval-quality.json");
 * if (result.ok) {
 *   const dataset: EvalDataset = result.value;
 * }
 */
export class DatasetLoader {
  private readonly baseDir: string;

  /**
   * @param baseDir - Absolute or `process.cwd()`-relative directory. All loads
   *   are resolved within this directory.
   */
  constructor(baseDir: string) {
    this.baseDir = isAbsolute(baseDir) ? baseDir : resolve(process.cwd(), baseDir);
  }

  /**
   * Loads and validates one dataset file by relative filename.
   *
   * Rejects filenames containing path separators, traversal segments, or
   * absolute path prefixes. The defense-in-depth check on the resolved path
   * confirms the result stays inside `baseDir`.
   */
  async load(filename: string): Promise<FrameworkResult<EvalDataset>> {
    if (
      filename.includes("..") ||
      filename.includes("/") ||
      filename.includes("\\") ||
      filename.includes(sep) ||
      isAbsolute(filename)
    ) {
      return fail({
        code: "evals.dataset-path-traversal",
        message: `Dataset filename "${filename}" contains illegal path segments.`,
        severity: "recoverable"
      });
    }

    const filePath = resolve(this.baseDir, filename);

    if (!filePath.startsWith(this.baseDir + sep) && filePath !== this.baseDir) {
      return fail({
        code: "evals.dataset-path-traversal",
        message: "Resolved path escapes base directory.",
        severity: "recoverable"
      });
    }

    let raw: string;
    try {
      raw = await readFile(filePath, "utf-8");
    } catch {
      return fail({
        code: "evals.dataset-not-found",
        message: `Dataset file "${filename}" could not be read.`,
        severity: "recoverable"
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return fail({
        code: "evals.invalid-dataset",
        message: `Dataset file "${filename}" is not valid JSON.`,
        severity: "recoverable"
      });
    }

    return validateEvalDataset(parsed);
  }
}
```

---

## CHANGE 4 — `runtime/src/evals/dataset-evaluator.ts` (NEW)

```typescript
import type {
  EvalDataset,
  EvalDatasetItem,
  EvalResult,
  EvalStatus,
  EvalSuiteContract,
  FrameworkResult,
  QualityReport,
  RetrievalResult
} from "@maharudra/agentic-ai-infra-core";
import { ok } from "@maharudra/agentic-ai-infra-core";

/**
 * Input provided per-item to the dataset evaluator.
 *
 * The evaluator does not run a query itself — Stage 24 keeps it deterministic
 * by accepting pre-computed retrieval and answer data. The caller invokes the
 * retrieval pipeline and the agent run, then feeds the results back.
 */
export type DatasetItemInputs = {
  readonly itemId: string;
  /** Chunks returned by retrieval for this item's question. */
  readonly retrievedChunks?: readonly RetrievalResult[];
  /** Agent's answer text for this item's question. */
  readonly actualAnswer?: string;
  /** Tool ids actually called during the agent run. */
  readonly actualToolCalls?: readonly string[];
};

/**
 * Provider returning the dataset and per-item input data for one suite run.
 */
export type DatasetEvalOptionsProvider = () => {
  readonly dataset: EvalDataset;
  readonly itemInputs?: readonly DatasetItemInputs[];
};

/**
 * `EvalSuiteContract` that scores a dataset against actual run outputs.
 *
 * For each item:
 *   - retrieval check: every `expectedChunks` id appears in `retrievedChunks`
 *   - answer check: `actualAnswer` matches `expectedAnswer` per `matchMode`
 *   - tool-call check: every `expectedToolCalls` id appears in `actualToolCalls`
 *
 * Items with `matchMode === "semantic"` skip the answer check (the
 * `LlmJudgeEvaluator` handles those when enabled).
 *
 * Missing per-item inputs cause that item's checks to be "skipped" rather than
 * "failed" — supports partial evaluations during development.
 */
export class DatasetEvaluator implements EvalSuiteContract {
  readonly name = "dataset-evaluator";

  constructor(private readonly optionsProvider: DatasetEvalOptionsProvider) {}

  async run(): Promise<FrameworkResult<QualityReport>> {
    const { dataset, itemInputs } = this.optionsProvider();
    const inputById = new Map<string, DatasetItemInputs>(
      (itemInputs ?? []).map((entry) => [entry.itemId, entry])
    );

    const results: EvalResult[] = [];
    let passed = 0;
    let failed = 0;
    let skipped = 0;

    for (const item of dataset.items) {
      const input = inputById.get(item.id);
      const itemResults = [
        this.checkRetrieval(item, input),
        this.checkAnswer(item, input),
        this.checkToolCalls(item, input)
      ];

      for (const r of itemResults) {
        results.push(r);
        if (r.status === "passed") passed += 1;
        else if (r.status === "failed") failed += 1;
        else skipped += 1;
      }
    }

    const status: EvalStatus =
      failed > 0 ? "failed" : passed > 0 ? "passed" : "skipped";

    return ok({
      suiteName: this.name,
      status,
      total: results.length,
      passed,
      failed,
      skipped,
      results
    });
  }

  private checkRetrieval(item: EvalDatasetItem, input?: DatasetItemInputs): EvalResult {
    if (!input || input.retrievedChunks === undefined) {
      return {
        id: `${item.id}.retrieval`,
        name: `${item.id} retrieval`,
        status: "skipped",
        message: "No retrievedChunks provided."
      };
    }

    // chunkId is the canonical identifier when providers populate metadata;
    // otherwise sourceId is the next-best identifier. Both are stringified.
    const retrievedIds = new Set(
      input.retrievedChunks.map((r) => String(r.metadata?.chunkId ?? r.sourceId))
    );

    const missing = item.expectedChunks.filter((id) => !retrievedIds.has(id));

    if (missing.length > 0) {
      return {
        id: `${item.id}.retrieval`,
        name: `${item.id} retrieval`,
        status: "failed",
        message: `Missing expected chunks: ${missing.join(", ")}.`,
        metrics: { expected: item.expectedChunks.length, missing: missing.length }
      };
    }

    return {
      id: `${item.id}.retrieval`,
      name: `${item.id} retrieval`,
      status: "passed",
      metrics: { expected: item.expectedChunks.length, missing: 0 }
    };
  }

  private checkAnswer(item: EvalDatasetItem, input?: DatasetItemInputs): EvalResult {
    if (!input || input.actualAnswer === undefined) {
      return {
        id: `${item.id}.answer`,
        name: `${item.id} answer`,
        status: "skipped",
        message: "No actualAnswer provided."
      };
    }

    const mode = item.matchMode ?? "substring";

    if (mode === "semantic") {
      return {
        id: `${item.id}.answer`,
        name: `${item.id} answer`,
        status: "skipped",
        message: "Semantic match requires LlmJudgeEvaluator."
      };
    }

    const matched =
      mode === "exact"
        ? input.actualAnswer.trim() === item.expectedAnswer.trim()
        : normalize(input.actualAnswer).includes(normalize(item.expectedAnswer));

    return {
      id: `${item.id}.answer`,
      name: `${item.id} answer`,
      status: matched ? "passed" : "failed",
      message: matched ? undefined : `Answer did not match (mode=${mode}).`
    };
  }

  private checkToolCalls(item: EvalDatasetItem, input?: DatasetItemInputs): EvalResult {
    if (!input || input.actualToolCalls === undefined) {
      return {
        id: `${item.id}.tools`,
        name: `${item.id} tools`,
        status: "skipped",
        message: "No actualToolCalls provided."
      };
    }

    const calledSet = new Set(input.actualToolCalls);
    const missing = item.expectedToolCalls.filter((id) => !calledSet.has(id));

    if (missing.length > 0) {
      return {
        id: `${item.id}.tools`,
        name: `${item.id} tools`,
        status: "failed",
        message: `Missing expected tool calls: ${missing.join(", ")}.`,
        metrics: { expected: item.expectedToolCalls.length, missing: missing.length }
      };
    }

    return {
      id: `${item.id}.tools`,
      name: `${item.id} tools`,
      status: "passed",
      metrics: { expected: item.expectedToolCalls.length, missing: 0 }
    };
  }
}

/**
 * Case-insensitive whitespace normalization for substring matching.
 */
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}
```

---

## CHANGE 5 — `runtime/src/evals/index.ts`

Add to the existing exports (the file already exports `eval-store.js` from Phase 2):

```typescript
export * from "./retrieval-quality-suite.js";
export * from "./agent-evaluator.js";
export * from "./dataset-loader.js";
export * from "./dataset-evaluator.js";
```

---

## CHANGE 6 — Tests

### `runtime/test/evals/retrieval-quality-suite.test.ts` (NEW)

```typescript
import { describe, expect, it } from "vitest";
import { RetrievalQualitySuite } from "../../src/evals/retrieval-quality-suite.js";

describe("RetrievalQualitySuite", () => {
  it("has the name 'retrieval-quality'", () => {
    const suite = new RetrievalQualitySuite(() => ({}));
    expect(suite.name).toBe("retrieval-quality");
  });

  it("calls the input provider on each run", async () => {
    let calls = 0;
    const suite = new RetrievalQualitySuite(() => {
      calls += 1;
      return {};
    });
    await suite.run();
    await suite.run();
    expect(calls).toBe(2);
  });

  it("returns a QualityReport with suiteName from the wrapped runner", async () => {
    const suite = new RetrievalQualitySuite(() => ({}));
    const result = await suite.run();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.suiteName).toBe("retrieval-quality");
      expect(result.value.total).toBeGreaterThan(0);
    }
  });
});
```

### `runtime/test/evals/agent-evaluator.test.ts` (NEW)

```typescript
import { describe, expect, it } from "vitest";
import type { EvalRunRecord, QualityReport } from "@maharudra/agentic-ai-infra-core";
import { InMemoryEvalStore } from "../../src/evals/eval-store.js";
import { AgentEvaluator } from "../../src/evals/agent-evaluator.js";

function makeRecord(id: string): EvalRunRecord {
  const report: QualityReport = {
    suiteName: "agent-runtime-safety",
    status: "passed",
    total: 1,
    passed: 1,
    failed: 0,
    skipped: 0,
    results: [{ id: "x", name: "x", status: "passed" }]
  };
  return {
    runId: `run-${id}`,
    traceId: `trace-${id}`,
    recordedAt: new Date().toISOString(),
    report
  };
}

describe("AgentEvaluator", () => {
  it("returns skipped when store is empty", async () => {
    const store = new InMemoryEvalStore();
    const suite = new AgentEvaluator(store, () => ({}));
    const r = await suite.run();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe("skipped");
      expect(r.value.skipped).toBe(1);
    }
  });

  it("aggregates historic per-run reports", async () => {
    const store = new InMemoryEvalStore();
    store.push(makeRecord("1"));
    store.push(makeRecord("2"));
    const suite = new AgentEvaluator(store, () => ({}));
    const r = await suite.run();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.passed).toBe(2);
      expect(r.value.status).toBe("passed");
    }
  });

  it("respects the limit option", async () => {
    const store = new InMemoryEvalStore();
    for (let i = 0; i < 5; i += 1) store.push(makeRecord(String(i)));
    const suite = new AgentEvaluator(store, () => ({ limit: 2 }));
    const r = await suite.run();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.passed).toBe(2);
  });

  it("calls the options provider on each run", async () => {
    const store = new InMemoryEvalStore();
    store.push(makeRecord("1"));
    let calls = 0;
    const suite = new AgentEvaluator(store, () => {
      calls += 1;
      return {};
    });
    await suite.run();
    await suite.run();
    expect(calls).toBe(2);
  });

  it("includes fresh re-eval results when reportProvider is supplied", async () => {
    const store = new InMemoryEvalStore();
    store.push(makeRecord("1"));
    const suite = new AgentEvaluator(store, () => ({
      reportProvider: () => undefined,
      trajectoryProvider: () => []
    }));
    const r = await suite.run();
    expect(r.ok).toBe(true);
  });
});
```

### `runtime/test/evals/dataset-loader.test.ts` (NEW)

```typescript
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatasetLoader } from "../../src/evals/dataset-loader.js";

describe("DatasetLoader", () => {
  it("loads and validates a valid dataset", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eval-data-"));
    try {
      writeFileSync(
        join(dir, "good.json"),
        JSON.stringify({
          version: 1,
          name: "test",
          items: [{
            id: "i", question: "q", expectedChunks: [],
            expectedAnswer: "a", expectedToolCalls: []
          }]
        })
      );
      const loader = new DatasetLoader(dir);
      const r = await loader.load("good.json");
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.items).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("rejects path traversal with ..", async () => {
    const loader = new DatasetLoader(tmpdir());
    const r = await loader.load("../etc/passwd");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("evals.dataset-path-traversal");
  });

  it("rejects forward-slash path segments", async () => {
    const loader = new DatasetLoader(tmpdir());
    const r = await loader.load("sub/file.json");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("evals.dataset-path-traversal");
  });

  it("rejects backslash path segments", async () => {
    const loader = new DatasetLoader(tmpdir());
    const r = await loader.load("sub\\file.json");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("evals.dataset-path-traversal");
  });

  it("returns dataset-not-found for missing file", async () => {
    const loader = new DatasetLoader(tmpdir());
    const r = await loader.load("nope.json");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("evals.dataset-not-found");
  });

  it("returns invalid-dataset for invalid JSON", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eval-data-"));
    try {
      writeFileSync(join(dir, "bad.json"), "not-json");
      const loader = new DatasetLoader(dir);
      const r = await loader.load("bad.json");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("evals.invalid-dataset");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
```

### `runtime/test/evals/dataset-evaluator.test.ts` (NEW)

```typescript
import { describe, expect, it } from "vitest";
import type { EvalDataset, RetrievalResult } from "@maharudra/agentic-ai-infra-core";
import { DatasetEvaluator } from "../../src/evals/dataset-evaluator.js";

function makeDataset(itemOverrides: Partial<EvalDataset["items"][number]> = {}): EvalDataset {
  return {
    version: 1,
    name: "test",
    items: [{
      id: "i1",
      question: "q",
      expectedChunks: ["c1"],
      expectedAnswer: "the quick brown fox",
      expectedToolCalls: ["t1"],
      ...itemOverrides
    }]
  };
}

function chunk(id: string): RetrievalResult {
  return {
    providerId: "test",
    sourceId: id,
    score: 1,
    preview: "p",
    metadata: { chunkId: id }
  };
}

describe("DatasetEvaluator", () => {
  it("passes when retrieval, answer, and tools all match", async () => {
    const ds = makeDataset();
    const suite = new DatasetEvaluator(() => ({
      dataset: ds,
      itemInputs: [{
        itemId: "i1",
        retrievedChunks: [chunk("c1")],
        actualAnswer: "the QUICK brown fox jumps",
        actualToolCalls: ["t1"]
      }]
    }));
    const r = await suite.run();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe("passed");
  });

  it("fails retrieval when expected chunk is missing", async () => {
    const ds = makeDataset();
    const suite = new DatasetEvaluator(() => ({
      dataset: ds,
      itemInputs: [{ itemId: "i1", retrievedChunks: [], actualAnswer: "ok", actualToolCalls: ["t1"] }]
    }));
    const r = await suite.run();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe("failed");
  });

  it("substring match is case-insensitive after normalization", async () => {
    const ds = makeDataset();
    const suite = new DatasetEvaluator(() => ({
      dataset: ds,
      itemInputs: [{
        itemId: "i1",
        retrievedChunks: [chunk("c1")],
        actualAnswer: "THE   QUICK\n\nBROWN  FOX",
        actualToolCalls: ["t1"]
      }]
    }));
    const r = await suite.run();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe("passed");
  });

  it("exact match requires byte-equality after trim", async () => {
    const ds = makeDataset({ matchMode: "exact" });
    const suite = new DatasetEvaluator(() => ({
      dataset: ds,
      itemInputs: [{
        itemId: "i1",
        retrievedChunks: [chunk("c1")],
        actualAnswer: "the quick BROWN fox",
        actualToolCalls: ["t1"]
      }]
    }));
    const r = await suite.run();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe("failed");
  });

  it("semantic match is skipped", async () => {
    const ds = makeDataset({ matchMode: "semantic" });
    const suite = new DatasetEvaluator(() => ({
      dataset: ds,
      itemInputs: [{
        itemId: "i1",
        retrievedChunks: [chunk("c1")],
        actualAnswer: "ok",
        actualToolCalls: ["t1"]
      }]
    }));
    const r = await suite.run();
    expect(r.ok).toBe(true);
    if (r.ok) {
      const answerResult = r.value.results.find((x) => x.id === "i1.answer");
      expect(answerResult?.status).toBe("skipped");
    }
  });

  it("missing inputs result in skipped checks, not failures", async () => {
    const ds = makeDataset();
    const suite = new DatasetEvaluator(() => ({ dataset: ds, itemInputs: [] }));
    const r = await suite.run();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.skipped).toBe(3); // retrieval, answer, tools all skipped
      expect(r.value.failed).toBe(0);
    }
  });
});
```

---

## SELF-REVIEW CHECKLIST

- [ ] All 4 new source files compile and export the documented classes
- [ ] `RetrievalQualitySuite.name === "retrieval-quality"`
- [ ] `AgentEvaluator.name === "agent-evaluator"`
- [ ] `DatasetEvaluator.name === "dataset-evaluator"`
- [ ] All 4 classes use lazy options providers (D14)
- [ ] `DatasetLoader` rejects `..`, `/`, `\\`, absolute paths
- [ ] `DatasetEvaluator` treats `matchMode: "semantic"` as skipped (LLM judge handles it)
- [ ] `runtime/src/evals/index.ts` exports all 4 new files
- [ ] ≥20 new tests pass total across the 4 test files
- [ ] Previous ~380 tests still pass
- [ ] `pnpm run ci` passes
- [ ] JSDoc on every exported class, method, and type

---

## WHAT NOT TO DO

- Do NOT import filesystem libraries other than `node:fs/promises` and `node:path`
- Do NOT call the lazy options provider at construction time — only inside `run()`
- Do NOT add LLM judging logic to `DatasetEvaluator` — semantic skip is correct
- Do NOT register suites in any container yet — Phase 9 handles wiring
- Do NOT call `runRetrievalQualityEvals` or `runAgentRuntimeEvals` outside their respective suites
- Do NOT introduce a `MultiAgentReportProvider` interface in core — keep it as a function type in the suite options

---

## DONE SIGNAL

```
Stage 24 Phase 4 complete.
Test count: [N]/[N] passing (target ~400).
CI: build ✓ typecheck ✓ test ✓ lint ✓
Files changed: 9
Next: Phase 5 — Eval data fixtures
```
