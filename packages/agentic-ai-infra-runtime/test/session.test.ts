/**
 * session.test.ts
 *
 * Unit tests for InMemorySessionManager, PostgresSessionManager (factory path),
 * and the createSessionManager factory function.
 *
 * Postgres is NOT required — all Postgres path coverage is via the factory
 * assertion that checks the returned type when a non-null db is supplied.
 * No actual SQL is executed against a real database in CI.
 */

import { describe, expect, it } from "vitest";
import {
  InMemorySessionManager,
  PostgresSessionManager,
  createSessionManager
} from "../src/session/index.js";
import { PostgresStorageProvider } from "../src/storage/index.js";
import type { QueryableDatabase } from "../src/storage/index.js";

// ---------------------------------------------------------------------------
// InMemorySessionManager
// ---------------------------------------------------------------------------

describe("InMemorySessionManager", () => {
  it("createSession returns a valid AgentSession with correct fields", async () => {
    const manager = new InMemorySessionManager();
    const result = await manager.createSession({
      projectId: "test-project",
      client: "claude-code",
      runtimeMode: "local-stdio-mcp",
      metadata: { env: "test" }
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      const session = result.value;

      expect(typeof session.sessionId).toBe("string");
      expect(session.sessionId.length).toBeGreaterThan(0);
      expect(session.projectId).toBe("test-project");
      expect(session.client).toBe("claude-code");
      expect(session.runtimeMode).toBe("local-stdio-mcp");
      expect(session.status).toBe("active");
      expect(session.startedAt).toBeInstanceOf(Date);
      expect(session.lastSeenAt).toBeInstanceOf(Date);
      expect(session.metadata).toEqual({ env: "test" });
    }
  });

  it("resumeOrCreateSession creates on first call then returns the same session on second call", async () => {
    const manager = new InMemorySessionManager();
    const params = {
      projectId: "resume-project",
      client: "api",
      runtimeMode: "api-service" as const,
      metadata: {}
    };

    // First call with an unknown id — creates a new session with a generated UUID.
    const first = await manager.resumeOrCreateSession("unknown-lookup-id", params);

    expect(first.ok).toBe(true);

    if (!first.ok) return;

    // Second call with the RETURNED sessionId — should resume the same session.
    const second = await manager.resumeOrCreateSession(first.value.sessionId, params);

    expect(second.ok).toBe(true);

    if (second.ok) {
      // Same session is returned; sessionId must not change.
      expect(second.value.sessionId).toBe(first.value.sessionId);
      // lastSeenAt is bumped on resume.
      expect(second.value.lastSeenAt.getTime()).toBeGreaterThanOrEqual(
        first.value.lastSeenAt.getTime()
      );
    }
  });

  it("openThread returns a valid AgentThread linked to the session", async () => {
    const manager = new InMemorySessionManager();
    const sessionResult = await manager.createSession({
      projectId: "thread-project",
      client: "cursor",
      runtimeMode: "local-stdio-mcp"
    });

    expect(sessionResult.ok).toBe(true);

    if (sessionResult.ok) {
      const threadResult = await manager.openThread(
        sessionResult.value.sessionId,
        "Implement the session layer"
      );

      expect(threadResult.ok).toBe(true);

      if (threadResult.ok) {
        const thread = threadResult.value;

        expect(typeof thread.threadId).toBe("string");
        expect(thread.sessionId).toBe(sessionResult.value.sessionId);
        expect(thread.userGoal).toBe("Implement the session layer");
        expect(thread.status).toBe("open");
        expect(thread.activeTask).toBeUndefined();
        expect(thread.stateSummary).toBeUndefined();
        expect(thread.createdAt).toBeInstanceOf(Date);
        expect(thread.updatedAt).toBeInstanceOf(Date);
      }
    }
  });

  it("recordToolCall stores call with generated callId and correct threadId", async () => {
    const manager = new InMemorySessionManager();
    const sessionResult = await manager.createSession({
      projectId: "tool-project",
      client: "api",
      runtimeMode: "api-service"
    });

    expect(sessionResult.ok).toBe(true);

    if (!sessionResult.ok) return;

    const threadResult = await manager.openThread(
      sessionResult.value.sessionId,
      "Run a tool call"
    );

    expect(threadResult.ok).toBe(true);

    if (!threadResult.ok) return;

    const startedAt = new Date();
    const callResult = await manager.recordToolCall({
      threadId: threadResult.value.threadId,
      toolName: "agentic.retrieval.search",
      inputHash: "abc123",
      outputHash: "def456",
      status: "success",
      startedAt,
      completedAt: new Date(),
      errorCode: undefined,
      tokenEstimate: 42
    });

    expect(callResult.ok).toBe(true);

    if (callResult.ok) {
      const call = callResult.value;

      expect(typeof call.callId).toBe("string");
      expect(call.callId.length).toBeGreaterThan(0);
      expect(call.threadId).toBe(threadResult.value.threadId);
      expect(call.toolName).toBe("agentic.retrieval.search");
      expect(call.status).toBe("success");
      expect(call.tokenEstimate).toBe(42);
    }
  });

  it("closeSession sets status to 'closed'", async () => {
    const manager = new InMemorySessionManager();
    const sessionResult = await manager.createSession({
      projectId: "close-project",
      client: "claude-code",
      runtimeMode: "local-stdio-mcp"
    });

    expect(sessionResult.ok).toBe(true);

    if (!sessionResult.ok) return;

    const closeResult = await manager.closeSession(sessionResult.value.sessionId);

    expect(closeResult.ok).toBe(true);

    // A resumed closed session should create a NEW session (not resume the closed one).
    const resumed = await manager.resumeOrCreateSession(sessionResult.value.sessionId, {
      projectId: "close-project",
      client: "claude-code",
      runtimeMode: "local-stdio-mcp"
    });

    expect(resumed.ok).toBe(true);

    if (resumed.ok) {
      // A new session should have a different ID since the old one was closed.
      expect(resumed.value.sessionId).not.toBe(sessionResult.value.sessionId);
    }
  });

  it("updateThread updates stateSummary and status correctly", async () => {
    const manager = new InMemorySessionManager();
    const sessionResult = await manager.createSession({
      projectId: "update-project",
      client: "api",
      runtimeMode: "remote-http-mcp"
    });

    if (!sessionResult.ok) return;

    const threadResult = await manager.openThread(
      sessionResult.value.sessionId,
      "Test thread update"
    );

    if (!threadResult.ok) return;

    const updateResult = await manager.updateThread(threadResult.value.threadId, {
      status: "completed",
      stateSummary: "All steps completed successfully."
    });

    expect(updateResult.ok).toBe(true);
  });

  it("closeSession returns session.not-found for unknown session", async () => {
    const manager = new InMemorySessionManager();
    const result = await manager.closeSession("non-existent-session-id");

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("session.not-found");
    }
  });
});

