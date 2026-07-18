# MahaRudra Agentic AI Infra Runtime

This private workspace package contains the runtime adapter, storage, retrieval, context, cache, and observability implementations for the framework.

The package is intentionally explicit about startup. Importing it does not start MCP transports, HTTP services, database connections, Docker, migrations, or indexing. Generated projects call explicit start functions from entrypoints they control.

## Surfaces

- Local STDIO MCP adapter for local developer workflows.
- Remote-safe MCP/API adapter surface with fail-closed auth, audit, and rate-limit policy checks.
- Storage and migration status helpers with explicit migration approval.
- Retrieval providers, router, context builder, and cache/freshness helpers with bounded outputs.
- Agent orchestration with supervisor routing, guard/feedback seams, and aggregate reports.

## Module Map

```txt
src/index.ts
├── orchestrator/: supervisor policies and bounded agent-run composition
├── runtime/: adapters and start functions
├── tools/: contracts and output guards
├── storage/: Postgres and migrations
├── retrieval/: providers and router
├── context/: optimizer and builder
├── cache/: key and freshness helpers
├── observability/: log sinks
└── errors/: typed failures
```

## Main Classes And Functions

- `LocalStdioMcpRuntimeAdapter`, `RemoteHttpMcpRuntimeAdapter`, and `ApiServiceRuntimeAdapter` prepare runtime surfaces after policy checks.
- `createRuntimeServiceContainer` composes config, tools, observability, guards, feedback, and the auto-wired `AgentOrchestrator` without startup side effects.
- `PostgresStorageProvider` performs health checks, migration status discovery, and exact-approval migration execution.
- `FullTextProvider`, `PgVectorProvider`, `DocumentTreeProvider`, `PageIndexProvider`, `SymbolCodeProvider`, and `GraphProvider` provide deterministic retrieval foundations.
- `RetrievalRouter` classifies queries and merges safe bounded results.
- `ContextOptimizer` and `ContextBuilder` produce budgeted context packages with source warnings.
- `buildCacheKey`, `InMemoryRuntimeCache`, and `evaluateFreshness` support cache/freshness decisions.
- `DefaultSupervisorPolicy` and `AgentOrchestrator` select an explicit agent route, compose one or more bounded sub-runs, and return an aggregate report without starting a runtime service.

## Orchestrator Composition

`AgentOrchestrator` is the Layer 10 composition boundary for an already
constructed runtime. `createRuntimeServiceContainer()` now returns it as a
non-optional slot, wired from the container's registry, executors, content guard,
feedback hook, token recorder, eval store, and session manager. It classifies
task text for safe routing, delegates sub-runs to an injected single-agent
execution port, and records guard and feedback verdicts in an aggregate result.
Sequential and parallel routes run one isolated sub-run per planned agent, then
merge role-prefixed summaries and token usage. Constructing it does not start a
transport, call a model, access the network, or expose local tools.

```ts
const containerResult = createRuntimeServiceContainer({ config });

if (containerResult.ok) {
  const result = await containerResult.value.orchestrator.run({
    task: "Review the runtime boundary"
  });
}
```

The multi-agent executor dependency is wired for forward compatibility. Current
composition paths keep retry accounting per planned agent by invoking the
single-agent execution port once per sub-run.

## Execution Flow

```txt
┌────────────────────────────┐
│ Generated Start Entrypoint │
└──────────────┬─────────────┘
               ▼
┌────────────────────────────────────────────────────┐
│ startLocalRuntime / startRemoteRuntime /           │
│ startApiService                                    │
└──────────────┬─────────────────────────────────────┘
               ▼
┌────────────────────────────────┐
│ createRuntimeServiceContainer  │
└──────────────┬─────────────────┘
               ▼
┌────────────────────────────┐
│ Adapter Policy Checks      │
└──────────────┬─────────────┘
               ▼
┌────────────────────────────┐
│ Tool Filtering + MCP       │
│ Server Metadata            │
└──────────────┬─────────────┘
               ▼
┌────────────────────────────┐
│ Runtime Handle             │
└────────────────────────────┘
```

## Safety

STDIO runtime keeps stdout reserved for protocol traffic. Remote runtime filters unsafe local tools and does not expose local filesystem, shell, write, migration, raw SQL, command output, or unbounded content tools.
