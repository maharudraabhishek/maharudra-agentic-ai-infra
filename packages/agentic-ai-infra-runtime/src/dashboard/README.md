# Dashboard Module

The dashboard module exposes safe runtime summary providers.

## Functions

- `createRuntimeDashboardDataProvider`: maps config, token records, trajectory records, eval reports, retrieval counts, cache counts, and warnings into a dashboard-compatible snapshot.

## Provider Call Flow

```txt
┌────────────────────┐
│ Runtime Recorders  │
└─────────┬──────────┘
          │ safe counts and summaries
          ▼
┌────────────────────┐
│ Runtime Dashboard  │
│ Data Provider      │
└─────────┬──────────┘
          │ dashboard-compatible snapshot
          ▼
┌────────────────────┐
│ Dashboard Package  │
│ Renderer           │
└────────────────────┘
```

The runtime module owns summary assembly. The dashboard package owns sanitization, rendering, bind policy, and explicit server startup.
