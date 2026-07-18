# Current Status

## Workspace

The pnpm workspace exists under `rudraloka-workplace`.

The local MCP server exists under:

```txt
mcp/rudraloka-dev-mcp
```

The selected direction is a monorepo with independently deployed microservices. Infrastructure will live under `infra/` inside the monorepo.

Backend services will later be separated into:

```txt
services/ai/
services/non-ai/
services/platform/
```

Folder expansion is planned later. The structure should be introduced when there is a real service to place there.

## Local AI Development

Codex global MCP config is currently preferred. The expected global config path is:

```txt
C:\Users\abhi1\.codex\config.toml
```

The local MCP server uses controlled-write mode. That means writes should go through proposal and approval tools instead of direct blind edits when MCP-controlled tools can support the path.

Repo-scoped skills exist under:

```txt
.agents/skills/
```

The MCP security eval harness exists through the `run_mcp_security_evals` tool.

## Documentation

Docs are now structured into numbered folders:

- `00-start-here/`
- `01-learning-journal/`
- `02-architecture/`
- `03-mcp/`
- `04-ai-infra/`
- `05-security/`
- `06-runbooks/`
- `99-archive/`

Current docs should live in the numbered folders. Historical and temporary notes should live in `99-archive/`.

