# Init Command

`init` creates a neutral generated infrastructure structure in a project folder.

```powershell
create-agentic-ai-infra init --project-name "Example App" --profile secure-readonly
```

## Flow

```txt
┌───────────────┐
│ Target Folder │
└───────┬───────┘
        ▼
┌────────────────────────┐
│ CLI Flags And Defaults │
└───────┬────────────────┘
        ▼
┌───────────────────┐
│ Config Validation │
└───────┬───────────┘
        ▼
┌────────────────────┐
│ Template Rendering │
└───────┬────────────┘
        ▼
┌─────────────────┐
│ Safe Write Plan │
└───────┬─────────┘
        ▼
┌─────────────────┐
│ Generated Files │
└─────────────────┘
```

## Common Profiles

- `secure-readonly`: conservative local read-oriented setup.
- `controlled-write`: local proposal-based write workflow.
- `local-context`: local context and retrieval contract surface.
- `remote-safe`: remote-safe HTTPS/API surface.

Use `--dry-run` first when adding infrastructure to an existing project.
