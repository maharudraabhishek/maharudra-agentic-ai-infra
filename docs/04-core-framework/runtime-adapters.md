# Runtime Adapters

Runtime adapters connect framework contracts to execution surfaces.

```txt
┌────────────────┐
│ Project Config │
└───────┬────────┘
        ▼
┌───────────────────────────┐
│ Runtime Service Container │
└───────┬───────────────────┘
        ├── Local STDIO MCP adapter
        ├── Remote HTTP MCP adapter
        └── API service adapter
```

## Startup Model

Imports are side-effect free. Servers start only when a generated entrypoint calls an explicit start function.

Local STDIO keeps stdout reserved for protocol traffic. Logs and diagnostics use stderr or an injected observability sink.

## Remote Safety

Remote HTTP MCP and API service startup requires auth, audit, and rate-limit policy configuration. The default bind host is `127.0.0.1`; public bind hosts are never selected by default.

```txt
┌──────────────────────┐
│ Remote Start Request │
└──────────┬───────────┘
           ▼
Auth configured?
├── No → Typed startup failure
└── Yes
    ▼
    Audit configured?
    ├── No → Typed startup failure
    └── Yes
        ▼
        Rate limit configured?
        ├── No → Typed startup failure
        └── Yes → Remote-safe tool filter
```

Remote adapters exclude local filesystem, write, shell, migration, raw SQL, command-output, and unbounded-content tools.
