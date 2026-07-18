# Observability Module

The observability module provides runtime log sinks.

## Classes And Constants

- `StderrObservabilitySink`: writes diagnostics to stderr, which is safe for STDIO MCP.
- `MemoryObservabilitySink`: records events in memory for tests and embedders.
- `silentObservabilitySink`: accepts events without side effects.

## Flow

```txt
┌─────────────────┐
│ Runtime Adapter │
└────────┬────────┘
         ▼
┌────────────────────┐
│ Observability Sink │
└────────┬───────────┘
         ├── Stderr for local diagnostics
         ├── Memory for tests
         └── Silent for generated skeletons
```
