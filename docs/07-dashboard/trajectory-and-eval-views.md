# Trajectory And Eval Views

Trajectory views explain what happened without exposing unsafe payloads.

## Trajectory Summary

| Safe event field | Purpose |
| --- | --- |
| `traceId` | Groups related runtime work. |
| `runId` | Identifies one agent or tool run. |
| `role` | Shows the routed role without raw task text. |
| `stepType` | Classifies the operation. |
| `toolName` | Names the tool contract, not raw payloads. |
| `status` | Shows success, denial, skip, or error state. |
| `durationMs` | Supports latency inspection. |
| Safe error code | Summarizes failure without stack traces or secrets. |

## Eval Summary

Eval views show pass, fail, skip, and metric summaries. Framework eval hooks check required role routing, forbidden tool use, remote unsafe blocking, context duplication, token budget behavior, output sanitization, and safe trajectory metadata.

## /evals route

The dashboard exposes a dedicated `/evals` route showing aggregate eval
results pulled from the runtime `EvalStore`.

- `GET /evals` — HTML view with summary stats and an SVG distribution chart
- `GET /evals.json` — JSON shape `{ latest, history }` where each entry is an
  `EvalRunRecord`

All records are sanitized before serialization: secrets matching common API
key patterns and absolute filesystem paths are redacted to `[redacted]`;
fields whose key appears in the dashboard's `UNSAFE_KEYS` list are dropped
entirely.

The dashboard server enforces loopback-bind by default — `/evals` is not
accessible over public networks without an explicit remote policy.
