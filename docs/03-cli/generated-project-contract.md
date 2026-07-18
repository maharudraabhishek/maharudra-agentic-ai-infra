# Generated Project Contract

The CLI generates neutral project-owned infrastructure paths. These paths are stable user-facing contract, not package internals.

## Neutral Paths

```txt
generated-project/
|-- agentic-ai-infra.config.ts
|-- AGENTS.md
|-- CLAUDE.md
|-- CUSTOMIZE_WITH_CODEX.md
|-- .gitignore
|-- .agents/skills/
|-- tools/agentic/mcp-server/
|-- services/agentic-context-service/
|-- infra/local-dev/ai-context-db/
|-- infra/db/ai-context/
|-- docs/03-agentic-infra/
`-- .agentic-local/
```

## Path Purpose

| Path | Purpose |
| --- | --- |
| `tools/agentic/mcp-server/` | Local STDIO MCP package skeleton. |
| `services/agentic-context-service/` | Remote-safe MCP/API service skeleton when selected. |
| `infra/local-dev/ai-context-db/` | User-started local Docker files when selected. |
| `infra/db/ai-context/` | Reviewed migration and schema assets. |
| `docs/03-agentic-infra/` | Generated project documentation. |
| `.agents/skills/` | Project-local workflow skill instructions. |
| `.agentic-local/` | Private local state, reports, and cache. |
| `agentic-ai-infra.config.ts` | User-facing framework config. |

The generator appends a managed block to `.gitignore` so `.agentic-local/` stays private. It preserves user `.gitignore` content exactly and does not duplicate the block on rerun.
