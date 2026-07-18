# Dashboard Architecture

The dashboard is a core product surface.

```txt
┌──────────────────────┐       ┌───────────────────────┐       ┌──────────────────────┐
│ Runtime Recorders    │       │ DashboardDataProvider │       │ Dashboard Renderers  │
└──────────┬───────────┘       └───────────┬───────────┘       └──────────┬───────────┘
           │ bounded summaries only         │ sanitized snapshot           │ JSON or HTML
           │───────────────────────────────▶│─────────────────────────────▶│
           │                                │                              │
           │                                │                              ▼
           │                                │                   ┌──────────────────────┐
           │                                │                   │ Explicit Server     │
           │                                │                   │ Start Function      │
           │                                │                   └──────────────────────┘
```

## Observability Areas

- token usage and context budget
- retrieval quality
- eval results
- latency and cost
- local vs remote-safe runtime surface
- agent workflow summaries
- security-relevant events

## Package Responsibility

The dashboard package should not own framework core logic. It observes and explains behavior through typed interfaces designed in the core package.

## Runtime Safety

Dashboard imports are side-effect free. Starting a dashboard server requires an explicit function call. Loopback is the default bind surface, and non-loopback binding requires auth, audit, and rate-limit policy.

| Boundary | Dashboard rule |
| --- | --- |
| Runtime to provider | Runtime code passes bounded summaries, not raw files, raw SQL, vectors, command output, or stack traces. |
| Provider to renderer | Snapshot data is sanitized before JSON or HTML rendering. |
| Import to startup | Importing the package has no server side effects. |
| Loopback bind | `127.0.0.1`, `localhost`, and `::1` are allowed by default. |
| Non-loopback bind | Auth, audit, and rate-limit policy must all be present. |
