# Blank Workspace Setup

Use this path when starting from an empty folder and wanting a local-first generated setup.

```powershell
pnpm --filter @maharudra/create-agentic-ai-infra run cli -- init --project-name "Example Agentic Project" --profile secure-readonly --dry-run
pnpm --filter @maharudra/create-agentic-ai-infra run cli -- validate --project-name "Example Agentic Project" --profile secure-readonly
pnpm --filter @maharudra/create-agentic-ai-infra run cli -- doctor --project-name "Example Agentic Project" --profile secure-readonly
```

Expected generated surface:

```txt
tools/agentic/mcp-server/
infra/db/ai-context/
docs/03-agentic-infra/
.agents/skills/
agentic-ai-infra.config.ts
AGENTS.md
CLAUDE.md
CUSTOMIZE_WITH_CODEX.md
```

This example does not start Docker, run migrations, publish packages, or deploy a service.
