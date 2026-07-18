# Agent Runtime Setup

Use the generated runtime package for local agentic workflows.

```txt
┌───────────────┐
│ Review Config │
└───────┬───────┘
        ▼
┌───────────────────────────────────┐
│ Build Generated Local MCP Package │
└───────┬───────────────────────────┘
        ▼
┌─────────────────────────────────┐
│ Start Generated Runtime Command │
└───────┬─────────────────────────┘
        ▼
┌─────────────────────────────────────┐
│ Safe Token And Trajectory Providers │
└───────┬─────────────────────────────┘
        ▼
┌──────────────────┐
│ Review Summaries │
└──────────────────┘
```

## Steps

1. Review `agentic-ai-infra.config.ts`.
2. Build the generated local MCP package.
3. Start the local runtime only from the generated start command.
4. Review token and trajectory summaries through safe runtime providers.

The runtime does not call external models or networks in deterministic executor mode.
