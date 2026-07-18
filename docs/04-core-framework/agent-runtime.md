# Agent Runtime

The agent runtime provides deterministic orchestration over framework contracts.

## Surfaces

- Single-agent executor: validates config, optionally consumes bounded context, selects a safe tool plan, and returns a structured result.
- Token-efficient multi-agent executor: builds shared context once, routes required roles, creates role slices, compresses role outputs, and synthesizes a bounded result.
- Harness runtime: enforces permission, approval, output, token, and trajectory policies around tool execution.

```txt
┌──────────────┐
│ Runtime Task │
└──────┬───────┘
       ▼
Agent mode?
├── single-agent
│   └── SingleAgentExecutor → AgentHarness → Structured result
└── token-efficient multi-agent
    └── TokenEfficientMultiAgentExecutor → Shared context packet → Routed role slices → Bounded synthesis → Structured result
```

## Data Safety

Runtime summaries use `taskHash`, `taskType`, labels, and risk flags. Raw task text can be used transiently for classification and retrieval, but it is not persisted by default.

## Determinism

Executors use local rules and heuristic token estimates. They do not call external models, networks, or provider SDKs.

---

## SessionManager

The `SessionManager` interface (defined in `core/src/session/types.ts`) tracks agent activity across sessions, threads, and tool calls.

### Factory

Use `createSessionManager(db)` from `runtime/src/session/index.ts`. Pass a `QueryableDatabase` to get `PostgresSessionManager`; pass `null` to get `InMemorySessionManager`. No `instanceof` checks needed:

```ts
import { createSessionManager } from "@maharudra/agentic-ai-infra-runtime";

const manager = createSessionManager(db ?? null);
// manager is SessionManager — callers do not need to know which impl
```

`createRuntimeServiceContainer` calls this automatically. You only need to call it directly in advanced hosting scenarios.

### What is stored

| Record | Table | Key fields |
| --- | --- | --- |
| `AgentSession` | `agentic_sessions` | `session_id`, `project_id`, `client`, `runtime_mode`, `status`, `started_at`, `last_seen_at`, `metadata` |
| `AgentThread` | `agentic_threads` | `thread_id`, `session_id`, `user_goal`, `active_task`, `state_summary`, `status` |
| `ThreadedToolCall` | `agentic_tool_calls` | `call_id`, `thread_id`, `tool_name`, `input_hash`, `output_hash`, `status`, `token_estimate` |

`input_hash` and `output_hash` are SHA-256 digests of `JSON.stringify(value)` — never raw content.

### Postgres vs InMemory selection

```txt
  storageProvider has .db getter? ──▶ PostgresSessionManager  (durable)
           no                    ──▶ InMemorySessionManager   (in-process, vectorless-local)
```

`PostgresSessionManager` persists records to migration 004 tables and makes them queryable by the dashboard. `InMemorySessionManager` stores records in Maps for the duration of the process — no database, no Docker, data lost on restart.

### Dashboard queryability

Both implementations expose the same `SessionManager` interface, so dashboard queries work identically against either backend. The Postgres backend provides durable cross-restart history; the in-memory backend provides single-process activity views.
