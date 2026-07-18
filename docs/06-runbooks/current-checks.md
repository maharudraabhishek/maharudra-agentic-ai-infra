# Current Checks

Run these commands from the repository root.

```powershell
pnpm install
pnpm -r list --depth -1
pnpm typecheck
pnpm build
pnpm test
pnpm lint
pnpm generated:smoke
pnpm run ci
```

On Windows, use `pnpm.cmd` if PowerShell blocks the script shim:

```powershell
pnpm.cmd typecheck
pnpm.cmd build
pnpm.cmd test
pnpm.cmd lint
```

Expected result:

- packages compile with strict TypeScript
- tests pass
- public docs remain product-facing
- internal implementation notes stay under `docs/internal/`

Recommended order:

| Step | Command | When to run |
| --- | --- | --- |
| 1 | `pnpm install` | After dependency or lockfile changes. |
| 2 | `pnpm -r list --depth -1` | After dependency or workspace-shape changes. |
| 3 | `pnpm typecheck` | After TypeScript, package, or public contract changes. |
| 4 | `pnpm build` | After scaffold, package, export, or generated-output changes. |
| 5 | `pnpm test` | After behavior, contract, generator, dashboard, or runtime changes. |
| 6 | `pnpm lint` | Before handing off changes. |
| 7 | `pnpm generated:smoke` | Before release readiness claims for generated output. |
| 8 | `pnpm run ci` | Before handoff or release-readiness review. |
