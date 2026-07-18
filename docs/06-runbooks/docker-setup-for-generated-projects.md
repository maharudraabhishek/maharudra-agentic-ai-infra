# Docker Setup For Generated Projects

The CLI can generate Docker Compose files for a local AI context database. Docker is user-started.

```powershell
create-agentic-ai-infra init --with-docker --dry-run
```

## Flow

```txt
generate files
  -> review infra/local-dev/ai-context-db/docker-compose.yml
  -> start Docker manually from the generated project
  -> verify database readiness
  -> run approval-gated migrations only after review
```

The CLI does not start Docker, create volumes, run migrations, or index project knowledge.

## Common Problems

| Problem | Check | Fix |
| --- | --- | --- |
| Docker CLI missing | `create-agentic-ai-infra doctor --with-docker` | Install Docker before using generated local database files. |
| Port conflict | Doctor reports the configured port in use. | Re-run init with `--docker-port <port>` or edit the generated compose file deliberately. |
| Local password in compose | Generated value is local-development-only. | Replace it before real project use and keep secrets outside docs/templates. |
| Migration confusion | Migration files are generated/reviewed separately. | Use the explicit migration approval path from runtime docs. |
