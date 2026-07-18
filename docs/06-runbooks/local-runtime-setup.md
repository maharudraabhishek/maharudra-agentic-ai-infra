# Local Runtime Setup

Use the generated local MCP package for local developer workflows.

```txt
generated-project/
└── tools/agentic/mcp-server/
    └── Explicit start entrypoint
        └── Local STDIO MCP runtime
```

## Steps

1. Review `agentic-ai-infra.config.ts`.
2. Review `tools/agentic/mcp-server/`.
3. Build or typecheck the generated package.
4. Start the local runtime from the generated entrypoint when ready.

STDOUT is reserved for MCP protocol traffic. Use stderr or the configured observability sink for diagnostics.
