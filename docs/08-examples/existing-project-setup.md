# Existing Project Setup

Use this path when adding generated local context infrastructure to an existing app.

```powershell
pnpm --filter @maharudra/create-agentic-ai-infra run cli -- init --project-name "Existing App" --profile local-context --retrieval full-text,document-tree,symbol-code --dry-run
pnpm --filter @maharudra/create-agentic-ai-infra run cli -- validate --project-name "Existing App" --profile local-context --retrieval full-text,document-tree,symbol-code
pnpm --filter @maharudra/create-agentic-ai-infra run cli -- doctor --project-name "Existing App" --profile local-context
```

Expected behavior:

- Existing app files remain untouched unless a non-sensitive generated file is explicitly forced.
- `.gitignore` receives one managed `.agentic-local/` block without duplicating on rerun.
- Generated infrastructure stays under `tools/agentic/`, `infra/`, `.agents/`, and `docs/03-agentic-infra/`.

This example does not mutate global tool configuration or deploy remote services.
