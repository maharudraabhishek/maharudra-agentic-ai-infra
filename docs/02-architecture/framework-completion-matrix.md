# Framework Completion Matrix

This matrix records the public, release-readiness state of every framework surface. It is the single source of truth for "what is implemented, tested, documented, and accurately described in public docs" and for "what remains intentionally manual user setup."

The matrix excludes internal implementation history. For chronological notes on how each surface was built, see `docs/internal/` (not part of the public documentation surface).

## Columns

| Column | Meaning |
| --- | --- |
| Implemented | Code or workflow exists in this repository. |
| Tested | At least one automated test or workflow exercise covers the surface. |
| Documented | Public docs under `docs/`, package READMEs, or top-level README describe the surface. |
| Public docs accurate | The public wording matches the actual behavior and does not overstate readiness. |
| Remaining manual user setup | Intentional gaps that the framework does not automate. |

## Surfaces

| Surface | Implemented | Tested | Documented | Public docs accurate | Remaining manual user setup |
| --- | --- | --- | --- | --- | --- |
| CLI generator | Yes | Yes (`packages/create-agentic-ai-infra/test`) | Yes (`docs/03-cli/`, root README) | Yes | None for scaffolding; user starts generated services themselves |
| Templates | Yes | Yes (generated-project smoke matrix + template rendering tests) | Yes (`docs/03-cli/generated-project-contract.md`) | Yes | User edits generated docs and policy after init |
| Local STDIO MCP runtime | Yes | Yes (`packages/agentic-ai-infra-runtime/test/runtime.test.ts`) | Yes (`docs/04-core-framework/runtime-adapters.md`, `docs/06-runbooks/local-runtime-setup.md`) | Yes | User wires STDIO MCP server into editor/agent client |
| Remote MCP/API runtime | Yes (contracts + skeleton) | Yes (remote-safe filter test, remote-safe smoke scenario) | Yes (`docs/02-architecture/local-vs-remote-runtime.md`, `docs/05-security/local-vs-remote-safe-mcp.md`, `docs/06-runbooks/remote-safe-runtime-setup.md`) | Yes — described as a safe runtime surface, not as deployed production | User supplies auth, audit, rate-limit, hosting, certificates, monitoring |
| Retrieval providers | Yes (deterministic, provider-free) | Yes (`packages/agentic-ai-infra-runtime/test/retrieval-context-cache.test.ts`) | Yes (`docs/04-core-framework/retrieval-providers.md`, `retrieval-strategies.md`) | Yes — described as deterministic and provider-free | Project owners integrate real embedding/full-text/vector stack as needed |
| Context builder | Yes | Yes (retrieval/context/cache test) | Yes (`docs/02-architecture/retrieval-context-storage.md`) | Yes | None for default builder; user owns project-specific scoring tweaks |
| Storage / migrations | Yes (helpers + approval-gated execution) | Yes (`storage.test.ts`) | Yes (`docs/04-core-framework/storage-and-migrations.md`) | Yes — described as approval-gated, not auto-run | User runs migrations explicitly with the documented approval constant |
| Agent harness | Yes | Yes (`agent-harness-phase5.test.ts`) | Yes (`docs/02-architecture/agent-harness.md`, `docs/04-core-framework/agent-runtime.md`) | Yes | User chooses agent mode and supplies project-specific tools |
| Token-efficient multi-agent | Yes (deterministic, provider-free) | Yes (agent harness tests) | Yes (`docs/02-architecture/token-efficient-multi-agent.md`, `docs/04-core-framework/token-efficiency.md`) | Yes — described as provider-free | User integrates real model providers and synthesis policies as needed |
| Dashboard | Yes (sanitized JSON/HTML, loopback default) | Yes (`packages/agentic-ai-infra-dashboard/test`) | Yes (`docs/07-dashboard/`) | Yes — described as explicit-start, loopback-default | User starts the dashboard explicitly and supplies remote auth if needed |
| Docs | Yes (`docs/00`–`docs/08`, package READMEs, root README) | Yes (banned-wording, truthfulness, secret-file scan tests) | Yes — the docs themselves are the artifact | Yes | None for docs; user edits generated docs after init |
| CI/CD | Yes (`.github/workflows/workspace-checks.yml`, `generated-smoke.yml`, `release-readiness.yml`) | Yes — CI workflows are exercised by every push and PR | Yes (`docs/02-architecture/ci-cd-and-release-architecture.md`, `docs/06-runbooks/ci-failures.md`) | Yes — release workflow described as manual and non-publishing | Project owners add their own deployment workflows downstream |
| Examples | Yes (`examples/demo-blank-workspace`, `demo-existing-fullstack-app`, `demo-full-agentic-context`, `demo-remote-safe`) | Yes — generated-project smoke matrix exercises the same scenarios end-to-end | Yes (`examples/README.md` + per-example READMEs + `docs/08-examples/`) | Yes — documentation-only examples, scenarios match generator output | User runs the generator commands themselves in fresh directories |
| Release readiness | Yes (`release-readiness.yml`, `LICENSE`, `CHANGELOG.md`, package metadata gate) | Yes (`bin-and-docs.test.ts` validates package metadata; release workflow runs pack dry-run) | Yes (`docs/06-runbooks/release-readiness.md`) | Yes — described as package-ready and release-ready, not as published | License selection, registry credentials, repository URL, and explicit publish approval remain manual |
| Security posture | Yes (sensitive-path block, append-only `.gitignore`, secret-file scanners, remote-safe filter, approval text never persisted) | Yes (`remote-safe-filter.test.ts`, smoke scan tests, dashboard import-side-effects test) | Yes (`docs/05-security/local-vs-remote-safe-mcp.md`, `AGENTS.md`) | Yes | Project owners add their own production auth, transport, and audit implementation |

## Boundaries that remain manual by design

The following items are intentionally not automated by this framework. They are listed here so public docs never imply otherwise:

- npm package publishing and registry credential setup.
- License selection change away from `UNLICENSED`.
- Repository URL and package `homepage`/`repository` field finalization.
- Docker container startup in generated projects.
- Database migration execution in generated projects.
- Remote deployment hosting and certificate management.
- Production auth implementation choices.
- Kubernetes cluster setup.
- Real model/provider integration (the framework runtime is intentionally deterministic and provider-free).

## How this matrix stays accurate

- `packages/create-agentic-ai-infra/test/bin-and-docs.test.ts` enforces that public docs (including this file) do not embed banned wording, do not embed unsupported claims, and do not leak unresolved template markers.
- `release-readiness.yml` re-runs the workspace CI gate and confirms that every framework package still has `private: true` and lacks `publishConfig`.
- The generated-project smoke matrix re-validates each example scenario end-to-end and rejects secret-looking files in templates and examples.

If any cell in the matrix flips, the implementing change must update this file in the same commit.
