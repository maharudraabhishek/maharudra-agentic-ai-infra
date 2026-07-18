# CI Failures

CI failures should be handled by the gate that reported them.

| Gate | What it usually means | Local command |
| --- | --- | --- |
| Install | Lockfile or workspace dependency mismatch. | `pnpm install` |
| Workspace graph | Package links are wrong or workspace shape changed. | `pnpm -r list --depth -1` |
| Typecheck | Public contract or generated type mismatch. | `pnpm typecheck` |
| Build | Package output or exports are broken. | `pnpm build` |
| Test | Runtime, dashboard, scaffold, or docs guard failed. | `pnpm test` |
| Lint | Package lint gate failed. | `pnpm lint` |
| Generated smoke | Generated temp project is unsafe or cannot smoke-compile. | `pnpm generated:smoke` |

Generated smoke tests clean temp folders after success. On failure they print a bounded temp path for local debugging.
