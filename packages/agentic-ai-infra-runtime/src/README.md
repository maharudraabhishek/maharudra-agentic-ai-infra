# Runtime Source Map

This source tree contains the concrete framework behavior that depends on runtime, database, retrieval, and observability implementation details.

```txt
Runtime entrypoint
├── runtime/
├── tools/
├── storage/
├── retrieval/
├── context/
├── harness/
├── agents/
├── token/
├── trajectory/
├── evals/
├── dashboard/
├── cache/
├── observability/
├── internal/
└── errors/
```

## Module Responsibilities

- `runtime/`: adapter classes and explicit start functions for local STDIO MCP, remote HTTP MCP, and API service surfaces.
- `tools/`: framework-level tool contracts, runtime filtering, and output safety checks.
- `storage/`: Postgres provider, migration discovery, exact-approval migration runner, and framework migration definitions.
- `retrieval/`: deterministic provider implementations and the retrieval router.
- `context/`: context optimizer and context builder.
- `harness/`: central tool execution boundary with permission, approval, sanitization, token recording, and trajectory recording.
- `agents/`: deterministic single-agent and token-efficient multi-agent executors.
- `token/`: heuristic token counter, budget manager, and safe token usage recorder.
- `trajectory/`: safe in-memory trajectory recorder and summaries.
- `evals/`: deterministic framework-level eval helpers.
- `dashboard/`: safe dashboard data provider for runtime summaries.
- `cache/`: cache key, in-memory cache, and freshness helpers.
- `observability/`: runtime log sinks that avoid STDIO protocol corruption.
- `internal/`: package-private membership and safe correlation-value guards.
- `errors/`: typed runtime failure helpers.

## Execution Flow

```txt
┌────────────────────┐
│ generated start.ts │
└─────────┬──────────┘
          ▼
┌──────────────────────────────────────────────────┐
│ startLocalRuntime / startRemoteRuntime /         │
│ startApiService                                  │
└─────────┬────────────────────────────────────────┘
          ▼
┌───────────────────────────────┐
│ createRuntimeServiceContainer │
└─────────┬─────────────────────┘
          ▼
┌───────────────────────┐
│ Adapter Policy Checks │
└─────────┬─────────────┘
          ▼
┌─────────────────────────────────────────┐
│ Tool Filtering + AgentHarness +         │
│ MCP Metadata                            │
└─────────┬───────────────────────────────┘
          ▼
┌───────────────────────┐
│ RuntimeHandle         │
└───────────────────────┘
```
