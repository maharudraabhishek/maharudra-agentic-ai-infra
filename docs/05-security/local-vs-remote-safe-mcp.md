# Local STDIO MCP Vs Remote-Safe MCP/API

Local MCP and remote-safe MCP/API are different security surfaces.

```txt
                         ┌─────────────────────┐
                         │ Runtime Surface     │
                         └──────────┬──────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
          ┌──────────────────┐            ┌──────────────────┐
          │ Local STDIO MCP  │            │ Remote MCP/API   │
          └────────┬─────────┘            └────────┬─────────┘
                   │                               │
                   ▼                               ▼
          ┌──────────────────┐            ┌──────────────────┐
          │ Developer-only   │            │ Public/service   │
          │ capabilities     │            │ boundary         │
          └────────┬─────────┘            └────────┬─────────┘
                   │                               │
                   ├── Safe reads                  ├── Authentication
                   ├── Controlled writes           ├── Authorization
                   ├── Local context indexing      ├── Rate limits
                   └── Allowlisted commands        ├── Audit logs
                                                   └── Bounded tools
```

## Local STDIO MCP

Local MCP may support developer workflows such as safe reads, controlled writes, local context indexing, and allowlisted commands.

It defaults to STDIO so it does not open a public port.

## Remote-Safe MCP/API

Remote-safe surfaces require:

- authentication
- authorization
- rate limits
- audit logs
- bounded outputs
- no local filesystem access
- no shell or arbitrary command execution
- business-safe tool contracts

## Rule

Never expose a local filesystem MCP server through public connectors.
