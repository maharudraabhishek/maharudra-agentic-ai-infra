# Profiles

Capability profiles give users simple choices while keeping framework internals strongly typed.

## Profile Scope And Capability Surface

- `minimal`: local STDIO runtime contract, single-agent mode, strict security defaults, and safe logging.
- `secure-readonly`: local read-oriented tool surface, bounded outputs, and conservative path policy.
- `controlled-write`: local controlled-write surface with proposal-based changes and exact approval.
- `local-context`: local storage and retrieval contract surface for full-text, document-tree, and symbol/code retrieval.
- `full-agentic-context`: local context, vector-ready storage contracts, shared context packets, role context slices, and eval visibility.
- `remote-safe`: remote HTTPS MCP/API surface with auth, authorization, rate limits, audit behavior, and remote-safe tool filtering.
- `hybrid-all`: combined local, remote, API, retrieval, dashboard, and token-efficient multi-agent contract surface.

## Resolver Model

```txt
┌─────────────┐
│ User Config │
└──────┬──────┘
       ▼
┌───────────────────┐
│ Selected Profiles │
└──────┬────────────┘
       ▼
┌───────────────────┐
│ Merged Config     │
└──────┬────────────┘
       ▼
┌───────────────────┐
│ Validator         │
└──────┬────────────┘
       ▼
┌─────────────────────────┐
│ Resolved Project Config │
└─────────────────────────┘
```

Explicit config can specialize profile output, but it cannot weaken mandatory security settings.
