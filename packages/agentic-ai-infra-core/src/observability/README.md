# Observability Contracts Module

The observability module defines typed signals for dashboard, audit, and trace consumers.

## Main Types

- `DashboardConfig` describes dashboard host, port, and visible signal groups.
- `ObservabilityConfig` describes audit, trace, and safe logging settings.
- `AuditConfig` describes audit enablement and sink selection.
- `TraceConfig` describes trace enablement and sink selection.

## Call Flow

```txt
┌───────────────┐
│ Runtime Event │
└───────┬───────┘
        ▼
┌────────────────────────┐
│ Observability Contract │
└───────┬────────────────┘
        ▼
┌────────────────────────┐
│ Safe Sink              │
└───────┬────────────────┘
        ▼
┌────────────────────────────┐
│ Dashboard Or Audit Summary │
└────────────────────────────┘
```

Observability contracts should carry safe summaries. They must not require secrets, raw command output, stack traces, or raw database contents.
