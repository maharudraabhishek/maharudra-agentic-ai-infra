# MahaRudra Agentic AI Infra

MahaRudra Agentic AI Infra is a package-ready, release-ready TypeScript and pnpm framework for adding local-first and remote-safe agentic AI infrastructure to user projects.

The repository is prepared for future package publishing, but publishing has not been executed. Packages remain private until the license, repository metadata, registry credentials, and explicit publish approval are provided.

## Who It Is For

- Teams that want generated local STDIO MCP tooling without exposing local files through public connectors.
- Projects that need a remote-safe MCP/API runtime surface with auth, authorization, rate-limit, and audit policy hooks.
- Maintainers who want deterministic retrieval, context, agent harness, token-efficiency, and dashboard contracts without paid provider SDKs.
- Framework users who prefer simple profiles and generated setup files over hand-wiring package internals.

## Quickstart

Use the local workspace command while packages remain private:

```powershell
pnpm install
pnpm --filter @maharudra/create-agentic-ai-infra run build
pnpm --filter @maharudra/create-agentic-ai-infra run cli -- init --project-name "Example App" --profile secure-readonly --dry-run
```

The CLI prints a write plan before writing files. Dry-run mode writes nothing.

## Packages

| Package | Status | Responsibility |
| --- | --- | --- |
| `@maharudra/agentic-ai-infra-core` | Private, package-ready | Typed contracts, profiles, validators, errors, runtime policy, retrieval, context, token, eval, and observability types. |
| `@maharudra/create-agentic-ai-infra` | Private, package-ready | Generator CLI, template rendering, safe write plans, validation, and doctor checks. |
| `@maharudra/agentic-ai-infra-runtime` | Private, package-ready | Local/remote runtime adapters, retrieval providers, context builder, storage helpers, agent harness, token accounting, and safe observability. |
| `@maharudra/agentic-ai-infra-dashboard` | Private, package-ready | Dependency-free sanitized JSON/HTML dashboard views and explicit loopback server startup. |
| `@maharudra/agentic-ai-infra-test-utils` | Private, package-ready | Shared fixtures and generated-project smoke-test assertions. |

## CLI Usage

```powershell
create-agentic-ai-infra init --project-name "Example App" --profile local-context
create-agentic-ai-infra init --profile remote-safe --runtime remote-http-mcp,api-service --dry-run
create-agentic-ai-infra init --profile full-agentic-context --agent-mode token-efficient-multi-agent --retrieval hybrid-all --dashboard --with-docker
create-agentic-ai-infra validate
create-agentic-ai-infra doctor
```

Until the create package is published, run the same commands through the local package script:

```powershell
pnpm --filter @maharudra/create-agentic-ai-infra run cli -- init --dry-run
```

## Generated Project Structure

Generated projects use neutral paths that belong to the user project:

