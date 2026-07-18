# Profiles And Config

Profiles hide complex infrastructure choices behind simple user-facing names.

## Built-In Profiles

| Profile | Storage | Retrieval | CLI | When to use |
| --- | --- | --- | --- | --- |
| `minimal` | none | disabled | ✅ | Smallest local surface; strict security defaults. |
| `secure-readonly` | none | disabled | ✅ | Local read-oriented tooling with controlled outputs. |
| `controlled-write` | none | disabled | ✅ | Proposal-based writes with explicit approval gate. |
| `vectorless-local` | in-memory | full-text, document-tree, symbol-code | ✅ | No Docker or Postgres available; zero external dependencies. Default CLI profile. Upgrade path: `local-context`. |
| `local-context` | Postgres | full-text, document-tree, symbol-code | ✅ | Local retrieval with persistent storage. Requires Postgres + migrations 001–003. |
| `full-agentic-context` | Postgres + pgvector | full-text, pgvector, page-index, graph | ✅ | Full context engineering with semantic search and multi-agent mode. |
| `remote-safe` | none | none | ✅ | Remote HTTPS MCP/API surface with auth, rate limits, and audit. |
| `hybrid-all` | Postgres + pgvector | all providers | ✅ | Combined local, remote, API, retrieval, dashboard, and multi-agent surface. |

## Choosing a Profile

```txt
  Do you need retrieval / context search?
  │
  ├─ No  → minimal or secure-readonly (or controlled-write for writes)
  │
  └─ Yes → Is Postgres / Docker available?
            │
            ├─ No  → vectorless-local  (in-memory, zero deps, restart loses index)
            │
            └─ Yes → Do you need semantic (pgvector) search?
                      │
                      ├─ No  → local-context  (lexical: full-text + doc-tree + symbol)
                      │
                      └─ Yes → full-agentic-context  (+ pgvector, page-index, graph)
                                Or hybrid-all for remote surfaces too
```

The CLI generator defaults to `vectorless-local`. Run with `--profile local-context` for Postgres-backed retrieval.
`vectorless-local` requires no Docker, no Postgres, and no migrations — it is the correct zero-dependency onramp for new users. Users who need persistent storage should pass `--profile local-context` (or a higher profile) explicitly.

## Config File

Generated projects use:

```txt
agentic-ai-infra.config.ts
```

The config remains simple for users while the framework keeps internals typed, testable, and replaceable.

```txt
┌─────────────────────┐
│ User Profile Choice │
└──────────┬──────────┘
           ▼
┌────────────────────────────┐
│ agentic-ai-infra.config.ts │
└──────────┬─────────────────┘
           ▼
┌─────────────────────┐
│ Profile Resolver    │
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ Config Validator    │
└──────────┬──────────┘
           ├── Runtime settings
           ├── Retrieval and storage settings
           ├── Security policy
           └── Dashboard settings
```