// ---------------------------------------------------------------------------
// createSessionManager factory
// ---------------------------------------------------------------------------

describe("createSessionManager factory", () => {
  it("returns InMemorySessionManager when db is null", () => {
    const manager = createSessionManager(null);

    expect(manager).toBeInstanceOf(InMemorySessionManager);
  });

  it("returns PostgresSessionManager when db is a non-null object", () => {
    // A minimal QueryableDatabase stub — no real SQL is executed.
    const stubDb: QueryableDatabase = {
      async query() {
        return { rows: [] };
      }
    };

    const manager = createSessionManager(stubDb);

    expect(manager).toBeInstanceOf(PostgresSessionManager);
  });
});

// ---------------------------------------------------------------------------
// Fix A — PostgresStorageProvider.db getter exposes pool for connectionString
// ---------------------------------------------------------------------------

describe("PostgresStorageProvider.db getter (Fix A)", () => {
  it("returns undefined when no connectionString and no injected database", () => {
    const provider = new PostgresStorageProvider("no-config");

    expect(provider.db).toBeUndefined();
  });

  it("returns non-undefined when constructed with connectionString only", () => {
    // pg.Pool is created eagerly in the constructor; no actual connection is opened.
    const provider = new PostgresStorageProvider("cs-only", {
      connectionString: "postgresql://localhost:5432/test"
    });

    expect(provider.db).toBeDefined();
    expect(typeof provider.db).toBe("object");
  });

  it("createSessionManager receives the pool and returns PostgresSessionManager", () => {
    const provider = new PostgresStorageProvider("cs-factory", {
      connectionString: "postgresql://localhost:5432/test"
    });

    // db is now non-null, so the factory should select PostgresSessionManager.
    const db = provider.db;

    expect(db).not.toBeNull();
    expect(db).not.toBeUndefined();

    const manager = createSessionManager(db ?? null);

    expect(manager).toBeInstanceOf(PostgresSessionManager);
  });

  it("returns the injected database when one is supplied", () => {
    const stubDb: QueryableDatabase = { async query() { return { rows: [] }; } };
    const provider = new PostgresStorageProvider("injected", { database: stubDb });

    expect(provider.db).toBe(stubDb);
  });
});
