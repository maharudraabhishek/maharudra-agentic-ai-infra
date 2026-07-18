# Final Product Architecture

MahaRudra Agentic AI Infra is a reusable framework product with local-first developer infrastructure and remote-safe runtime surfaces.

```txt
User project
  |
  v
agentic-ai-infra.config.ts
  |
  v
Core contracts, profiles, validators
  |
  +--> create CLI templates and safe write plan
  +--> local STDIO MCP runtime adapter
  +--> remote-safe MCP/API runtime adapter
  +--> retrieval providers and context builder
  +--> agent harness and deterministic executors
  +--> token dashboard summaries
  `--> test utilities and CI gates
```

## Product Surfaces

| Surface | Purpose | Safety boundary |
| --- | --- | --- |
| Local STDIO MCP | Local developer workflows. | No public connector exposure; stdout reserved for protocol traffic. |
| Remote MCP/API | Remote-safe runtime surface. | Auth, authorization, rate-limit, audit, no shell, no local filesystem. |
| Retrieval/context | Bounded project evidence. | No secrets, private local state, raw vectors, raw SQL, or unbounded chunks. |
| Agent harness | Tool execution guard. | Permission, exact approval, output sanitization, safe token/trajectory records. |
| Dashboard | Observability summaries. | Sanitized JSON/HTML, loopback default, explicit startup only. |

The framework is release-ready, but package publishing is prepared and not executed.
