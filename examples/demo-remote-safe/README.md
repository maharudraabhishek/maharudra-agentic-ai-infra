# Remote Safe Example

This example demonstrates generated remote-safe MCP/API setup with strict local filesystem and shell boundaries.

## Setup Command

```powershell
pnpm --filter @maharudra/create-agentic-ai-infra run cli -- init --project-name "Remote Safe Workspace" --profile remote-safe --runtime remote-http-mcp,api-service --dry-run
```

## Validate And Doctor

```powershell
pnpm --filter @maharudra/create-agentic-ai-infra run cli -- validate --project-name "Remote Safe Workspace" --profile remote-safe --runtime remote-http-mcp,api-service
pnpm --filter @maharudra/create-agentic-ai-infra run cli -- doctor --project-name "Remote Safe Workspace" --profile remote-safe --runtime remote-http-mcp,api-service
```

## Expected Structure

```txt
services/agentic-context-service/
tools/agentic/mcp-server/
infra/db/ai-context/
docs/03-agentic-infra/remote-safe-runtime.md
agentic-ai-infra.config.ts
```

## Demonstrates

- Remote-safe runtime surface.
- Auth, authorization, rate-limit, and audit policy references.
- No local filesystem exposure and no shell access in remote runtime config.

## Common Mistakes

- Assuming the generated service has been deployed for you.
- Treating policy references as a finished production auth system.
- Adding local filesystem or shell tools to the remote surface.

The generated setup is a safe starting surface. Project owners must implement and review production auth, deployment, certificates, operations, and monitoring.
