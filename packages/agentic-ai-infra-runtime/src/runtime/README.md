# Runtime Module

The runtime module owns adapter composition and explicit startup.

## Classes And Functions

- `LocalStdioMcpRuntimeAdapter`: prepares local STDIO MCP tools and MCP server metadata.
- `RemoteHttpMcpRuntimeAdapter`: prepares the remote MCP surface after auth, audit, and rate-limit checks.
- `ApiServiceRuntimeAdapter`: prepares the API service surface with the same remote safety rules.
- `createRuntimeServiceContainer`: validates config and composes tools, observability, guards, feedback, and the agent orchestrator.
- `startLocalRuntime`: generated local MCP entrypoint helper.
- `startRemoteRuntime`: generated remote MCP entrypoint helper.
- `startApiService`: generated API entrypoint helper.
- `createMcpServerForTools`: SDK bridge that registers tool metadata without connecting transports.

## Call Flow

```txt
┌────────────────┐
│ Start Function │
└───────┬────────┘
        ▼
┌────────────────┐
│ Resolve Config │
└───────┬────────┘
        ▼
┌────────────────┐
│ Filter Tools   │
└───────┬────────┘
        ▼
┌──────────────────────┐
│ Compose Services     │
│ + AgentOrchestrator  │
└───────┬──────────────┘
        ▼
Remote mode?
├── No → Create MCP server metadata
└── Yes
    ▼
    Remote policy checks pass?
    ├── No → Typed startup failure
    └── Yes → Create MCP server metadata
              ▼
              Return RuntimeHandle
```

The container builds `AgentOrchestrator` from the same config, registry,
executors, guards, feedback hook, token recorder, eval store, and session
manager that it already owns. Imports and container construction do not start
servers, bind ports, connect databases, run migrations, or invoke the
orchestrator.
