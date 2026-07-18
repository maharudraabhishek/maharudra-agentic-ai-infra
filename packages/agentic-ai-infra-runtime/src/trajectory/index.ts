import { createHash, randomUUID } from "node:crypto";
import type { SafeTrajectoryEvent } from "@maharudra/agentic-ai-infra-core";
import type { QueryableDatabase } from "../storage/index.js";

const UNSAFE_METADATA_KEYS = new Set([
  "approvalText",
  "rawApprovalText",
  "task",
  "taskText",
  "rawTaskText",
  "secret",
  "apiKey",
  "password",
  "privateKey",
  "vector",
  "embedding",
  "rawSql",
  "stack",
  "stackTrace",
  "commandOutput",
  "rawFile",
  "fullChunk"
]);

/**
 * Safe trajectory summary used by eval hooks and dashboard providers.
 */
export type TrajectorySummary = {
  readonly totalSteps: number;
  readonly deniedSteps: number;
  readonly errorSteps: number;
  readonly toolNames: readonly string[];
  readonly roles: readonly string[];
};

/**
 * Unified trajectory recorder interface.
 *
 * `recordStep()` is the synchronous path consumed by `AgentHarness` and legacy
 * callers that cannot await. `record()` is the async persistence path used by
 * the executors — it enables `PostgresTrajectoryRecorder` to INSERT into
 * `agentic_tool_calls` without blocking the harness pipeline. `summary()`
 * returns a safe bounded aggregate used by the dashboard data provider.
 *
 * All methods are non-fatal: implementations must swallow errors rather than
 * propagating them to the caller.
 */
export interface TrajectoryRecorder {
  /** Synchronous recording for harness and immediate in-process use. */
  recordStep(event: SafeTrajectoryEvent): void;
  /** Async recording with optional Postgres persistence. */
  record(event: SafeTrajectoryEvent): Promise<void>;
  /** Returns a bounded aggregate summary for dashboard consumption. */
  summary(): TrajectorySummary;
}

/**
 * In-memory trajectory recorder for harness and agent execution.
 *
 * Stores only safe metadata. Raw task text, approval text, chunks, vectors,
 * SQL, stack traces, and command output are never stored.
 *
 * Implements `TrajectoryRecorder` so it can be used wherever that interface
 * is expected (executors, harness, runtime container).
 *
 * @example
 * const recorder = new InMemoryTrajectoryRecorder();
 * recorder.recordStep({ traceId, runId, stepType: "plan", status: "completed", durationMs: 0 });
 * console.log(recorder.summary().totalSteps); // 1
 */
export class InMemoryTrajectoryRecorder implements TrajectoryRecorder {
  private readonly events: SafeTrajectoryEvent[] = [];

  /**
   * Records one sanitized trajectory event synchronously.
   *
   * Unsafe metadata keys are stripped before storage.
   */
  recordStep(event: SafeTrajectoryEvent): void {
    this.events.push({
      ...event,
      metadata: sanitizeMetadata(event.metadata)
    });
  }

  /**
   * Async adapter over `recordStep` — records the event in-memory and resolves.
   *
   * Allows in-memory recorders to satisfy the `TrajectoryRecorder` interface
   * used by executors without requiring a database connection.
   */
  async record(event: SafeTrajectoryEvent): Promise<void> {
    this.recordStep(event);
  }

  /**
   * Returns trajectory events in insertion order.
   */
  list(): readonly SafeTrajectoryEvent[] {
    return [...this.events];
  }

  /**
   * Builds a bounded summary without raw event payloads.
   */
  summary(): TrajectorySummary {
    return {
      totalSteps: this.events.length,
      deniedSteps: this.events.filter((event) => event.status === "denied").length,
      errorSteps: this.events.filter((event) => event.status === "error").length,
      toolNames: unique(this.events.map((event) => event.toolName).filter(isString)),
      roles: unique(this.events.map((event) => event.agentRole).filter(isString))
    };
  }
}

/**
 * Postgres-backed trajectory recorder that persists events to `agentic_tool_calls`.
 *
 * Each call to `record()` attempts an INSERT using the event's `threadId` as
 * the FK reference. When `threadId` is absent (no active thread), the INSERT is
 * skipped — no error is returned. All SQL errors are swallowed and emitted as
 * `console.warn` so a bad DB connection never propagates to the caller.
 *
 * ### Column mapping (SafeTrajectoryEvent → agentic_tool_calls)
 * - `call_id`       ← `randomUUID()`
 * - `thread_id`     ← `event.threadId` (skips INSERT when absent)
 * - `tool_name`     ← `event.toolName ?? event.stepType`
 * - `input_hash`    ← SHA-256 of `{taskHash, toolName}` (first 64 chars)
 * - `output_hash`   ← SHA-256 of `{status, tokenEstimate}` (first 64 chars)
 * - `status`        ← `event.status`
 * - `started_at`    ← NOW() (via SQL DEFAULT)
 * - `completed_at`  ← NOW() at call time (computed from durationMs=0 events)
 * - `error_code`    ← `event.errorCode`
 * - `token_estimate`← `event.tokenEstimate`
 *
 * @example
 * const recorder = new PostgresTrajectoryRecorder(db);
 * await recorder.record({ traceId, runId, stepType: "plan", status: "completed",
 *   durationMs: 0, threadId: "abc-123" });
 */
