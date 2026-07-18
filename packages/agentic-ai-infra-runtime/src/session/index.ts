import { randomUUID, createHash } from "node:crypto";
import {
  fail,
  ok,
  type AgentSession,
  type AgentThread,
  type CreateSessionParams,
  type FrameworkResult,
  type SessionManager,
  type ThreadedToolCall
} from "@maharudra/agentic-ai-infra-core";
import type { QueryableDatabase } from "../storage/index.js";

// ---------------------------------------------------------------------------
// PostgresSessionManager
// ---------------------------------------------------------------------------

/**
 * Postgres-backed session and thread lifecycle manager.
 *
 * Persists session, thread, and tool-call records to the tables created by
 * migration 004 (`agentic_sessions`, `agentic_threads`, `agentic_tool_calls`).
 * All SQL is parameterized — no string interpolation, no raw user input in SQL.
 *
 * Use `createSessionManager(db)` to construct; do not instantiate directly
 * in callers unless you have a `QueryableDatabase` to inject.
 *
 * @example
 * const db: QueryableDatabase = ...; // injected from PostgresStorageProvider
 * const manager = new PostgresSessionManager(db);
 * const session = await manager.createSession({ projectId, client, runtimeMode });
 */
export class PostgresSessionManager implements SessionManager {
  /**
   * Creates a Postgres session manager with an injected query adapter.
   *
   * The caller is responsible for supplying a correctly configured
   * `QueryableDatabase`. The manager does not create or own pools.
   */
  constructor(private readonly db: QueryableDatabase) {}

  /**
   * Inserts a new session row and returns the stored record.
   *
   * Generates a stable UUID as `session_id`. The initial status is "active".
   * `started_at` and `last_seen_at` are both set to NOW() in the DB so the
   * timestamps reflect actual server time rather than client clock skew.
   *
   * @param params - Project identity, client label, runtime mode, and metadata.
   * @returns The inserted `AgentSession` or a `session.create-failed` error.
   */
  async createSession(params: CreateSessionParams): Promise<FrameworkResult<AgentSession>> {
    try {
      const sessionId = randomUUID();
      const metadata = params.metadata ?? {};
      const result = await this.db.query<{
        session_id: string;
        project_id: string;
        client: string;
        runtime_mode: string;
        status: string;
        started_at: string;
        last_seen_at: string;
        metadata: Record<string, string>;
      }>(
        `INSERT INTO agentic_sessions
           (session_id, project_id, client, runtime_mode, status, started_at, last_seen_at, metadata)
         VALUES ($1, $2, $3, $4, 'active', NOW(), NOW(), $5)
         RETURNING *`,
        [sessionId, params.projectId, params.client, params.runtimeMode, JSON.stringify(metadata)]
      );

      const row = result.rows[0];

      if (!row) {
        return fail({ code: "session.create-failed", message: "INSERT returned no row.", severity: "recoverable" });
      }

      return ok(rowToSession(row));
    } catch (cause) {
      return fail({ code: "session.create-failed", message: "Failed to create session in Postgres.", severity: "recoverable", cause });
    }
  }

  /**
   * Returns an existing session (bumping `last_seen_at`) or creates a new one.
   *
   * Looks up `sessionId` by primary key first. If found and not closed, updates
   * `last_seen_at` and returns the record. If not found, delegates to
   * `createSession(params)`. Closed sessions are treated as not-found so a
   * re-run after explicit close always gets a fresh session.
   *
   * @param sessionId - The id to look up.
   * @param params - Fallback params used when the session does not exist.
   * @returns The resumed or newly created session.
   */
  async resumeOrCreateSession(
    sessionId: string,
    params: CreateSessionParams
  ): Promise<FrameworkResult<AgentSession>> {
    try {
      const found = await this.db.query<{
        session_id: string;
        project_id: string;
        client: string;
        runtime_mode: string;
        status: string;
        started_at: string;
        last_seen_at: string;
        metadata: Record<string, string>;
      }>(
        `UPDATE agentic_sessions
         SET last_seen_at = NOW()
         WHERE session_id = $1 AND status != 'closed'
         RETURNING *`,
        [sessionId]
      );

      if (found.rows[0]) {
        return ok(rowToSession(found.rows[0]));
      }

      return this.createSession(params);
    } catch (cause) {
      return fail({ code: "session.create-failed", message: "Failed to resume or create session.", severity: "recoverable", cause });
    }
  }

