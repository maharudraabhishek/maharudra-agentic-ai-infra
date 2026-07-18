# Doctor Command

`doctor` checks local readiness without changing project files or global configuration.

```powershell
create-agentic-ai-infra doctor
```

| Check | Result style |
| --- | --- |
| Node.js | Required runtime readiness. |
| pnpm or pnpm.cmd | Required package-manager readiness. |
| Optional Docker | Warning unless local Docker files are selected. |
| Configured ports | Readiness warning for occupied ports. |
| Generated config | Required generated project contract check. |
| Generated folders | Required generated structure check. |
| Readiness report | Safe summary without mutation. |

## Checks

- Node.js version
- pnpm availability
- optional Docker availability
- port availability
- generated config presence
- generated folder presence
- potential conflicts

Docker is a warning when Docker files are not selected. It becomes an actionable readiness issue when local Docker files are selected.

On Windows, package manager detection must account for `.cmd` shims. The doctor command should avoid false missing-pnpm reports when `pnpm.cmd` works from the terminal but direct process spawning behaves differently.
