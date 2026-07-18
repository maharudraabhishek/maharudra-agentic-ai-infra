# @maharudra/agentic-ai-infra-dashboard

Dashboard package surface for token efficiency and agentic infrastructure observability.

The package renders sanitized JSON and dependency-free HTML views for token usage, retrieval quality, eval results, cache efficiency, trajectory summaries, and security warnings.

## Module Map

- `src/index.ts` exports dashboard data contracts, sanitizer, JSON renderer, HTML renderer, bind-policy helper, and explicit server starter.
- Dashboard-facing contracts come from `@maharudra/agentic-ai-infra-core`.
- Runtime-facing summaries come from safe providers and recorders.

## Dashboard Data Flow

```txt
┌──────────────────────┐       ┌───────────────────────┐       ┌──────────────────────┐       ┌──────────────────────┐
│ Runtime Summaries    │       │ DashboardDataProvider │       │ JSON / HTML Renderer │       │ Explicit Server      │
└──────────┬───────────┘       └───────────┬───────────┘       └──────────┬───────────┘       └──────────┬───────────┘
           │ bounded snapshot               │ sanitizeDashboardData         │ rendered response             │ loopback by default
           │───────────────────────────────▶│─────────────────────────────▶│──────────────────────────────▶│
```

Dashboard code should consume bounded summaries. It should not require raw files, vectors, secrets, raw SQL, command output, or stack traces.

## Responsibility Breakdown

| Surface | Owns | Must not own |
| --- | --- | --- |
| Core contracts | Observability, token, retrieval, eval, and workflow data shapes. | Dashboard rendering or server startup. |
| Runtime providers | Safe summary assembly from runtime recorders. | Raw secret, filesystem, SQL, command, vector, or stack-trace exposure. |
| Dashboard package | Sanitization, JSON rendering, HTML rendering, bind policy, and explicit server startup. | Framework core logic or background server side effects. |
