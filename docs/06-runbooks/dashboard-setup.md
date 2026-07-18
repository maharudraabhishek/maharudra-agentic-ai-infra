# Dashboard Setup

Enable dashboard generation with the CLI dashboard option.

```txt
┌────────────────────────────┐
│ Generated Dashboard Config │
└──────────────┬─────────────┘
               ▼
┌────────────────────────────┐
│ Build Local MCP Package    │
└──────────────┬─────────────┘
               ▼
┌────────────────────────────┐
│ Runtime Safe Summary       │
│ Provider                   │
└──────────────┬─────────────┘
               ▼
┌────────────────────────────┐
│ Explicit Dashboard Script  │
└──────────────┬─────────────┘
               ▼
┌────────────────────────────┐
│ Loopback Dashboard Default │
└────────────────────────────┘
```

## Steps

1. Review generated dashboard config.
2. Build the generated local MCP package.
3. Run the explicit dashboard script.
4. Keep the default loopback host unless auth, audit, and rate-limit policy are configured.

The dashboard does not display raw task text, approval text, secrets, full chunks, vectors, raw SQL, stack traces, or command output.