export class PostgresTrajectoryRecorder implements TrajectoryRecorder {
  /**
   * Creates a recorder backed by the provided database connection.
   *
   * @param db - An active `QueryableDatabase` (pg.Pool or injected adapter).
   */
  constructor(private readonly db: QueryableDatabase) {}

  /**
   * Fire-and-forget sync adapter. Calls `record()` without awaiting.
   *
   * Non-fatal: errors from `record()` are caught silently. This allows
   * the harness synchronous recording path to use PostgresTrajectoryRecorder
   * without needing to await.
   */
  recordStep(event: SafeTrajectoryEvent): void {
    this.record(event).catch((err) => {
      console.warn("[agentic-ai-infra] PostgresTrajectoryRecorder.recordStep failed:", err);
    });
  }

  /**
   * Returns an empty summary.
   *
   * `PostgresTrajectoryRecorder` does not maintain an in-memory event list —
   * events are persisted to Postgres only. The dashboard can query
   * `agentic_tool_calls` directly for richer data; this method satisfies the
   * interface contract without requiring a SQL round-trip.
   */
  summary(): TrajectorySummary {
    return { totalSteps: 0, deniedSteps: 0, errorSteps: 0, toolNames: [], roles: [] };
  }

  /**
   * Inserts one tool call record into `agentic_tool_calls`.
   *
   * Skips the INSERT when `event.threadId` is absent because `thread_id` is a
   * NOT NULL FK in the schema. All SQL errors are caught, logged to stderr, and
   * do not propagate to the caller.
   */
  async record(event: SafeTrajectoryEvent): Promise<void> {
    if (!event.threadId) {
      // No active thread — skip persistence rather than failing with an FK error.
      return;
    }

    const callId = randomUUID();
    const toolName = event.toolName ?? event.stepType;
    const inputHash = sha256({ taskHash: event.taskHash, toolName }).slice(0, 64);
    const outputHash = sha256({ status: event.status, tokenEstimate: event.tokenEstimate }).slice(0, 64);
    const now = new Date();

    try {
      await this.db.query(
        `INSERT INTO agentic_tool_calls
           (call_id, thread_id, tool_name, input_hash, output_hash, status,
            started_at, completed_at, error_code, token_estimate)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          callId,
          event.threadId,
          toolName,
          inputHash,
          outputHash,
          event.status,
          now,
          now,
          event.errorCode ?? null,
          event.tokenEstimate ?? null
        ]
      );
    } catch (err) {
      console.warn("[agentic-ai-infra] PostgresTrajectoryRecorder.record failed:", err);
    }
  }
}

/**
 * Returns a `TrajectoryRecorder` backed by Postgres when a database connection
 * is available, or an in-memory recorder when not.
 *
 * Use in `createRuntimeServiceContainer` to wire the recorder from the resolved
 * storage provider without requiring callers to know which implementation is active.
 *
 * @param db - Active `QueryableDatabase` for Postgres persistence, or `null`
 *   for the in-memory fallback.
 * @returns A `TrajectoryRecorder` implementation. Never `null`.
 *
 * @example
 * const recorder = createTrajectoryRecorder(storageProvider.db ?? null);
 */
export function createTrajectoryRecorder(db: QueryableDatabase | null): TrajectoryRecorder {
  return db !== null ? new PostgresTrajectoryRecorder(db) : new InMemoryTrajectoryRecorder();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Removes unsafe metadata keys before storing trajectory details.
 */
function sanitizeMetadata(
  metadata: Record<string, string | number | boolean | null> | undefined
): Record<string, string | number | boolean | null> | undefined {
  if (!metadata) {
    return undefined;
  }

  const safe: Record<string, string | number | boolean | null> = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (UNSAFE_METADATA_KEYS.has(key)) {
      continue;
    }

    safe[key] = value;
  }

  return safe;
}

/** Type guard used while building summaries. */
function isString(value: string | undefined): value is string {
  return typeof value === "string";
}

/** Returns stable unique values in first-seen order. */
function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

/**
 * Returns the first 64 chars of the SHA-256 hex digest of a JSON value.
 *
 * Used for `input_hash` and `output_hash` columns in `agentic_tool_calls`.
 * Non-reversible — only the hash is persisted, never raw input/output content.
 */
function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
