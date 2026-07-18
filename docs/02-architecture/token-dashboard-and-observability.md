# Token Dashboard And Observability

The dashboard observes framework behavior through sanitized summaries.

```txt
┌────────────────────┐
│ Runtime Services   │
└─────────┬──────────┘
          ├── Token usage recorder
          ├── Trajectory recorder
          ├── Retrieval summary
          ├── Eval summary
          ├── Cache summary
          └── Security warnings
                    │
                    ▼
          ┌────────────────────────┐
          │ Dashboard Data Provider│
          └─────────┬──────────────┘
                    ▼
          ┌────────────────────────┐
          │ JSON Or HTML Renderer  │
          └────────────────────────┘
```

## Privacy Boundary

Dashboard data contains aggregate token counts, source counts, eval counts, role names, tool names, and security warnings. Raw task text and approval text are not part of the dashboard data contract.

## Server Boundary

Dashboard startup is explicit. The default bind host is `127.0.0.1`. Binding to `0.0.0.0` or another non-loopback host requires auth, audit, and rate-limit policy.

## Views

The dependency-free renderer exposes token usage, tokens by agent or tool, shared-context savings, retrieval quality, eval status, cache efficiency, trajectory summaries, and security warning counts.

---

## OTel Tracing Sinks (Stage 17)

The framework provides optional OpenTelemetry-compatible span instrumentation via the `ObservabilitySink` interface in `runtime/src/observability/index.ts`.

### Three Sink Types

```txt
  Sink               When it activates                Output
  ─────────────────  ───────────────────────────────  ──────────────────────────────────────
  NoopTraceSink      traces.enabled = false (default) Nothing — zero overhead
  StderrTraceSink    traces.sink = "local"            JSON span line to stderr on end()
  OtelTraceSink      traces.sink = "remote"           Delegates to @opentelemetry/api tracer
```

Use `createTraceSink(config: ObservabilityConfig)` to select the correct sink from the resolved project config.

### Optional Peer Dependency Pattern

`@opentelemetry/api` is NOT listed as a hard dependency in `package.json`. It is an optional peer dependency — callers who want OTel export install it themselves alongside an OTLP exporter.

The `OtelTraceSink.create()` factory uses a dynamic `require("@opentelemetry/api")` inside a `try/catch`. When the package is absent the factory falls back to `StderrTraceSink` gracefully. No crash, no startup error.

This pattern keeps the framework lean for projects that only need local tracing while allowing production deployments to plug in full OTel infrastructure.

### Config-to-Sink Mapping

```txt
  ObservabilityConfig                     Sink returned
  ──────────────────────────────────────  ──────────────────────────
  traces: undefined                       NoopTraceSink
  traces.enabled: false                   NoopTraceSink
  traces.enabled: true, sink: "local"     StderrTraceSink
  traces.enabled: true, sink: "remote"    OtelTraceSink.create()
  traces.enabled: true, sink: "custom"    NoopTraceSink (fallback)
```

### Instrumented Points

Three points in the runtime are instrumented with spans:

```txt
  Point                            Span name            Attributes
  ───────────────────────────────  ───────────────────  ────────────────────────────────────
  startLocalRuntime() — startup    "startLocalRuntime"  storageType, success (0 or 1)
```

`RetrievalRouter.retrieve()` and `SingleAgentExecutor.execute()` receive the tracing sink through the `RuntimeServiceContainer` for future instrumentation; spans in those paths are a P3 concern once proper OTel context propagation is designed.

### How to Enable

Set `traces.enabled: true` in the `observability` block of your project config:

```typescript
// agentic-ai-infra.config.ts (excerpt)
observability: {
  enabled: true,
  safeLogging: true,
  traces: {
    enabled: true,
    sink: "local"  // "local" → stderr JSON | "remote" → OTel OTLP
  }
}
```

For remote OTel export, also install and configure the SDK:
```
pnpm add @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http
```
