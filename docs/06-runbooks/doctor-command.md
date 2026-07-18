# Doctor Command

`doctor` checks local readiness without mutating the project.

```powershell
create-agentic-ai-infra doctor --project-name "Example App" --profile secure-readonly
```

## Checks

| Check | Purpose |
| --- | --- |
| Node.js | Confirms Node.js 20 or newer. |
| pnpm | Confirms pnpm or `pnpm.cmd` is available. |
| Docker | Warns by default; errors only when Docker files are selected or present. |
| Ports | Reports dashboard/database port conflicts. |
| Generated config | Confirms `agentic-ai-infra.config.ts` presence. |

Doctor does not start Docker, write files, run migrations, bind runtime services, or mutate global configuration.