```txt
generated-project/
|-- agentic-ai-infra.config.ts
|-- AGENTS.md
|-- CLAUDE.md
|-- CUSTOMIZE_WITH_CODEX.md
|-- .gitignore
|-- .agents/skills/
|-- tools/agentic/mcp-server/
|-- services/agentic-context-service/        # when remote runtime is selected
|-- infra/local-dev/ai-context-db/           # when Docker files are selected
|-- infra/db/ai-context/
|-- docs/03-agentic-infra/
`-- .agentic-local/                          # ignored local state, user-created at runtime
```

The generator appends an idempotent managed block to `.gitignore`; it does not overwrite user ignore rules.

## Profiles And Modes

Built-in profiles:

- `minimal`
- `secure-readonly`
- `controlled-write`
- `local-context`
- `full-agentic-context`
- `remote-safe`
- `hybrid-all`

Agent modes:

- `single-agent`
- `token-efficient-multi-agent`

The deterministic agent runtime is provider-free. It does not call external model APIs or include model/provider integrations.

## Local STDIO Vs Remote-Safe Runtime

```txt
Local developer surface                 Remote-safe runtime surface
-----------------------                 ---------------------------
STDIO MCP                               HTTPS MCP and API service contracts
Local-first workflow                    Auth, authorization, rate-limit, audit hooks
Controlled filesystem policy            No local filesystem exposure
Approval-gated writes                   No shell access
No stdout logging in STDIO mode         Bounded, sanitized outputs
```

The remote-safe runtime surface is generated setup code and framework policy. It is not an automatic production deployment and does not include complete production auth implementation.

## Retrieval Strategy Choices

The framework supports explicit, profile-driven retrieval choices:

- `full-text`
- `pgvector`
- `document-tree`
- `page-index`
- `symbol-code`
- `graph`
- `hybrid`
- `hybrid-all`

Retrieval output is treated as untrusted evidence, not instruction. Providers must avoid secrets, private local state, generated output, raw vectors, raw SQL, and unbounded chunks.

## Using the Dashboard

### What the Dashboard Is For

The dashboard renders sanitized observability data from the running agentic infrastructure. It is designed for token visibility, context efficiency, and safe runtime inspection.

| Data group | What it covers |
| --- | --- |
| Token Usage Summary | Total tokens used vs budget, input/output split, budget utilization bar |
| Tokens by Tool | Per-tool token usage estimates attributed to each tool execution |
| Tokens by Agent | Per-agent token usage estimates in token-efficient multi-agent mode |
| Shared Context Savings | Estimated reduction vs naive per-agent context duplication |
| Retrieval Quality | Provider count, source count, and retrieval warning count |
| Eval Summary | Total, passed, failed, and skipped eval results |
| Cache Efficiency | Cache hit/miss counts and total entry count |
| Trajectory Summary | Total steps, denied steps, tools used, and agent roles active |
| Security Warnings | Count and sanitized labels for active security warnings |

Token numbers are framework-computed estimates from tracked visible usage. Hidden model-side tokens (provider reasoning, billed system prompts, streaming overhead) are not visible to the framework and are not included in these numbers.

### When the Dashboard Is Generated

The dashboard is opt-in. Dashboard scripts and config are only generated when `--dashboard` is passed to the `init` command. Generated projects do not include dashboard scripts unless you select the dashboard during setup.

```powershell
create-agentic-ai-infra init --profile full-agentic-context --dashboard
```

Until the create package is published, use the workspace form:

```powershell
pnpm --filter @maharudra/create-agentic-ai-infra run cli -- init --profile full-agentic-context --dashboard
```

To change the port from the default (`8788`):

```powershell
pnpm --filter @maharudra/create-agentic-ai-infra run cli -- init --profile full-agentic-context --dashboard --dashboard-port 9000
```

### How to Enable the Dashboard in Config

When `--dashboard` is selected, the CLI generates a `dashboard` block in the project's `agentic-ai-infra.config.ts`. The `tokenEfficiency` and `dashboard` sections are separate — enabling token efficiency does not start the dashboard:

```typescript
export default {
  tokenEfficiency: {
    enabled: true,
    tokenBudget: {
      maxTotalTokens: 32000,
      maxContextTokens: 16000
    }
  },
  dashboard: {
    enabled: true,
    host: "127.0.0.1",
    port: 8788,
    showTokenUsage: true,
    showRetrievalQuality: true,
    showEvalResults: true,
    showAuditEvents: true,
    showAgentWorkflows: true
  }
};
```

`dashboard.enabled: true` activates the dashboard contract in the resolved config. The dashboard server itself only starts when you explicitly run the dashboard script.

### How to Start the Dashboard

The generated MCP server package (`tools/agentic/mcp-server/`) includes a `dashboard` script when the dashboard is enabled. Run it from your generated project root:

```powershell
pnpm --dir tools/agentic/mcp-server dashboard
```

Or, using the package filter form if you know the package name:

```powershell
pnpm --filter <your-mcp-package-name> run dashboard
```

The dashboard server only starts when you explicitly run this command. Importing the package, building the project, or starting the MCP runtime does not bind the dashboard port.

### What URL to Open

After starting the dashboard, open:

```
http://127.0.0.1:8788
```

Replace `8788` with the port you configured. The dashboard also serves a sanitized JSON snapshot at:

```
http://127.0.0.1:8788/data.json
```

Use the JSON endpoint for programmatic consumers or to inspect the full per-tool and per-agent breakdowns that are not yet in the HTML view.

### What Each Dashboard View Means

**Token Usage Summary**
Total tokens used vs the configured budget, displayed as a utilization bar. Shows input tokens, output tokens, and total. Use this to confirm the runtime is staying within budget.

**Tokens by Tool and Tokens by Agent**
Per-tool and per-agent token estimates are included in the JSON snapshot when token efficiency is enabled. Available at `/data.json`. Use these to identify which tools or agent roles are consuming the most context.

**Shared Context Savings**
The `estimatedTokenSavings` value shows the estimated reduction achieved by building shared context once and routing narrower role slices to each agent, rather than duplicating the full context per agent. A higher value indicates more efficient context reuse.

**Retrieval Quality**
Shows how many retrieval providers are active, how many sources were found, and how many retrieval warnings were raised. High warning counts indicate retrieval boundaries may need tightening.

**Cache Efficiency**
Shows cache hits, misses, and total entries. A low hit rate may indicate cache TTL is too short or retrieval queries are not repeatable enough to benefit from caching.

**Trajectory and Eval Summary**
Trajectory summary shows step count, denied steps, tool names used, and agent roles active in the session. Eval summary shows total, passed, failed, and skipped evaluation counts.

**Security Warnings**
Shows a count of active sanitized security warning labels. The dashboard never shows raw warning content, stack traces, command output, or secrets. If the count is non-zero, review the audit log for the underlying decision.

### Actual Usage Import

You can import actual token usage data exported from OpenAI/Codex or Anthropic/Claude and compare it with the framework's estimates.

**Enable the dashboard with `--dashboard` during init**, then run the generated import command:

```powershell
pnpm --dir tools/agentic/mcp-server import-usage --source openai-csv --file ./usage/openai-usage.csv
pnpm --dir tools/agentic/mcp-server import-usage --source anthropic-usage-api-json --file ./usage/claude-usage.json
```

Supported source formats: `openai-csv`, `anthropic-usage-api-json`, `anthropic-csv`, `manual-json`, `manual-csv`, `generic-csv`.

**What is safe to import:**

- Token counts (input, output, total, cache read/write, reasoning if provided)
- Provider, client, and model labels
- Project/workspace identifiers
- Run IDs and trace IDs for reconciliation
- Cost and currency (when present in the export)
- Timestamps and date ranges

**What is never imported:**

- Prompts, request bodies, or response content
- API keys or secrets
- User emails (stripped; user IDs are SHA-256 hashed by default)

Imported data is stored as safe JSON in `.agentic-local/usage-imports/` (gitignored by default). No network calls are made during import.

After import, the dashboard shows:

- **Actual Usage Imports** — total imported records, actual token totals, cost summary if available
- **Estimated vs Actual Reconciliation** — matched/unmatched runs, delta, delta percentage

### Codex vs Claude Code Token Comparison

Framework token numbers are always estimated from visible context assembly. They are not exact provider billing figures.

| Type | What it reflects |
| --- | --- |
| Estimated visible framework tokens | Context assembled by the framework — excludes hidden provider-side tokens |
| Imported actual provider/client usage | What the provider billed — includes system/reasoning/overhead tokens |

**Comparison modes** (via `buildEstimatedVsActualComparisons`):

| Mode | When to use |
| --- | --- |
| `estimated-only` | No import yet; compare framework estimates per client |
| `estimated-vs-actual` | Import exists for at least one client; show delta analysis |
| `actual-imported-only` | Show only clients with imported data; omit unimported clients |

If only one client (e.g. Codex) has imported actual data and the other (Claude Code) does not, the comparison shows Codex with actual data and Claude Code as estimated-only. The framework never fabricates actual usage for a client that has no import file.

Common delta causes: hidden reasoning tokens (especially o1/o3), provider system prompts, daily aggregation in CSV exports, missing `run_id` preventing strong per-run matching.

### Safety and Privacy

The dashboard never shows:

- Raw task text or approval text
- Secrets, API keys, tokens, or private keys
- Full retrieval chunks or raw vectors
- Raw SQL queries
- Stack traces or command output
- Local absolute file paths (in remote mode)

If any of these values appear in a snapshot, the sanitizer replaces them with `[redacted]` or `[redacted-local-path]` before rendering. This applies to both the HTML view and the JSON endpoint.

### Troubleshooting

**Dashboard not generated**
Dashboard scripts are only written when `--dashboard` is passed to `init`. Re-run init with `--dashboard`, or manually add `"dashboard": "node dist/dashboard.js"` to `tools/agentic/mcp-server/package.json` and create `src/dashboard.ts` using `startDashboardServer` from `@maharudra/agentic-ai-infra-dashboard`.

**Port already in use**
Change the port with `--dashboard-port <number>` during init, or update `dashboard.port` in `agentic-ai-infra.config.ts` and rebuild. The doctor command checks port availability before writing files.

**Dashboard binds to 127.0.0.1 by default**
This is intentional. Non-loopback binding requires `authRequired`, `auditEnabled`, and `rateLimitRequired` to all be explicitly set in the `DashboardRemotePolicy`. Do not expose the dashboard through a reverse proxy or tunnel without those policies.

**No data appears until runs are executed**
The dashboard snapshot is populated by runtime recorders when tools run, retrievals execute, and agents step. A fresh project shows zero counts until the local MCP runtime has completed at least one session with a tool call or retrieval.

**Token numbers differ from provider billing**
The framework tracks context assembly estimates from its own records. Provider billing includes additional system, reasoning, and streaming tokens outside the framework's visibility. Treat dashboard token numbers as framework estimates, not exact billing figures. Import actual usage data to see the true delta.

**Import command not found**
The `import-usage` script is generated only when `--dashboard` is passed to `init`. If the script is missing, re-run init with `--dashboard` and rebuild.

**CSV produces no data rows**
Check that the first row is a header containing at least one of: `total_tokens`, `input_tokens`, `n_context_tokens_total`. Column names are matched case-insensitively.

**All records show zero tokens**
Your CSV columns may use provider-specific names that differ from expected names. See the column format reference in [docs/07-dashboard/actual-usage-imports.md](docs/07-dashboard/actual-usage-imports.md).

**Large delta in reconciliation**
Expected when using daily aggregate CSV exports. Daily exports span multiple framework runs and cannot be matched per-run. See [docs/07-dashboard/estimated-vs-actual-token-usage.md](docs/07-dashboard/estimated-vs-actual-token-usage.md) for all possible delta causes.

### Detailed Documentation

- [docs/07-dashboard/dashboard-overview.md](docs/07-dashboard/dashboard-overview.md)
- [docs/07-dashboard/token-usage-views.md](docs/07-dashboard/token-usage-views.md)
- [docs/07-dashboard/trajectory-and-eval-views.md](docs/07-dashboard/trajectory-and-eval-views.md)
- [docs/07-dashboard/actual-usage-imports.md](docs/07-dashboard/actual-usage-imports.md)
- [docs/07-dashboard/estimated-vs-actual-token-usage.md](docs/07-dashboard/estimated-vs-actual-token-usage.md)
- [docs/07-dashboard/token-benchmarking.md](docs/07-dashboard/token-benchmarking.md) _(planned)_
- [docs/07-dashboard/token-waste-report.md](docs/07-dashboard/token-waste-report.md) _(planned)_
- [docs/06-runbooks/token-efficiency-debugging.md](docs/06-runbooks/token-efficiency-debugging.md)
- [docs/06-runbooks/importing-actual-usage-data.md](docs/06-runbooks/importing-actual-usage-data.md)
- [docs/06-runbooks/benchmarking-codex-vs-claude-code.md](docs/06-runbooks/benchmarking-codex-vs-claude-code.md)

## Docker And Migrations

The CLI can generate local Docker Compose files for an AI context database:

```powershell
create-agentic-ai-infra init --with-docker --dry-run
```

Docker is user-started. The CLI does not start Docker, create volumes, run migrations, index project knowledge, or mutate global configuration.

Migration execution is approval-gated and separate from init, validate, doctor, import, and runtime startup.

## Safety Model

- Local tooling defaults to STDIO.
- Remote surfaces require auth, authorization, rate-limit, audit, bounded outputs, no shell, and no local filesystem exposure.
- Safe writes use dry-run plans, conflict detection, sensitive path blocking, and append-only `.gitignore` management.
- Approval text is never logged, stored, or displayed by default.
- Raw task text, raw chunks, vectors, raw SQL, stack traces, and command output are excluded from dashboard and trajectory summaries.

## Examples

- `examples/demo-blank-workspace/`
- `examples/demo-existing-fullstack-app/`
- `examples/demo-full-agentic-context/`
- `examples/demo-remote-safe/`

Example docs show generated setup commands, validation, doctor checks, expected structure, common mistakes, and remaining manual setup.

## Troubleshooting

Start with:

- `docs/06-runbooks/troubleshooting.md`
- `docs/06-runbooks/windows-pnpm-powershell.md`
- `docs/06-runbooks/docker-setup-for-generated-projects.md`
- `docs/06-runbooks/doctor-command.md`
- `docs/06-runbooks/ci-failures.md`
- `docs/06-runbooks/package-linking-and-local-testing.md`
- `docs/06-runbooks/release-readiness.md`

## AI Agent Compatibility

This repository is set up for use with both **Claude Code** and **Codex**. Both
agents share the same engineering rules and resume work from the same project
records rather than a duplicated handover document.

### Instruction Files

| Agent | Instruction file | Skills / Commands |
| --- | --- | --- |
| Claude Code | `CLAUDE.md` (imports `AGENTS.md`) | `.claude/commands/<name>.md` — invoke with `/command-name` |
| Codex | `AGENTS.md` | `.agents/skills/<name>/SKILL.md` — referenced in operator prompt |

Engineering rules live in `AGENTS.md` only. Both agents pick them up — Codex reads it directly, Claude Code imports it via `CLAUDE.md`.

### Available Commands and Their Skill Equivalents

| Claude Code command | Codex skill | When active | Purpose |
| --- | --- | --- | --- |
| _(auto — imported in `CLAUDE.md`)_ | reference in operator prompt | **Default — every session** | Architecture review and design |
| `/framework-architecture` | `.agents/skills/framework-architecture` | Default + on-demand | Explicitly re-focus on architecture |
| `/mcp-security-review` | `.agents/skills/mcp-security-review` | On-demand | MCP security surface review |
| `/cli-template-design` | `.agents/skills/cli-template-design` | On-demand | CLI and template design |
| `/agentic-context-design` | `.agents/skills/agentic-context-design` | On-demand | Retrieval and context engineering |
| `/dashboard-token-efficiency` | `.agents/skills/dashboard-token-efficiency` | On-demand | Dashboard and token efficiency |
| `/package-release-readiness` | `.agents/skills/package-release-readiness` | On-demand | Release readiness review |

### Switching Between Agents

The active stage verification summary is the sole operational handoff. It is a
newest-first stack: the top completed phase tells the next agent what changed,
which commands passed or failed, what is blocked, and what should happen next.

```txt
AGENTS.md rules
      │
      ├── STATUS.md       → compact project frontier
      ├── kb.md           → durable decisions and rationale
      └── prompts/stage-*/verification-summary.md
              → LIFO phase evidence, blockers, and next action
```

For example, a new agent starts with the active summary rather than generating
another document:

```powershell
Get-Content STATUS.md
Get-Content kb.md
Get-Content prompts/stage-26/verification-summary.md
```

Do not create `handover.md`. Full switching workflow:
`docs/internal/agent-switching/switching-guide.md`.

---

## Checks

```powershell
pnpm install
pnpm -r list --depth -1
pnpm typecheck
pnpm build
pnpm test
pnpm lint
pnpm run ci
```

On Windows, use `pnpm.cmd` if PowerShell blocks the script shim.
