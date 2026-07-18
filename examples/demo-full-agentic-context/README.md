# Full Agentic Context Example

This example demonstrates the full local context setup with token-efficient multi-agent mode, retrieval choices, optional dashboard files, and user-started Docker files.

## Setup Command

```powershell
pnpm --filter @maharudra/create-agentic-ai-infra run cli -- init --project-name "Full Agentic Context" --profile full-agentic-context --agent-mode token-efficient-multi-agent --retrieval hybrid-all --dashboard --with-docker --dry-run
```

## Validate And Doctor

```powershell
pnpm --filter @maharudra/create-agentic-ai-infra run cli -- validate --project-name "Full Agentic Context" --profile full-agentic-context --agent-mode token-efficient-multi-agent --retrieval hybrid-all --dashboard --with-docker
pnpm --filter @maharudra/create-agentic-ai-infra run cli -- doctor --project-name "Full Agentic Context" --profile full-agentic-context --dashboard --with-docker
```

## Expected Structure

```txt
tools/agentic/mcp-server/
tools/agentic/mcp-server/src/dashboard.ts
infra/local-dev/ai-context-db/
infra/db/ai-context/
docs/03-agentic-infra/
.agents/skills/
agentic-ai-infra.config.ts
```

## Demonstrates

- Provider-free deterministic token-efficient multi-agent runtime.
- Retrieval strategy selection across `full-text`, `pgvector`, `document-tree`, `page-index`, `symbol-code`, `graph`, and `hybrid`.
- Dashboard files that start only when the user runs the dashboard command.
- Docker files that the user starts manually.

## Common Mistakes

- Expecting Docker to start automatically.
- Expecting migrations to run during init, validate, doctor, import, or runtime startup.
- Treating generated auth policy references as complete production auth.
