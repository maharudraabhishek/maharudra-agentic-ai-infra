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
