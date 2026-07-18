# Remote-Safe Runtime Setup

Remote-safe MCP/API setup uses a separate generated service surface.

```txt
┌──────────────────────────────────┐
│ services/agentic-context-service │
└───────────────┬──────────────────┘
                ▼
┌───────────────────────┐
│ Remote Runtime Config │
└───────────────┬───────┘
                ├── Auth policy ───────┐
                ├── Audit policy ──────┤
                └── Rate-limit policy ─┘
                                      ▼
                            ┌─────────────────────┐
                            │ Remote-safe Adapter │
                            └─────────────────────┘
```

## Steps

1. Review remote auth, authorization, audit, and rate-limit policy references.
2. Keep the bind host at `127.0.0.1` for local development.
3. Review exposed tools and confirm they are remote-safe.
4. Start the generated service entrypoint only after policy review.

The remote surface does not expose local filesystem, shell, write, migration, raw SQL, or command-output tools.
