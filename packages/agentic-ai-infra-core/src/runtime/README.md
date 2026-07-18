# Runtime Contracts Module

The runtime module defines configuration contracts for local and remote runtime surfaces.

## Main Types

- `LocalStdioMcpRuntimeConfig` configures local STDIO MCP behavior.
- `RemoteHttpMcpRuntimeConfig` configures remote HTTPS MCP behavior.
- `ApiServiceRuntimeConfig` configures the HTTP API service surface.
- `RuntimeModePolicy` describes allowed runtime modes and remote-safe requirements.
- `RuntimeConfig` groups all runtime surfaces for a project.

## Configuration Flow

```txt
┌───────────────┐
│ RuntimeConfig │
└───────┬───────┘
        ▼
┌──────────────────┐
│ Config Validator │
└───────┬──────────┘
        ▼
┌───────────────────────────────────┐
│ Runtime Package Service Container │
└───────┬───────────────────────────┘
        ▼
┌─────────────────────────┐
│ Local Or Remote Adapter │
└───────┬─────────────────┘
        ▼
┌─────────────────────────┐
│ Explicit Start Call     │
└─────────────────────────┘
```

Runtime contracts do not start services. Startup always belongs to an explicit runtime package entrypoint.
