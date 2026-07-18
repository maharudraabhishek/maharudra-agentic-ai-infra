# CI/CD And Release Architecture

CI/CD is part of the framework contract because generated infrastructure must stay safe, repeatable, and truthful before package publishing.

## Verification Pipeline

```txt
install
  -> workspace dependency graph
  -> typecheck
  -> build
  -> test
  -> lint
  -> generated-project smoke tests
  -> release metadata checks
```

| Gate | Command | Purpose |
| --- | --- | --- |
| Dependency restore | `pnpm install --frozen-lockfile` | Use the locked workspace graph. |
| Workspace graph | `pnpm -r list --depth -1` | Confirm package links and workspace shape. |
| Typecheck | `pnpm typecheck` | Verify strict public contracts. |
| Build | `pnpm build` | Compile all package entrypoints. |
| Test | `pnpm test` | Run unit, safety, dashboard, and scaffold tests. |
| Lint | `pnpm lint` | Run package lint gates. |
| Generated smoke | `pnpm generated:smoke` | Generate temp projects and smoke-compile skeletons. |

## Workflows

| Workflow | Trigger | Responsibility |
| --- | --- | --- |
| `ci.yml` | Push and pull request | Full workspace verification. |
| `template-smoke-test.yml` | Push and pull request | Generated-project smoke matrix. |
| `generated-project-checks.yml` | Reusable workflow call | Generated output and scaffold checks. |
| `dashboard-checks.yml` | Push and pull request | Dashboard build, tests, and import-safety checks. |
| `release.yml` | Manual `workflow_dispatch` only | Release-readiness checks and package dry-run metadata checks. |

## Release Posture

Packages remain private. The release workflow never publishes, even when an npm token exists. Publishing requires separate human approval for license, repository metadata, registry credentials, removal of `private:true`, and an explicit publish command change.

```txt
Private package metadata
  |
  v
Full checks pass
  |
  v
Package dry-run metadata review
  |
  v
Manual decision outside this workflow
```
