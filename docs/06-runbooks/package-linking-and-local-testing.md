# Package Linking And Local Testing

Packages remain private until publishing is explicitly approved. Use workspace links for local testing.

## Local CLI Testing

```powershell
pnpm install
pnpm --filter @maharudra/create-agentic-ai-infra run build
pnpm --filter @maharudra/create-agentic-ai-infra run cli -- init --dry-run
```

## Package Checks

```powershell
pnpm -r list --depth -1
pnpm typecheck
pnpm build
pnpm test
pnpm lint
```

If a package is not available from the registry, that is expected before public publishing approval.
