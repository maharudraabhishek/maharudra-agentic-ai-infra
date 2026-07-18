# Local Vs Remote Runtime

Local STDIO MCP and remote-safe MCP/API are separate runtime surfaces.

```txt
local-stdio-mcp
  -> local developer workflow
  -> STDIO transport
  -> no stdout diagnostics
  -> controlled local capabilities

remote-http-mcp / api-service
  -> service runtime surface
  -> auth, authorization, rate-limit, audit policy required
  -> no local filesystem exposure
  -> no shell access
  -> bounded outputs
```

## Local STDIO MCP

Local MCP is for developer workflows. It can support safe local context and approval-gated write proposals, but it must not be exposed as a public connector.

## Remote-Safe MCP/API

Remote-safe surfaces are generated setup and framework policy. They are not automatic production deployment. Project owners must implement and review production auth, deployment, certificates, operations, and monitoring.

## Rule

Never expose a local filesystem MCP server through a public connector.
