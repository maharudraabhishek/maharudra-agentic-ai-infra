# Existing Full-Stack App Example

This example demonstrates adding generated local context infrastructure to an existing app while preserving app files.

## Setup Command

```powershell
pnpm --filter @maharudra/create-agentic-ai-infra run cli -- init --project-name "Existing Full Stack App" --profile local-context --retrieval full-text,document-tree,symbol-code --dry-run
```

## Validate And Doctor

```powershell
pnpm --filter @maharudra/create-agentic-ai-infra run cli -- validate --project-name "Existing Full Stack App" --profile local-context --retrieval full-text,document-tree,symbol-code
pnpm --filter @maharudra/create-agentic-ai-infra run cli -- doctor --project-name "Existing Full Stack App" --profile local-context
```

## Expected Structure

```txt
tools/agentic/mcp-server/
infra/db/ai-context/
docs/03-agentic-infra/
.agents/skills/
.gitignore managed block for .agentic-local/
```

## Demonstrates

- Idempotent reruns.
- Append-only `.gitignore` handling.
- Local context profile without changing application source folders.

## Common Mistakes

- Treating `--force` as safe for secrets.
- Expecting Docker or migrations from a local-context-only command.
- Mixing generated infrastructure with app runtime folders.
