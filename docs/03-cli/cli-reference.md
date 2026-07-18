# CLI Reference

`@maharudra/create-agentic-ai-infra` provides the generator CLI. The package is private in this repository until publishing is explicitly approved.

## Commands

```powershell
create-agentic-ai-infra init [options]
create-agentic-ai-infra validate [options]
create-agentic-ai-infra doctor [options]
```

Local workspace invocation:

```powershell
pnpm --filter @maharudra/create-agentic-ai-infra run build
pnpm --filter @maharudra/create-agentic-ai-infra run cli -- init --dry-run
```

## Flow

```txt
parse args
  -> normalize options
  -> validate generated config
  -> render templates
  -> build safe write plan
  -> execute write plan or print dry-run
```

`doctor` is non-mutating. It checks readiness and never starts Docker, runs migrations, writes files, or changes global config.

## Options

| Option | Purpose |
| --- | --- |
| `--project-name` | Project display name. |
| `--slug` | Lowercase project slug. |
| `--profile` | Capability profile. |
| `--agent-mode` | `single-agent` or `token-efficient-multi-agent`. |
| `--runtime` | `local-stdio-mcp`, `remote-http-mcp`, `api-service`, or `all`. |
| `--retrieval` | Retrieval strategy list or `hybrid-all`. |
| `--target` | Current directory or a child directory. |
| `--dashboard` | Generate dashboard config and explicit dashboard entrypoint. |
| `--dashboard-port` | Dashboard port. |
| `--with-docker` | Generate local Docker files without starting Docker. |
| `--docker-port` | Local database port in generated Docker files. |
| `--dry-run` | Print write plan without writing. |
| `--force` | Overwrite non-sensitive conflicting generated files. |