  /**
   * Updates `last_seen_at` to now without changing any other field.
   *
   * Call after each successful `execute()` to keep the session alive in the
   * dashboard activity view.
   *
   * @param sessionId - The session to touch.
   * @returns `ok(undefined)` or `session.not-found` if no row was updated.
   */
  async touchSession(sessionId: string): Promise<FrameworkResult<void>> {
    try {
      const result = await this.db.query(
        `UPDATE agentic_sessions SET last_seen_at = NOW() WHERE session_id = $1`,
        [sessionId]
      );
      // pg returns rowCount on UPDATE; no rows updated means session missing.
      const updated = (result as unknown as { rowCount?: number }).rowCount ?? (result.rows.length > 0 ? 1 : 0);

      if (updated === 0) {
        return fail({ code: "session.not-found", message: `Session ${sessionId} not found.`, severity: "recoverable" });
      }

      return ok(undefined);
    } catch (cause) {
      return fail({ code: "session.not-found", message: "touchSession failed.", severity: "recoverable", cause });
    }
  }

  /**
   * Sets `status = 'closed'` for the given session.
   *
   * Closed sessions remain queryable by the dashboard but should not receive
   * new tool call records.
   *
   * @param sessionId - The session to close.
   * @returns `ok(undefined)` or `session.not-found` if no row was updated.
   */
  async closeSession(sessionId: string): Promise<FrameworkResult<void>> {
    try {
      const result = await this.db.query(
        `UPDATE agentic_sessions SET status = 'closed' WHERE session_id = $1`,
        [sessionId]
      );
      const updated = (result as unknown as { rowCount?: number }).rowCount ?? (result.rows.length > 0 ? 1 : 0);

      if (updated === 0) {
        return fail({ code: "session.not-found", message: `Session ${sessionId} not found.`, severity: "recoverable" });
      }

      return ok(undefined);
    } catch (cause) {
      return fail({ code: "session.not-found", message: "closeSession failed.", severity: "recoverable", cause });
    }
  }

  /**
   * Inserts a new thread row linked to the given session.
   *
   * The initial status is "open". `created_at` and `updated_at` are set to
   * NOW(). If the session does not exist the FK constraint causes the INSERT to
   * fail, which surfaces as `session.thread-open-failed`.
   *
   * @param sessionId - The parent session.
   * @param userGoal - Safe metadata label; callers must not pass raw task text.
   * @returns The inserted `AgentThread` or a `session.thread-open-failed` error.
   */
  async openThread(sessionId: string, userGoal: string): Promise<FrameworkResult<AgentThread>> {
    try {
      const threadId = randomUUID();
      const result = await this.db.query<{
        thread_id: string;
        session_id: string;
        user_goal: string;
        active_task: string | null;
        state_summary: string | null;
        status: string;
        created_at: string;
        updated_at: string;
      }>(
        `INSERT INTO agentic_threads
           (thread_id, session_id, user_goal, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'open', NOW(), NOW())
         RETURNING *`,
        [threadId, sessionId, userGoal]
      );

      const row = result.rows[0];

      if (!row) {
        return fail({ code: "session.thread-open-failed", message: "INSERT returned no thread row.", severity: "recoverable" });
      }

      return ok(rowToThread(row));
    } catch (cause) {
      return fail({ code: "session.thread-open-failed", message: "Failed to open thread in Postgres.", severity: "recoverable", cause });
    }
  }

  /**
   * Partially updates a thread row.
   *
   * Builds a SET clause from the provided fields and always includes
   * `updated_at = NOW()`. Only the keys present in `update` are written;
   * absent keys keep their existing values.
   *
   * @param threadId - The thread to update.
   * @param update - Subset of mutable fields.
   * @returns `ok(undefined)` or `session.not-found` if no row was updated.
   */
  async updateThread(
    threadId: string,
    update: Partial<Pick<AgentThread, "activeTask" | "stateSummary" | "status">>
  ): Promise<FrameworkResult<void>> {
    try {
      const sets: string[] = ["updated_at = NOW()"];
      const values: unknown[] = [];
      let idx = 1;

      if (update.activeTask !== undefined) {
        sets.push(`active_task = $${idx++}`);
        values.push(update.activeTask);
      }

      if (update.stateSummary !== undefined) {
        sets.push(`state_summary = $${idx++}`);
        values.push(update.stateSummary);
      }

      if (update.status !== undefined) {
        sets.push(`status = $${idx++}`);
        values.push(update.status);
      }

      values.push(threadId);

      const result = await this.db.query(
        `UPDATE agentic_threads SET ${sets.join(", ")} WHERE thread_id = $${idx}`,
        values
      );
      const updated = (result as unknown as { rowCount?: number }).rowCount ?? (result.rows.length > 0 ? 1 : 0);

      if (updated === 0) {
        return fail({ code: "session.not-found", message: `Thread ${threadId} not found.`, severity: "recoverable" });
      }

      return ok(undefined);
    } catch (cause) {
      return fail({ code: "session.not-found", message: "updateThread failed.", severity: "recoverable", cause });
    }
  }

