/**
 * trajectory.test.ts
 *
 * Unit tests for TrajectoryRecorder implementations:
 *   - createTrajectoryRecorder factory
 *   - PostgresTrajectoryRecorder (INSERT into agentic_tool_calls, non-fatal on DB error)
 *   - OTel observability sinks (NoopTraceSink, StderrTraceSink)
 *
 * No real database or OTel collector is required — all Postgres paths use a
 * mock QueryableDatabase stub that captures calls.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  InMemoryTrajectoryRecorder,
  PostgresTrajectoryRecorder,
  createTrajectoryRecorder
} from "../src/trajectory/index.js";
import {
  NoopTraceSink,
  StderrTraceSink
} from "../src/observability/index.js";
import type { QueryableDatabase } from "../src/storage/index.js";
import type { SafeTrajectoryEvent } from "@maharudra/agentic-ai-infra-core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockDb(queryFn?: () => Promise<{ rows: unknown[] }>): QueryableDatabase {
  return {
    query: vi.fn(queryFn ?? (() => Promise.resolve({ rows: [] })))
  };
}

const baseEvent: SafeTrajectoryEvent = {
  traceId: "trace-001",
  runId: "run-001",
  stepType: "single-agent-plan",
  toolName: "agentic.retrieval.search",
  status: "completed",
  durationMs: 0,
  taskHash: "abc123",
  taskType: "architecture",
  tokenEstimate: 120,
  threadId: "thread-abc"
};

// ---------------------------------------------------------------------------
// createTrajectoryRecorder factory
// ---------------------------------------------------------------------------

describe("createTrajectoryRecorder factory", () => {
  it("a. returns InMemoryTrajectoryRecorder when db is null", () => {
    const recorder = createTrajectoryRecorder(null);

    expect(recorder).toBeInstanceOf(InMemoryTrajectoryRecorder);
  });

  it("b. returns PostgresTrajectoryRecorder when db is a non-null QueryableDatabase", () => {
    const recorder = createTrajectoryRecorder(mockDb());

    expect(recorder).toBeInstanceOf(PostgresTrajectoryRecorder);
  });
});

// ---------------------------------------------------------------------------
// PostgresTrajectoryRecorder
// ---------------------------------------------------------------------------

describe("PostgresTrajectoryRecorder", () => {
  it("c. record() calls db.query with INSERT INTO agentic_tool_calls and passes thread_id", async () => {
    const db = mockDb();
    const recorder = new PostgresTrajectoryRecorder(db);

    await recorder.record(baseEvent);

    expect(db.query).toHaveBeenCalledOnce();

    const [sql, params] = (db.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];

    expect(sql).toMatch(/INSERT INTO agentic_tool_calls/i);
    // params[1] is thread_id (second positional — $2 after call_id)
    expect(params).toContain("thread-abc");
    // params[2] is tool_name
    expect(params).toContain("agentic.retrieval.search");
    // status is passed
    expect(params).toContain("completed");
    // token_estimate is passed
    expect(params).toContain(120);
  });

  it("d. record() does not throw when db.query rejects — emits console.warn only", async () => {
    const db: QueryableDatabase = {
      query: vi.fn().mockRejectedValue(new Error("DB connection lost"))
    };
    const recorder = new PostgresTrajectoryRecorder(db);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Should not throw.
    await expect(recorder.record(baseEvent)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("PostgresTrajectoryRecorder"),
      expect.any(Error)
    );

    warnSpy.mockRestore();
  });

  it("skips INSERT when event has no threadId", async () => {
    const db = mockDb();
    const recorder = new PostgresTrajectoryRecorder(db);
    const eventWithoutThread: SafeTrajectoryEvent = { ...baseEvent, threadId: undefined };

    await recorder.record(eventWithoutThread);

    // No query should have been attempted — thread_id is NOT NULL in schema.
    expect(db.query).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// InMemoryTrajectoryRecorder — TrajectoryRecorder interface
// ---------------------------------------------------------------------------

describe("InMemoryTrajectoryRecorder", () => {
  it("record() stores events accessible via list()", async () => {
    const recorder = new InMemoryTrajectoryRecorder();

    await recorder.record(baseEvent);

    const events = recorder.list();

    expect(events).toHaveLength(1);
    expect(events[0]?.traceId).toBe("trace-001");
    expect(events[0]?.status).toBe("completed");
  });

  it("recordStep() and record() both contribute to summary()", async () => {
    const recorder = new InMemoryTrajectoryRecorder();

    recorder.recordStep({ ...baseEvent, status: "denied", toolName: "tool-a" });
    await recorder.record({ ...baseEvent, toolName: "tool-b" });

    const summary = recorder.summary();

    expect(summary.totalSteps).toBe(2);
    expect(summary.deniedSteps).toBe(1);
    expect(summary.toolNames).toContain("tool-a");
    expect(summary.toolNames).toContain("tool-b");
  });
});

// ---------------------------------------------------------------------------
// OTel observability sinks
// ---------------------------------------------------------------------------

describe("NoopTraceSink", () => {
  it("e. startSpan() returns a Span that does nothing on end()", () => {
    const sink = new NoopTraceSink();
    const span = sink.startSpan("test-span", { key: "val" });

    // setAttribute and end must not throw.
    expect(() => span.setAttribute("x", 1)).not.toThrow();
    expect(() => span.end()).not.toThrow();
  });
});

describe("StderrTraceSink", () => {
  it("f. startSpan().end() writes to stderr", () => {
    const sink = new StderrTraceSink();
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const span = sink.startSpan("retrieval.retrieve", { query: "test" });

    span.setAttribute("resultCount", 3);
    span.end();

    expect(stderrSpy).toHaveBeenCalledOnce();
    const written = stderrSpy.mock.calls[0]?.[0] as string;

    expect(written).toContain("retrieval.retrieve");
    expect(written).toContain("durationMs");

    stderrSpy.mockRestore();
  });
});
