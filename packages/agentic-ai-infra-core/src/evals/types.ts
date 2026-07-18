import type { FrameworkResult } from "../errors/index.js";

/** Status for one eval or quality report. */
export type EvalStatus = "passed" | "failed" | "skipped";

/** One eval result with optional numeric metrics. */
export type EvalResult = {
  readonly id: string;
  readonly name: string;
  readonly status: EvalStatus;
  readonly message?: string;
  readonly metrics?: Record<string, number>;
};

/** Summary of an eval suite run. */
export type QualityReport = {
  readonly suiteName: string;
  readonly status: EvalStatus;
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly results: readonly EvalResult[];
};

/** Contract for a runnable eval suite. */
export interface EvalSuiteContract {
  readonly name: string;
  /** Runs the suite and returns a typed quality report. */
  run(): Promise<FrameworkResult<QualityReport>>;
}

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
