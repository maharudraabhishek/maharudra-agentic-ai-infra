# Examples

These example projects illustrate how `@maharudra/create-agentic-ai-infra` is invoked for representative scenarios. Each example is a runnable scenario doc, not a pre-generated user project — the generator writes the actual files when you run the documented command in a fresh workspace.

Each example records:

- The exact `create-agentic-ai-infra init` command for the scenario.
- The expected generated structure and which optional surfaces are included.
- Validation and doctor commands you should run before relying on the setup.
- Remaining manual user setup that the framework intentionally does not automate.

## Source examples

Runnable programs in `src/` that demonstrate framework features end-to-end.
Run each with `pnpm --filter @maharudra/agentic-ai-infra-examples run start:<name>`.

| Example | Demonstrates | Storage |
| --- | --- | --- |
| `vectorless-local` | In-memory retrieval, single-agent run (zero dependencies) | In-memory |
| `local-context` | PostgreSQL full-text retrieval + sessions + trajectory | Postgres |
| `hybrid-rag` | Hybrid retrieval: RRF fusion + HeuristicReranker | Postgres |

Postgres-backed examples (`local-context`, `hybrid-rag`) require Docker and
`DATABASE_URL`. See `docs/06-runbooks/examples-quickstart-postgres.md`.

---

## Scenarios

| Folder | Profile | Runtime surfaces | Dashboard | Docker files |
| --- | --- | --- | --- | --- |
| [`demo-blank-workspace`](demo-blank-workspace/README.md) | `secure-readonly` | local STDIO MCP | off | off |
| [`demo-existing-fullstack-app`](demo-existing-fullstack-app/README.md) | `local-context` | local STDIO MCP | off | off |
| [`demo-full-agentic-context`](demo-full-agentic-context/README.md) | `full-agentic-context` | local STDIO MCP | on | on |
| [`demo-remote-safe`](demo-remote-safe/README.md) | `remote-safe` | remote HTTPS MCP + API service | off | off |

## Workspace membership

Each example folder is a private workspace member. They contain no build, test, lint, or typecheck scripts, so workspace-recursive commands (`pnpm typecheck`, `pnpm build`, `pnpm test`, `pnpm lint`) skip them. This keeps CI fast while still giving the documentation a stable, discoverable home.

## Safety boundaries

- Examples never include secret-looking files (`.env`, `.npmrc`, private keys, credentials).
- Examples describe Docker startup as a user-controlled step, migration execution as approval-gated, and generated remote services as a safe starting surface that still requires the project owner's own deployment and auth implementation.
- Examples never embed any wording from the framework's internal implementation chronology; all such notes live under `docs/internal/`.
