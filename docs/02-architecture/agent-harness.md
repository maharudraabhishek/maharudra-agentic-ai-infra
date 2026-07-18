# Agent Harness Architecture

The agent harness is the runtime boundary between adapters and executable tools.

```txt
┌───────────────────┐
│ Client Or Adapter │
└─────────┬─────────┘
          │ delegates tool execution to
          ▼
┌───────────────────┐
│ AgentHarness      │
└─────────┬─────────┘
          ├── enforces Runtime mode policy
          ├── enforces Role permission policy
          ├── checks Exact approval policy
          ├── executes Tool handler
          ├── applies Output sanitizer
          └── records Safe token and trajectory metadata
```

## Runtime Flow

Runtime adapters register tool metadata only after config validation. Tool calls then pass through `AgentHarness`, which checks the selected runtime mode, role permissions, approval requirements, and output policy before returning a `FrameworkResult`.

```txt
┌─────────────────┐  ┌──────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐  ┌──────────────────┐
│ Runtime Adapter │  │ AgentHarness │  │ Permission Gate │  │ Approval Policy │  │ Tool Handler │  │ Output Sanitizer │
└────────┬────────┘  └──────┬───────┘  └────────┬────────┘  └────────┬────────┘  └──────┬───────┘  └────────┬─────────┘
         │ execute request  │                   │                    │                  │                   │
         │─────────────────▶│                   │                    │                  │                   │
         │                  │ check mode/role   │                    │                  │                   │
         │                  │──────────────────▶│                    │                  │                   │
         │                  │ allow or deny     │                    │                  │                   │
         │                  │◀──────────────────│                    │                  │                   │
         │                  │ check approval if required             │                  │                   │
         │                  │───────────────────────────────────────▶│                  │                   │
         │                  │ allow or deny                          │                  │                   │
         │                  │◀───────────────────────────────────────│                  │                   │
         │                  │ run approved handler                   │                  │                   │
         │                  │──────────────────────────────────────────────────────────▶│                   │
         │                  │ tool result                            │                  │                   │
         │                  │◀──────────────────────────────────────────────────────────│                   │
         │                  │ sanitize output                        │                  │                   │
         │                  │──────────────────────────────────────────────────────────────────────────────▶│
         │                  │ safe FrameworkResult                   │                  │                   │
         │                  │◀──────────────────────────────────────────────────────────────────────────────│
```

## Safe Records

The harness stores only safe metadata: trace id, run id, role, step type, tool name, status, duration, source counts, token estimates, error code, `taskHash`, and `taskType`.

It does not store raw task text, approval text, secrets, full chunks, vectors, raw SQL, stack traces, command output, or raw local paths in remote-safe mode.

## Adapter Boundary

Imports remain side-effect free. Adapters prepare local STDIO MCP, remote MCP, or API surfaces only from explicit start functions.

---

## Session and Thread Lifecycle

Every `execute()` call opens or resumes a session and opens one thread. Tool call records are written inside the thread. On completion the thread is closed and the session is touched to keep it alive in the dashboard.

```txt
execute()
  │
  ├── resumeOrCreateSession(sessionId, params)
  │     └─ found?  ── UPDATE last_seen_at, return session
  │         no?   ── INSERT new session, return session
  │
  ├── openThread(sessionId, userGoal)
  │     └─ INSERT new thread, return thread
  │
  ├── [tool selections / deterministic plan]
  │     └── recordToolCall(threadId, toolName, inputHash, outputHash, ...)
  │
  ├── on success ──▶ updateThread(threadId, { status: "completed", stateSummary })
  │                  touchSession(sessionId)
  │
  └── on failure ──▶ updateThread(threadId, { status: "failed" })
```

**Non-fatal design:** session and thread failures never abort the agent run. Each session operation is wrapped in `try/catch`; failures emit a `warn` event to the `RuntimeObservabilitySink` and execution continues. The agent result is always returned regardless of session tracking state.

**Session persistence:** `createRuntimeServiceContainer` selects the session manager automatically:
- `PostgresStorageProvider` with injected `QueryableDatabase` → `PostgresSessionManager` (durable, dashboard-queryable)
- `InMemoryStorageProvider` or no db → `InMemorySessionManager` (in-process, lost on restart)

**Thread sharing in multi-agent mode:** `TokenEfficientMultiAgentExecutor` opens ONE session and ONE thread for the entire multi-agent run. Sub-agents receive the same `sessionId` so the dashboard groups all sub-agent activity under one timeline entry instead of creating separate top-level sessions.
