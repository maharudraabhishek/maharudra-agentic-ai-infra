# Dashboard Source Map

This folder is the dashboard package export boundary.

## Current Surface

- `index.ts` exports dashboard data contracts, sanitizer, JSON renderer, HTML renderer, bind-policy helper, and explicit server start function.
- Dashboard-facing types use core observability, token, retrieval, eval, and agent workflow contracts.

## Dashboard Source Flow

```txt
┌──────────────────────┐
│ Runtime Safe Sources │
└──────────┬───────────┘
           │ bounded summaries only
           ▼
┌──────────────────────┐
│ DashboardDataProvider│
└──────────┬───────────┘
           │ sanitizeDashboardData
           ▼
┌──────────────────────┐
│ JSON / HTML Renderers│
└──────────┬───────────┘
           │ explicit startDashboardServer call
           ▼
┌──────────────────────┐
│ Dashboard Server     │
└──────────────────────┘
```

Dashboard implementations should render safe summaries and avoid raw files, vectors, secrets, raw SQL, command output, and stack traces.

## Export Responsibility Table

| Export area | Responsibility |
| --- | --- |
| Data contracts | Describe dashboard snapshots without requiring raw runtime state. |
| Sanitizer | Redact unsafe keys, secrets, local paths, vectors, SQL, command output, raw files, and stack traces. |
| Renderers | Produce sanitized JSON and dependency-free HTML from a provider snapshot. |
| Bind policy | Keep loopback easy and require auth, audit, and rate-limit policy for non-loopback binds. |
| Server start | Bind only through an explicit call so imports stay side-effect free. |
