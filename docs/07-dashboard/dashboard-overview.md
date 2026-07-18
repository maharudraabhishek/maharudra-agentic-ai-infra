# Dashboard Overview

The dashboard package renders sanitized infrastructure observability data as JSON or dependency-free HTML.

## Startup

Dashboard startup is explicit. Importing the package does not start a server.

Default host: `127.0.0.1`

Non-loopback binding requires auth, audit, and rate-limit policy.

## Data Sources

The dashboard consumes safe providers for token usage, trajectory summaries, retrieval summaries, eval status, cache efficiency, and security warnings.

```txt
┌──────────────────────┐
│ Safe Runtime Sources │
└──────────┬───────────┘
           ├── Token usage
           ├── Trajectory summaries
           ├── Retrieval summaries
           ├── Eval status
           ├── Cache efficiency
           └── Security warnings
                       │
                       ▼
             ┌────────────────────┐
             │ Dashboard Snapshot │
             └─────────┬──────────┘
                       ▼
             ┌────────────────────┐
             │ JSON Or HTML Views │
             └────────────────────┘
```