  /**
   * Inserts one tool call record and returns it with `callId` set.
   *
   * Generates a new UUID as `call_id`. All value parameters are passed
   * separately to the driver — no string interpolation of user-supplied
   * content in SQL.
   *
   * @param call - All `ThreadedToolCall` fields except `callId`.
   * @returns The stored record including the generated `callId`, or a
   *   `session.tool-call-record-failed` error.
   */
  async recordToolCall(
    call: Omit<ThreadedToolCall, "callId">
  ): Promise<FrameworkResult<ThreadedToolCall>> {
    try {
      const callId = randomUUID();
      await this.db.query(
        `INSERT INTO agentic_tool_calls
           (call_id, thread_id, tool_name, input_hash, output_hash, status,
            started_at, completed_at, error_code, token_estimate)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          callId,
          call.threadId,
          call.toolName,
          call.inputHash,
          call.outputHash ?? null,
          call.status,
          call.startedAt,
          call.completedAt ?? null,
          call.errorCode ?? null,
          call.tokenEstimate ?? null
        ]
      );

      return ok({ ...call, callId });
    } catch (cause) {
      return fail({ code: "session.tool-call-record-failed", message: "Failed to record tool call.", severity: "recoverable", cause });
    }
  }
}

// ---------------------------------------------------------------------------
// InMemorySessionManager
// ---------------------------------------------------------------------------

/**
 * In-memory session and thread lifecycle manager.
 *
 * Stores all data in Maps. No I/O, no DB, no migrations needed.
 * Data is lost when the process exits — suitable for `vectorless-local`
 * and other short-lived or test profiles. The dashboard can still read
 * in-process session data during the same run.
 *
 * Use `createSessionManager(null)` to get this implementation automatically
 * when no `QueryableDatabase` is available.
 *
 * @example
 * const manager = new InMemorySessionManager();
 * const session = await manager.createSession({ projectId, client, runtimeMode });
 */
export class InMemorySessionManager implements SessionManager {
  private readonly sessions = new Map<string, AgentSession>();
  private readonly threads = new Map<string, AgentThread>();
  private readonly toolCalls = new Map<string, ThreadedToolCall>();

  /**
   * Creates a new session in the in-memory store.
   *
   * IDs are generated via `crypto.randomUUID()`. All timestamps are `new Date()`.
   * Data is never persisted beyond the current process lifecycle.
   */
  async createSession(params: CreateSessionParams): Promise<FrameworkResult<AgentSession>> {
    const sessionId = randomUUID();
    const now = new Date();
    const session: AgentSession = {
      sessionId,
      projectId: params.projectId,
      client: params.client,
      runtimeMode: params.runtimeMode,
      status: "active",
      startedAt: now,
      lastSeenAt: now,
      metadata: params.metadata ?? {}
    };

    this.sessions.set(sessionId, session);

    return ok(session);
  }

  /**
   * Returns an existing session (with updated `lastSeenAt`) or creates a new one.
   *
   * Checks `this.sessions` first. If found, returns a copy with `lastSeenAt`
   * bumped to now. If not found, delegates to `createSession`.
   *
   * @param sessionId - The id to look up.
   * @param params - Fallback params for a new session if not found.
   */
  async resumeOrCreateSession(
    sessionId: string,
    params: CreateSessionParams
  ): Promise<FrameworkResult<AgentSession>> {
    const existing = this.sessions.get(sessionId);

    if (existing && existing.status !== "closed") {
      const updated: AgentSession = { ...existing, lastSeenAt: new Date() };

      this.sessions.set(sessionId, updated);

      return ok(updated);
    }

    return this.createSession(params);
  }

  /**
   * Updates `lastSeenAt` to now.
   *
   * Returns `session.not-found` if the session is absent from the Map.
   */
  async touchSession(sessionId: string): Promise<FrameworkResult<void>> {
    const existing = this.sessions.get(sessionId);

    if (!existing) {
      return fail({ code: "session.not-found", message: `Session ${sessionId} not found.`, severity: "recoverable" });
    }

    this.sessions.set(sessionId, { ...existing, lastSeenAt: new Date() });

    return ok(undefined);
  }

  /**
   * Sets `status` to "closed".
   *
   * Returns `session.not-found` if the session is absent from the Map.
   */
  async closeSession(sessionId: string): Promise<FrameworkResult<void>> {
    const existing = this.sessions.get(sessionId);

    if (!existing) {
      return fail({ code: "session.not-found", message: `Session ${sessionId} not found.`, severity: "recoverable" });
    }

    this.sessions.set(sessionId, { ...existing, status: "closed" });

    return ok(undefined);
  }

  /**
   * Creates a new thread linked to the session.
   *
   * Does not validate that the session exists. In-memory usage assumes the
   * caller coordinates session creation before calling `openThread`.
   */
  async openThread(sessionId: string, userGoal: string): Promise<FrameworkResult<AgentThread>> {
    const threadId = randomUUID();
    const now = new Date();
    const thread: AgentThread = {
      threadId,
      sessionId,
      userGoal,
      activeTask: undefined,
      stateSummary: undefined,
      status: "open",
      createdAt: now,
      updatedAt: now
    };

    this.threads.set(threadId, thread);

    return ok(thread);
  }

  /**
   * Applies a partial update to an existing thread.
   *
   * Merges only the non-undefined fields from `update` into the stored record
   * and sets `updatedAt` to now.
   *
   * Returns `session.not-found` if `threadId` is absent from the Map.
   */
  async updateThread(
    threadId: string,
    update: Partial<Pick<AgentThread, "activeTask" | "stateSummary" | "status">>
  ): Promise<FrameworkResult<void>> {
    const existing = this.threads.get(threadId);

    if (!existing) {
      return fail({ code: "session.not-found", message: `Thread ${threadId} not found.`, severity: "recoverable" });
    }

    const updated: AgentThread = {
      ...existing,
      ...(update.activeTask !== undefined ? { activeTask: update.activeTask } : {}),
      ...(update.stateSummary !== undefined ? { stateSummary: update.stateSummary } : {}),
      ...(update.status !== undefined ? { status: update.status } : {}),
      updatedAt: new Date()
    };

    this.threads.set(threadId, updated);

    return ok(undefined);
  }

  /**
   * Records a tool call with a generated `callId`.
   *
   * The call is stored in the `toolCalls` Map keyed by `callId`.
   * Useful for in-process observability without a database.
   */
  async recordToolCall(
    call: Omit<ThreadedToolCall, "callId">
  ): Promise<FrameworkResult<ThreadedToolCall>> {
    const callId = randomUUID();
    const stored: ThreadedToolCall = { ...call, callId };

    this.toolCalls.set(callId, stored);

    return ok(stored);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates the appropriate `SessionManager` based on whether a database
 * connection is available.
 *
 * This factory keeps callers free of `instanceof` checks. The selection is
 * purely duck-typed: if `db` is a non-null `QueryableDatabase`, the caller
 * gets a Postgres-backed manager; if `db` is `null`, the caller gets an
 * in-memory manager.
 *
 * Usage in `createRuntimeServiceContainer`:
 * - `PostgresStorageProvider` exposes an optional `db` getter. When it returns
 *   a non-null value, the factory creates `PostgresSessionManager`.
 * - `InMemoryStorageProvider` has no `db` field, so the duck-type check in the
 *   container resolves to `null` and the factory creates `InMemorySessionManager`
 *   automatically — without any special-casing for the vectorless-local profile.
 *
 * @param db - A `QueryableDatabase` for Postgres persistence, or `null` for
 *   the in-memory fallback.
 * @returns A `SessionManager` implementation. Never `null`.
 *
 * @example
 * const manager = createSessionManager(null);              // InMemorySessionManager
 * const pgManager = createSessionManager(postgresDb);      // PostgresSessionManager
 */
export function createSessionManager(db: QueryableDatabase | null): SessionManager {
  if (db !== null) {
    return new PostgresSessionManager(db);
  }

  return new InMemorySessionManager();
}

// ---------------------------------------------------------------------------
// Row-to-domain helpers (Postgres only)
// ---------------------------------------------------------------------------

function rowToSession(row: {
  session_id: string;
  project_id: string;
  client: string;
  runtime_mode: string;
  status: string;
  started_at: string;
  last_seen_at: string;
  metadata: Record<string, string> | string;
}): AgentSession {
  let metadata: Record<string, string>;

  try {
    metadata = typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata ?? {};
  } catch {
    metadata = {};
  }

  return {
    sessionId: row.session_id,
    projectId: row.project_id,
    client: row.client,
    runtimeMode: row.runtime_mode as AgentSession["runtimeMode"],
    status: row.status as AgentSession["status"],
    startedAt: new Date(row.started_at),
    lastSeenAt: new Date(row.last_seen_at),
    metadata
  };
}

function rowToThread(row: {
  thread_id: string;
  session_id: string;
  user_goal: string;
  active_task: string | null;
  state_summary: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}): AgentThread {
  return {
    threadId: row.thread_id,
    sessionId: row.session_id,
    userGoal: row.user_goal,
    activeTask: row.active_task ?? undefined,
    stateSummary: row.state_summary ?? undefined,
    status: row.status as AgentThread["status"],
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}

// Export the SHA-256 helper so agents.ts can use it without re-importing createHash.
/**
 * Returns the SHA-256 hex digest of an arbitrary value serialized with
 * `JSON.stringify`. Used to hash tool inputs and outputs before storage.
 *
 * Guaranteed to be the same for equal JSON-serializable structures.
 *
 * @param value - Any JSON-serializable value.
 * @returns 64-character lowercase hex string.
 */
export function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
