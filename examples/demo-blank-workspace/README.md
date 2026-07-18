# Blank Workspace Example

This example demonstrates a secure read-only generated setup for an empty workspace.

## Setup Command

```powershell
pnpm --filter @maharudra/create-agentic-ai-infra run cli -- init --project-name "Blank Workspace" --profile secure-readonly --dry-run
```

Remove `--dry-run` only after reviewing the write plan.

## Validate And Doctor

```powershell
pnpm --filter @maharudra/create-agentic-ai-infra run cli -- validate --project-name "Blank Workspace" --profile secure-readonly
pnpm --filter @maharudra/create-agentic-ai-infra run cli -- doctor --project-name "Blank Workspace" --profile secure-readonly
```

## Expected Structure

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

## Demonstrates

- Local-first STDIO MCP skeleton.
- Safe write-plan review.
- Generated docs and project-local workflow skill.

## Common Mistakes

- Assuming packages are published before release approval.
- Removing `--dry-run` before reviewing the write plan.
- Exposing local STDIO MCP as a public connector.

No Docker, migrations, remote deployment, or production auth setup is performed automatically.
