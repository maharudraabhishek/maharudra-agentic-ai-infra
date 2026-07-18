# Windows pnpm And PowerShell

PowerShell can block `pnpm.ps1` depending on local execution policy.

## Recommended Commands

```powershell
pnpm.cmd install
pnpm.cmd typecheck
pnpm.cmd build
pnpm.cmd test
pnpm.cmd lint
```

The framework uses pnpm only. Do not switch generated setup docs to npm, yarn, bun, or npx unless compatibility work is explicitly approved.

## Doctor Behavior

The doctor command checks `pnpm.cmd` on Windows to avoid false missing-pnpm reports from script shim behavior.
