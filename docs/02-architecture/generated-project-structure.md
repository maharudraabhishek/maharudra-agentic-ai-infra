# Generated Project Structure

Generated project structure is intentionally neutral and user-owned.

```txt
generated-project/
|-- agentic-ai-infra.config.ts
|-- AGENTS.md
|-- CLAUDE.md
|-- CUSTOMIZE_WITH_CODEX.md
|-- .gitignore
|-- .agents/skills/
|-- tools/agentic/mcp-server/
|   |-- package.json
|   |-- tsconfig.json
|   `-- src/
|-- services/agentic-context-service/
|   |-- package.json
|   |-- tsconfig.json
|   `-- src/
|-- infra/local-dev/ai-context-db/
|-- infra/db/ai-context/
|-- docs/03-agentic-infra/
`-- .agentic-local/
```

## Selection Rules

| Area | Generated when |
| --- | --- |
| Local MCP skeleton | Base generated setup. |
| Remote service skeleton | `remote-http-mcp`, `api-service`, or `all` runtime is selected. |
| Dashboard entrypoint | `--dashboard` is selected. |
| Docker Compose files | `--with-docker` is selected. |
| `.gitignore` managed block | Always planned; appended without overwriting user content. |

## Boundaries

- `.agentic-local/` is private local state and ignored.
- Docker files are generated only; the user starts Docker.
- Migrations are reviewed and approval-gated; they do not run during generation.
- Generated package names use the project slug, not framework branding.
