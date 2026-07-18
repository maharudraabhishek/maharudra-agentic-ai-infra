# STRUCTURE.md — MahaRudra Agentic AI Infra Monorepo

Accurate as of 2026-07-11. Update this file whenever folders are added, renamed, or removed.

---

## Root-level files

| File | Read by | Controls |
| --- | --- | --- |
| `package.json` | pnpm, Node.js, editors | Root workspace scripts (`build`, `typecheck`, `test`, `lint`, `ci`, `release:check`); engine constraint (Node ≥ 20); ESM `"type": "module"`; root devDependencies (TypeScript, Vitest, `@types/node`) |
| `pnpm-workspace.yaml` | pnpm | Declares workspace members: `packages/*` and `examples/*` |
| `tsconfig.base.json` | Each package's `tsconfig.json` via `"extends"` | Shared TypeScript compiler settings: ES2022, NodeNext module resolution, strict mode, declaration emit |
| `pnpm-lock.yaml` | pnpm | Lockfile — do not edit manually |
| `quota.config.json` | `scripts/quota-check.mjs` | AI provider quota plan (`claude: pro`, `codex: pro`), warning threshold (85%), known plan limits reference table |
| `subagent-routing.json` | `scripts/subagent-routing-hook.mjs`, `scripts/subagent-routing.mjs` | Sub-agent auto-routing toggle (`mode: "auto" \| "manual"`). When `auto`, the UserPromptSubmit hook injects director-spawn context on every prompt. Flip with `node scripts/subagent-routing.mjs on \| off`. |
| `.gitignore` | git | Excludes `node_modules/`, `dist/`, `coverage/`, `.turbo/`, `.agentic-local/`, `.env*`, `session-summary.md`, `*.tgz` |
| `AGENTS.md` | Codex, Claude Code, both agents | Primary AI policy file: package manager rules, engineering rules, documentation rules, security rules, skill routing, quota tracking, and per-stage verification summaries |
| `CLAUDE.md` | Claude Code only | Extends `AGENTS.md`; imports the `framework-architecture` skill by default; lists available slash commands; describes agent-switching workflow, phase-summary enforcement, and Windows/PowerShell environment |
| `STRUCTURE.md` | Agents, developers | This file — monorepo layout reference |
| `README.md` | Developers, public | Top-level project introduction |
| `CHANGELOG.md` | Developers, release tooling | Version history |
| `LICENSE` | Developers, legal | License terms (currently UNLICENSED) |
| `session-summary.md` | Agents, developer | Auto-generated after each Claude Code session by `scripts/session-summary.mjs` Stop hook; gitignored; content is ephemeral |

---

## prompts/

Stage-scoped implementation prompts and their living verification summaries.
The summary records completed work, evidence, blockers, and phase handoff;
per-phase changelog files remain the immutable code-shape record.

```txt
prompts/
  stage-26/
    stage-26-phase-01-supervisor-policy.md
    stage-26-phase-07-identity-safety-correctness.md
    stage-26-phase-08-token-efficient-composition.md
    ...
    stage-26-phase-06-container-wiring-closeout.md
    verification-summary.md — Stage 26 implementation, verification, blocker, and handoff ledger
  engineering-hygiene-D50-safe-agent-schema/
    verification-summary.md — D50 closure: safe-agent schema, deviance guardrail, D50/D51 rules, documentation
```

---

## packages/

The five publishable framework packages. Dependencies flow downward only (core ← runtime ← dashboard; core ← create; test-utils is cross-cutting for tests only).

### packages/agentic-ai-infra-core

**npm name:** `@maharudra/agentic-ai-infra-core`

**Purpose:** Framework contracts — the shared type and validation layer that all other packages depend on.

**Owns:**
- TypeScript interfaces and types for: config, profiles, retrieval, storage, context, runtime adapters, token accounting, agents, cache, evals, harness, observability, tools, usage, security policy models
- Built-in config profiles and profile resolver
- Config validator
- Remote-safe filter utility
- Error types

**Must NOT:**
- Start any runtime process, database connection, HTTP server, or MCP server
- Import from `runtime`, `dashboard`, `create-agentic-ai-infra`, or `test-utils`
- Contain UI side effects or file-system writes

**Source layout:**

```txt
src/
  orchestrator/ — SupervisorPolicy routing contracts and module documentation
  agents/      — agent execution type contracts
  cache/       — cache entry and strategy type contracts
  config/      — AgenticAiInfraConfig type + validator
  context/     — context window and retrieval result types
  errors/      — shared error classes
  evals/       — eval case and result type contracts
                 (types.ts — EvalStore, EvalRunRecord, AggregateQualityReport, EvalSuiteContract,
                    EvalDataset, EvalDatasetItem, EvalAnswerMatchMode,
                  validator.ts — validateEvalDataset() hand-rolled validator)
  harness/     — agent harness lifecycle type contracts
  observability/ — span, trace, metric type contracts
  profiles/    — built-in profiles, profile resolver, profile types
  retrieval/   — retrieval provider and query type contracts
  runtime/     — runtime adapter interface contracts
  security/    — remote-safe filter, policy types
  session/     — AgentSession, AgentThread, ThreadedToolCall, SessionManager interface
  storage/     — storage adapter interface contracts
  token/       — token budget and accounting type contracts
  tools/       — tool registry type contracts
  usage/       — usage event type contracts
  index.ts     — public barrel export
```

---

### packages/agentic-ai-infra-runtime

**npm name:** `@maharudra/agentic-ai-infra-runtime`

**Purpose:** Runtime implementations — local STDIO MCP, remote-safe adapter, retrieval, context builder, storage, migrations, cache, agent harness, token accounting, trajectory, and observability.

**Owns:**
- Local STDIO MCP server startup (`runtime/mcp.ts`)
- Retrieval router and retrieval providers
- Context builder
- PostgreSQL/pgvector storage adapter and schema migrations
- In-memory cache implementation
- Agent harness (provider-free, deterministic)
- Agent orchestration (`AgentOrchestrator`, `DefaultSupervisorPolicy`, report contracts, and container slot)
- Token budget tracker and usage event recorder
- Trajectory recorder
- Dashboard data bridge (sends sanitized data to dashboard package)
- Error handling implementations
- Observability spans and traces

**Must NOT:**
- Import from `dashboard` or `create-agentic-ai-infra`
- Expose local filesystem tools, shell execution, or local MCP capabilities through a remote surface
- Include paid model-provider SDKs or LLM API calls

**External dependencies:** `@modelcontextprotocol/sdk`, `pg` (PostgreSQL client)

**Source layout:**

```txt
tsconfig.contract-tests.json — strict no-emit compilation of the Phase 02 runtime report contract test
src/
  orchestrator/types.ts — OrchestratorReport, OrchestratorSubRun, OrchestratorRefusal report contracts
  orchestrator/  — DefaultSupervisorPolicy routing, AgentOrchestrator single/sequential/parallel composition, and module documentation
  agents/       — harness execution implementations
  cache/        — in-memory cache implementation
  context/      — context builder
  dashboard/    — data bridge to dashboard package
  errors/       — runtime error implementations
  evals/        — eval runner implementations
                  (index.ts — runAgentRuntimeEvals() + AgentRuntimeEvalInput,
                   retrieval-evals.ts — 6 retrieval quality eval functions,
                     RetrievalQualityEvalInput, runRetrievalQualityEvals() runner,
                   eval-store.ts — InMemoryEvalStore ring buffer (Stage 24),
                   retrieval-quality-suite.ts — RetrievalQualitySuite EvalSuiteContract adapter (Stage 24),
                   agent-evaluator.ts — AgentEvaluator suite; store history + re-eval (Stage 24),
                   dataset-loader.ts — DatasetLoader; path-safe JSON loader with traversal guard (Stage 24),
                   dataset-evaluator.ts — DatasetEvaluator; substring/exact/semantic match (Stage 24),
                   llm-judge-evaluator.ts — LlmJudgeEvaluator seam; disabled by default (Stage 24),
                   single-agent-evals.ts — runSingleAgentEvals() + 3 check helpers + SINGLE_AGENT_SUITE_NAME (Stage 25 Phase 05))
  harness/      — agent harness lifecycle implementations
                  (index.ts — AgentHarness, SafeOutputSanitizer, DefaultPermissionGate,
                     DefaultApprovalPolicy, HarnessTokenRecorder, HarnessTrajectoryRecorder,
                   eval-harness.ts — EvalHarness (EvalHarnessContract impl), aggregateReports())
  internal/     — package-private canonical value and trace-safety guards
  observability/ — span and trace implementations
  retrieval/    — retrieval router and provider implementations
                  (index.ts, embedding-config.ts — MOCK_EMBEDDING_* constants,
                   embedding-factory.ts — createEmbeddingProvider(config) factory,
                   chunkers.ts — createKnowledgeChunk, dispatchChunker,
                     chunkMarkdownByHeadings, chunkTypeScriptBySymbols, chunkTextWithFallback,
                   indexer.ts — isIndexablePath, scanProjectFiles, indexProjectKnowledge,
                   rrf-merger.ts — ReciprocalRankFusion (Stage 18),
                   heuristic-reranker.ts — HeuristicReranker + DEFAULT_SOURCE_PRIORITY_MAP (Stage 18/22))
test/
  orchestrator/  — supervisor-policy.test.ts, orchestrator-report.test.ts, agent-orchestrator.test.ts,
                   and agent-orchestrator-composition.test.ts
  evals/        — (retrieval-evals.test.ts, eval-store.test.ts, retrieval-quality-suite.test.ts,
                   agent-evaluator.test.ts, dataset-loader.test.ts, dataset-evaluator.test.ts,
                   llm-judge-evaluator.test.ts, single-agent-evals.test.ts — Stage 25 Phase 05)
  harness/      — refusal-wiring.test.ts (agentId permission-gate refusal coverage)
  retrieval/    — (rrf-merger.test.ts, heuristic-reranker.test.ts, embedding-factory.test.ts,
                   local-embedding-provider.test.ts, retrieval-router-parallel.test.ts,
                   source-priority.test.ts — Stage 22 stamping + reranker + ContextOptimizer tests)
  runtime/      — MCP server startup and adapter wiring (mcp.ts, index.ts)
  session/      — PostgresSessionManager, InMemorySessionManager, createSessionManager factory
  storage/      — PostgreSQL adapter, migrations runner
  token/        — token budget tracker
  tools/        — PolicyEnforcingToolRegistry (registration-time enforcement, internal),
                  createRuntimeToolRegistry() factory
  trajectory/   — TrajectoryRecorder interface (recordStep + record + summary);
                  InMemoryTrajectoryRecorder; PostgresTrajectoryRecorder (Stage 17);
                  createTrajectoryRecorder(db|null) factory
  usage/        — usage event recorder
  index.ts      — public barrel export
```

---

### packages/agentic-ai-infra-pdf

**npm name:** `@maharudra/agentic-ai-infra-pdf`

**Purpose:** Optional PDF ingestion extension — extracts text and tables from PDF files, classifies chunks as `"pdf"` knowledge source type, and provides an `OcrProvider` interface for scanned-page fallback.

**Owns:**
- `ExtractedPage`, `MarkdownTable`, `PdfExtractionResult` types
- `OcrProvider` interface (graceful fallback when `tesseract.js` is absent)
- `PDF_SOURCE_TYPE` constant (`KnowledgeSourceType = "pdf"`)

**Must NOT:**
- Be imported at runtime by `core`, `runtime`, `dashboard`, or `create-agentic-ai-infra`
- Auto-load or require `tesseract.js` — it is an optional peer dependency
- Expose secrets, raw file paths, or unfiltered content

**External dependencies:** `pdf-parse` (runtime); `tesseract.js` (optional peer)

**Source layout:**

```txt
src/
  types.ts      — ExtractedPage, MarkdownTable, PdfExtractionResult, OcrProvider, PDF_SOURCE_TYPE
  ocr.ts        — NoopOcrProvider, TesseractOcrProvider, createOcrProvider() factory (Stage 17B)
  extractor.ts  — PdfExtractor class, ParsePdfFn type, PdfExtractorOptions type (Stage 17B)
  index.ts      — public barrel export
test/
  extractor.test.ts — PdfExtractor unit tests: text extraction, scanned detection, OCR (Stage 17B)
  ocr.test.ts       — createOcrProvider fallback path test (Stage 17B)
```

---

### packages/agentic-ai-infra-dashboard

**npm name:** `@maharudra/agentic-ai-infra-dashboard`

**Purpose:** Observability dashboard — sanitized token-usage views, context-budget reporting, retrieval quality metrics, eval visibility, latency/cost views.

**Owns:**
- Loopback HTTP server startup (explicit, never auto-started)
- Sanitized JSON/HTML view renderers
- Token usage, cost, latency, trajectory, and eval display logic

**Must NOT:**
- Expose raw agent task text, secrets, or unfiltered context
- Auto-start on import (must require an explicit start call)
- Import from `create-agentic-ai-infra` or `runtime` (receives data through the runtime's dashboard bridge)

---

### packages/create-agentic-ai-infra

**npm name:** `@maharudra/create-agentic-ai-infra`

**CLI binary:** `create-agentic-ai-infra` → `dist/cli.js`

**Purpose:** Generator CLI — scaffolds agentic AI infrastructure into user projects via profiles and templates.

**Owns:**
- CLI entrypoint and argument parsing (`cli.ts`, `args.ts`)
- `init` and `validate` commands, `doctor` checks (`commands.ts`, `doctor.ts`)
- Template renderer and safe writer (`templates.ts`, `writer.ts`)
- Write planner — computes what to generate before touching the filesystem (`planner.ts`)
- Config factory for generating `agentic-ai-infra.config.ts` (`config-factory.ts`)
- Validation helpers (`validation.ts`)
- Result type (`result.ts`)

**Must NOT:**
- Import from `runtime` or `dashboard`
- Expose framework-internal names, ports, or paths in generated output (use neutral user-project contract paths only)
- Run migrations or start runtime processes

---

### packages/agentic-ai-infra-test-utils

**npm name:** `@maharudra/agentic-ai-infra-test-utils`

**Purpose:** Shared test helpers used by tests across all packages.

**Owns:**
- Smoke-test assertion helpers (`e2e-smoke.test.ts` — 7-assertion CI-passing critical-path test)
- Scaffold verification utilities
- Shared test fixtures and factory functions

**devDependencies:** `@maharudra/agentic-ai-infra-core`, `@maharudra/agentic-ai-infra-runtime` (test-time only)

**Must NOT:**
- Be imported at runtime by `core`, `runtime`, `dashboard`, or `create-agentic-ai-infra`
- Contain application logic or framework contracts

---

## templates/

Template manifests are defined inline in `packages/create-agentic-ai-infra/src/templates.ts`. There is no `templates/` folder in this monorepo. The source of truth for all template file content and manifest definitions is `templates.ts`.

---

## examples/

Two kinds of content live here:

1. **Working code examples** — the `examples/` root is a pnpm workspace package
   (`@maharudra/agentic-ai-infra-examples`). Source files under `examples/src/`
   import from framework packages and run against the in-process runtime.

2. **Documentation-only scaffolds** (`demo-*` subdirectories) — each is a private
   workspace member with no build scripts; they show CLI-generated project structures
   for reference.

### Working examples (`examples/src/`)

| Source path | Profile | Purpose |
| --- | --- | --- |
| `src/vectorless-local/index.ts` | `vectorless-local` | Zero-dependency end-to-end: profile → container → index → search → JSON |
| `src/local-context/index.ts` | `local-context` | Postgres-backed RAG: DATABASE_URL guard → migration → index → search → JSON |
| `src/hybrid-rag/index.ts` | `hybrid-rag` | RRF+heuristic pipeline demo (in-memory storage, no live DB required) |

Build and run:

```sh
pnpm --filter @maharudra/agentic-ai-infra-examples build
pnpm --filter @maharudra/agentic-ai-infra-examples start:vectorless
pnpm --filter @maharudra/agentic-ai-infra-examples start:hybrid-rag
```

### Eval data fixtures (`examples/eval-data/`)

Reference JSON datasets consumed by `DatasetEvaluator`. Plain JSON — no TypeScript or build step.

| File | Purpose |
| --- | --- |
| `retrieval-quality.json` | Sample retrieval quality dataset (3 items: auth, storage providers, pgvector migration) |
| `agent-runtime.json` | Sample agent runtime dataset (3 items: security review, doc pass, architecture review) |
| `README.md` | Schema reference, match mode docs, security rules, addition policy |

### Documentation scaffolds (`examples/demo-*/`)

| Folder | Purpose |
| --- | --- |
| `demo-blank-workspace` | Shows CLI init into a blank workspace |
| `demo-existing-fullstack-app` | Shows CLI init into an existing full-stack app |
| `demo-full-agentic-context` | Shows a full-agentic-context profile generated result |
| `demo-remote-safe` | Shows a remote-safe profile generated result |

---

## docs/

Project documentation. All docs are plain Markdown. No Mermaid, PlantUML, or image-based diagrams.

### docs/00-start-here/ — Public · Product entry point

Audience: new developers and agents starting work on this project.

| File | Purpose |
| --- | --- |
| `product-overview.md` | Package surfaces, product shape diagram, generated project contract, important boundaries |

### docs/01-learning/ — Public · Conceptual guides

Audience: developers who want to understand how the framework works.

| File | Purpose |
| --- | --- |
| `core-contracts-and-config-system.md` | How the core contract layer and config system are designed |

### docs/02-architecture/ — Public · Architecture reference

Audience: developers and agents making design or structural decisions.

| File | Purpose |
| --- | --- |
| `architecture-decisions.md` | ADR log — key decisions and tradeoffs |
| `agent-harness.md` | Agent harness architecture and execution flow |
| `ci-cd-and-release-architecture.md` | CI/CD pipeline and release workflow architecture |
| `final-product-architecture.md` | End-to-end product architecture overview |
| `framework-completion-matrix.md` | Feature completion status across packages |
| `generated-project-structure.md` | Canonical generated user project folder layout and selection rules |
| `local-vs-remote-runtime.md` | Local STDIO vs remote-safe deployment surface boundaries |
| `module-boundaries.md` | Package dependency layer diagram and cross-package import rules |
| `product-architecture.md` | Product architecture and package responsibility overview |
| `retrieval-context-storage.md` | Retrieval provider design, context builder, storage layer |
| `token-dashboard-and-observability.md` | Token accounting and dashboard data flow |
| `token-efficient-multi-agent.md` | Token-efficient multi-agent orchestration design |

### docs/03-cli/ — Public · CLI user docs

Audience: developers using the `create-agentic-ai-infra` CLI.

| File | Purpose |
| --- | --- |
| `cli-reference.md` | Full CLI command reference |
| `doctor-command.md` | `doctor` subcommand guide |
| `dry-run-and-safe-overwrites.md` | Dry-run mode and overwrite safety policy |
| `generated-project-contract.md` | Stable user-facing paths generated into user projects |
| `init-command.md` | `init` subcommand guide |
| `sub-agent-auto-routing.md` | Director sub-agent + 15-roster, how auto mode works on Claude Code and Codex CLI, `subagent-routing.json` schema, `scripts/subagent-routing.mjs` toggle CLI, override-at-prompt-time, token cost, troubleshooting, known limitations and R1–R4 roadmap (links to the internal audit under `docs/internal/learning-notes/`) |
| `sub-agent-deviance-check.md` | D50 deviance guardrail: overview and rationale, toggle CLI (`scripts/subagent-deviance.mjs`), nine-signal table with severity and actions, output locations, verdict precedence, when to disable, fail-safe guarantees |

### docs/04-core-framework/ — Public · Framework usage docs

Audience: developers integrating or extending the framework.

| File | Purpose |
| --- | --- |
| `agent-modes-and-token-efficiency.md` | Single-agent and multi-agent modes, token budget strategies |
| `agent-orchestrator.md` | Layer 10 orchestrator concepts, SupervisorPolicy, composition modes, report shape, refusals, container wiring, and public API |
| `agent-runtime.md` | Runtime adapter and harness lifecycle reference |
| `config-reference.md` | `AgenticAiInfraConfig` field reference |
| `embedding-providers.md` | EmbeddingProvider types, config, factory, auto-selection logic |
| `llm-smart-router.md` | LLM SmartRouter, provider types, budget gate, routing policy |
| `permission-and-approval-policies.md` | Write approval gates, permission policy model |
| `profiles.md` | Built-in profile list and selection guide |
| `profiles-and-config.md` | How profiles and config compose at runtime |
| `supervisor-policy.md` | Pure agent-route selection contract and default manager policy |
| `evaluation-architecture.md` | Eval layer overview — components, data flow, MCP surface, dataset schema, LLM judge, config |
| `retrieval-evals.md` | Retrieval quality eval suite — 6 evals, inputs, pass criteria, agentic.evals.run tool reference |
| `retrieval-providers.md` | Retrieval provider interface and available strategies |
| `retrieval-strategies.md` | Hybrid retrieval, pgvector, heuristic reranking |
| `runtime-adapters.md` | Local MCP adapter and remote-safe adapter guide |
| `storage-and-migrations.md` | Storage adapter, migration runner, approval-gated migration policy |
| `token-efficiency.md` | Token budget enforcement, compact context, cost tracking |

### docs/05-security/ — Public · Security policy

Audience: developers, security reviewers.

| File | Purpose |
| --- | --- |
| `local-vs-remote-safe-mcp.md` | Local vs remote-safe MCP boundary policy and enforcement rules |
| `guardrails-production-hardening.md` | D50/D52 production guardrails: 15-signal deviance system, signal groups, CI gate integration, operator runbook |

### docs/06-runbooks/ — Public · Operational procedures

Audience: developers setting up, operating, or debugging the framework.

| File | Purpose |
| --- | --- |
| `agent-runtime-setup.md` | How to set up the agent runtime |
| `benchmarking-codex-vs-claude-code.md` | How to benchmark Codex vs Claude Code for tasks in this repo |
| `ci-failures.md` | Diagnosing and fixing CI failures |
| `current-checks.md` | What CI checks are active and what they verify |
| `customizing-generated-project.md` | How to customize a generated user project after init |
| `dashboard-setup.md` | How to start and configure the dashboard |
| `docker-setup-for-generated-projects.md` | Docker Compose setup for generated user projects |
| `doctor-command.md` | Running and interpreting `doctor` results |
| `importing-actual-usage-data.md` | How to import real provider usage data into the dashboard |
| `local-runtime-setup.md` | Setting up the local STDIO MCP runtime |
| `ollama-embeddings-setup.md` | Ollama installation, model pull, migration 005, end-to-end embedding verification |
| `package-linking-and-local-testing.md` | Local `workspace:*` linking and testing packages before publish |
| `release-readiness.md` | Steps to verify release readiness |
| `remote-safe-runtime-setup.md` | Setting up the remote-safe MCP/API runtime |
| `retrieval-and-context-setup.md` | Configuring retrieval providers and context budget |
| `token-efficiency-debugging.md` | Debugging token overspend and context budget issues |
| `troubleshooting.md` | General troubleshooting guide |
| `windows-pnpm-powershell.md` | Windows-specific pnpm and PowerShell compatibility notes |

### docs/07-dashboard/ — Public · Dashboard docs

Audience: developers using the observability dashboard.

| File | Purpose |
| --- | --- |
| `actual-usage-imports.md` | Importing actual provider usage into dashboard views |
| `dashboard-architecture.md` | Dashboard data flow and component responsibilities |
| `dashboard-overview.md` | What the dashboard shows and how to start it |
| `estimated-vs-actual-token-usage.md` | Estimated vs actual token usage reconciliation |
| `token-usage-views.md` | Token usage views: cost, latency, context-budget |
| `trajectory-and-eval-views.md` | Trajectory replay and eval result views |

### docs/08-examples/ — Public · Example walkthroughs

Audience: developers learning through concrete examples.

| File | Purpose |
| --- | --- |
| `blank-workspace-setup.md` | Step-by-step blank workspace example |
| `example-index.md` | Index of all available examples |
| `existing-project-setup.md` | Step-by-step existing project integration example |

### docs/internal/ — Internal · Not for public docs

Audience: agents and developers working on the framework itself. Do not promote internal docs to public-facing paths.

| Subfolder | Purpose |
| --- | --- |
| `agent-switching/` | Handover workflow for switching between Claude Code and Codex; `switching-guide.md` |
| `design-decisions/` | Internal design decision records: core contract foundation, package publishing posture |
| `implementation-journal/` | Dated session journals recording what was built and why in each phase |
| `learning-notes/` | Engineering deep-dives on specific subsystems. Files: `agent-harness-engineering.md`, `actual-usage-import-and-reconciliation.md`, `chunking-pipeline-design.md`, `cli-template-generator-architecture.md`, `core-contracts-and-config-system.md`, `dashboard-package-architecture.md`, `embedding-dimension-decision.md` (decision record for vector 64→1024, migration chain, CI skip rationale), `embedding-provider-design.md` (updated Stage 20: dimension decision + OpenAI-compat override), `generated-project-smoke-testing.md`, `llm-provider-design.md`, `node-package-framework-creation.md`, `package-publishing-readiness.md`, `registration-time-permission-enforcement.md`, `release-readiness-and-ci-cd.md`, `retrieval-parallelism-design.md` (Stage 21: Promise.allSettled rationale, query rewrite layer placement, mock guard design), `retrieval-router-and-context-engineering.md`, `runtime-adapters-and-mcp.md`, `safe-agent-schema.md` (D50/D52: SafeAgentSchema v1+v2, 15-signal contract, telemetry record v2.0 TypeScript spec, D50/D51/D52 decisions), `stage-24-eval-architecture.md` (D11–D17 decisions, AgentEvaluator/DatasetEvaluator design rationale), `stage-26-orchestrator.md` (Stage 26 closeout decisions, corrections, rejected alternatives, risks, Stage 27 pickups), `storage-migrations-and-pgvector.md`, `sub-agent-auto-routing-gap-audit.md` (D49 follow-on audit: HIGH/MEDIUM/LOW findings on the auto-routing surface across Claude Code and Codex CLI, phase-able remediation order), `token-budgeting-and-dashboard.md`, `token-efficient-multi-agent-runtime.md`, `deviance-guardrail-production-improvements.md` (D52 production improvement record: 15-gap audit, new local files, telemetry v2.0 changes, implementor handoff) |
| `phase-history/` | Per-phase completion records (Stage 26 phases 1–6 done) |
| `full-architecture-recon.md` | Source-verified gap analysis across all 5 packages (generated 2026-05-15) |
| `reference-rudraloka-mcp-diff.md` | 14-section diff vs Rudraloka reference implementation |
| `architecture-visual-review-brief.md` | Visual review brief for architecture diagrams |
| `v3-architecture-snapshot.md` | Canonical v3 layer map (14 layers, 6 planes, 4 cross-cutting concerns), current state vs target matrix, known gaps, and Stage 26 Layer 10 closeout |
| `session-summary.md` | Auto-generated session snapshot (written by session-summary.mjs Stop hook) |

### docs/README.md

Index of the docs tree; audience guide for navigating public vs internal docs.

---

## changelog/

Structured per-phase engineering records. Each stage has its own folder and
each completed phase has one timestamped Keep-a-Changelog entry.

| Path | Purpose |
| --- | --- |
| `README.md` | Required entry format and authoring rules |
| `engineering-hygiene-stage-verification-summary-2026-06-24-0911.md` | D46 process-improvement record for mandatory living stage verification summaries. |
| `engineering-hygiene-lifo-stage-summary-2026-06-24-0956.md` | D47 process-improvement record: LIFO verification summaries replace root handovers. |
| `stage-26/stage-26-phase-01-2026-06-23-1554.md` | Supervisor policy implementation record; full CI 533/533 passed. |
| `stage-26/stage-26-phase-02-2026-06-23-2219.md` | Orchestrator report shape-contract record; workspace test suite 537/537 passed. |
| `stage-26/stage-26-phase-03-2026-06-23-2315.md` | Single-agent orchestration composition record; workspace test suite 547/547 passed. |
| `stage-26/stage-26-phase-03-2026-06-24-0942.md` | Phase 03 documentation-correction and audit-verification record; runtime package checks 377/377 passed. |
| `stage-26/stage-26-phase-04-2026-07-10-0039.md` | Refusal wiring and agentId plumbing record; full CI 555/555 passed. |
| `stage-26/stage-26-phase-05-2026-07-10-1648.md` | Composition, retry, and response-guard record; full CI 565/565 passed. |
| `stage-26/stage-26-phase-06-2026-07-10-2106.md` | Container orchestrator wiring closeout record; full CI 569/569 passed. |
| `stage-26/stage-26-phase-07-2026-07-11-2319.md` | Corrective identity and safety record; focused core 64/64 and runtime 412/412 passed, final gates pending. |
| `engineering-hygiene-agent-hooks-reference-parity-2026-07-10-0122.md` | Agent/hooks reference parity record; full CI 555/555 passed. |

---

## scripts/

Node.js utility scripts that run locally. Not part of the published packages.

| File | Purpose |
| --- | --- |
| `quota-check.mjs` | Claude and Codex quota tracker. Read by the `.claude/settings.json` Stop hook after every Claude response. Also callable manually: `node scripts/quota-check.mjs <provider> <command>`. Zero API calls, zero tokens — pure local file I/O. |
| `session-summary.mjs` | Session summary writer. Run by the `.claude/settings.json` Stop hook. Writes `session-summary.md` (gitignored). |
| `subagent-routing.mjs` | CLI to inspect and flip the sub-agent auto-routing toggle. Subcommands: `status`, `on`, `off`, `get-mode`. Writes `subagent-routing.json`. |
| `subagent-deviance.mjs` | D50. CLI to inspect and flip the deviance check toggle (`deviance_mode`) in `subagent-routing.json`. Subcommands: `status`, `on`, `off`, `get-mode`. Mirrors the interface of `subagent-routing.mjs`. Appends an audit record to `.agentic-local/deviance-alerts.jsonl` on `off` transitions. |
| `subagent-routing-hook.mjs` | UserPromptSubmit hook handler for both Claude Code (`.claude/settings.json`) and Codex CLI (`.codex/config.toml`). Reads `subagent-routing.json`; when `auto`, emits a `hookSpecificOutput.additionalContext` envelope instructing the host to spawn the director sub-agent. D50/D51: detects user-named sub-agents inline, emits stack-aware prose, and tells the host to preserve in-flight work unless the user redirects or cancels. Always exits 0. |
| `subagent-telemetry.mjs` | D50. SubagentStart / SubagentStop hook handler for both stacks. Appends one JSONL record per event to `.agentic-local/subagent-routing-log.jsonl` (gitignored). Detects HANDBACK → unknown-name (F11) and emits a nearest-name suggestion via Levenshtein. Always exits 0. |
| `subagent-deviance-check.mjs` | D50. Optional audit handler. Reads local telemetry and scans for normalization-of-deviance signals from `docs/internal/learning-notes/safe-agent-schema.md`. HIGH findings append to `.agentic-local/deviance-alerts.jsonl` outside `--dry-run`; MEDIUM findings are stderr-only. Codex runs it manually with `--dry-run`; Claude may wire it on Stop. Always exits 0. |
| `safe-agent-schema-lint.mjs` | D50. Read-only validator that parses every `.claude/agents/*.md` YAML frontmatter and `.codex/agents/*.toml` `[safe_agent_schema]` table and asserts the required keys are present and well-formed. Exits 0 on PASS, 1 on FAIL. `--json` for machine-readable output. Safe to import for parser helpers without invoking the CLI. |

---

## .agentic-local/

Local private runtime state. Gitignored. Created at runtime by the framework or scripts.

| File | Purpose |
| --- | --- |
| `quota-state.json` | Persisted quota usage counters for Claude and Codex (written by `quota-check.mjs`) |
| `session-state.json` | Persisted session state (written by `session-summary.mjs`) |
| `subagent-routing-log.jsonl` | D50. Append-only telemetry — one JSON line per SubagentStart and SubagentStop event (written by `subagent-telemetry.mjs`) |
| `deviance-alerts.jsonl` | D50. Append-only HIGH-severity deviance alerts surfaced from the per-turn deviance scan (written by `subagent-deviance-check.mjs`) |

**Do not commit, read, or index these files.**

---

## .agents/

AI agent skill definitions shared between Claude Code and Codex.

```txt
.agents/skills/
  agentic-context-design/SKILL.md     — retrieval, context engineering, token efficiency, multi-agent
  cli-template-design/SKILL.md        — CLI commands, config profiles, templates, scaffold verification
  dashboard-token-efficiency/SKILL.md — dashboard architecture, token observability, cost/latency views
  framework-architecture/SKILL.md     — package boundaries, clean architecture, dependency inversion (default-loaded)
  mcp-security-review/SKILL.md        — MCP security surface, local vs remote boundary, audit policy
  package-release-readiness/SKILL.md  — package publishing, release gates, CI/CD, versioning
  production-subagents/SKILL.md       — routing layer for the production-grade sub-agent roster (planner, design-architect, implementor, clean-coder, refactorer, debugger, validator, executor, documentation, security-reviewer, release-manager, ai-agentic-specialist, web-extractor, web-scraper)
```

Skills are loaded by agents before starting matched tasks. `framework-architecture` is always active in Claude Code (imported in `CLAUDE.md`). `production-subagents` is mandatory for every non-trivial task (see `AGENTS.md` § Sub-Agent Routing).

---

## .claude/

Claude Code-specific configuration. Not used by Codex.

| Path | Purpose |
| --- | --- |
| `settings.json` | Allowed/denied Bash commands; UserPromptSubmit hook (`subagent-routing-hook.mjs`); telemetry hooks; Stop hook wiring (`quota-check.mjs`, `session-summary.mjs`, `subagent-deviance-check.mjs`) |
| `settings.local.json` | Local-only overrides (not committed; personal Claude Code settings) |
| `README.md` | Explanation of the `.claude/` folder contents |
| `commands/` | Slash command definitions — each file maps `/command-name` to a skill or workflow |
| `agents/` | Production-grade sub-agent definitions — each file is a Claude Code native sub-agent (YAML frontmatter + system prompt) and a Codex role profile |

**Slash commands in `.claude/commands/`:**

| Command | Linked skill |
| --- | --- |
| `/agentic-context-design` | `.agents/skills/agentic-context-design/SKILL.md` |
| `/cli-template-design` | `.agents/skills/cli-template-design/SKILL.md` |
| `/dashboard-token-efficiency` | `.agents/skills/dashboard-token-efficiency/SKILL.md` |
| `/framework-architecture` | `.agents/skills/framework-architecture/SKILL.md` |
| `/mcp-security-review` | `.agents/skills/mcp-security-review/SKILL.md` |
| `/package-release-readiness` | `.agents/skills/package-release-readiness/SKILL.md` |
| `/production-subagents` | `.agents/skills/production-subagents/SKILL.md` |

**Sub-agents in `.claude/agents/`:** (Claude Code invokes via the `Agent` tool with `subagent_type: "<name>"`; Codex adopts the same file as a role profile)

| Sub-agent file | Specialisation | Model |
| --- | --- | --- |
| `director.md` | First call on every prompt (when auto-routing); decomposes task and emits Routing Plan with HANDBACK → markers | opus |
| `planner.md` | Task decomposition, dependency sequencing, verification gates | opus |
| `design-architect.md` | Public types, error codes, cross-package contracts, ADRs | opus |
| `implementor.md` | Translates an approved design into strict TypeScript | sonnet |
| `clean-coder.md` | SOLID, DI, naming, dead-code removal on fresh diffs | sonnet |
| `refactorer.md` | Behaviour-preserving structural rewrites | sonnet |
| `debugger.md` | Reproduce → isolate → root-cause → minimal fix | opus |
| `validator.md` | Final pnpm.cmd typecheck/build/test/lint gate | haiku |
| `executor.md` | Pure command runner, captures full output | haiku |
| `documentation.md` | TSDoc, README, learning notes, ASCII diagrams | sonnet |
| `security-reviewer.md` | Fail-closed MCP, secrets, local↔remote boundary review | opus |
| `release-manager.md` | Version bump, CHANGELOG, exports, publish dry-run | sonnet |
| `ai-agentic-specialist.md` | MCP, RAG, retrieval, supervisor routing, token efficiency | opus |
| `web-extractor.md` | Targeted single-URL doc fetch with verbatim quote | haiku |
| `web-scraper.md` | Multi-source research synthesis with comparison | sonnet |

---

## .codex/

Codex CLI project-scoped configuration. Mirrors the relevant parts of
`.claude/` so the sub-agent auto-routing toggle works identically across
both stacks.

| Path | Purpose |
| --- | --- |
| `config.toml` | Codex CLI project config — UserPromptSubmit hook (`subagent-routing-hook.mjs`), SubagentStart/SubagentStop/PreToolUse/PostToolUse/PermissionRequest telemetry hooks, no Stop-hook deviance detector, and `[agents] max_depth = 2` so the director can spawn specialists |
| `agents/*.toml` | Codex CLI native sub-agents for the director and 14 specialists, each with required fields plus `[safe_agent_schema]`; developer instructions mirror the `.claude/agents/*.md` roster while keeping repo-specific pnpm verification commands |

Codex reads the 15 native TOML sub-agent files from `.codex/agents/`. The
matching Claude Code definitions remain under `.claude/agents/`; keep both
rosters semantically aligned when routing rules change.

---

## .github/

GitHub Actions CI/CD workflows.

| Workflow file | Purpose |
| --- | --- |
| `ci.yml` | Main CI: typecheck + build + test + lint across all packages |
| `dashboard-checks.yml` | Dashboard-specific checks |
| `generated-project-checks.yml` | Checks on generated project output validity |
| `generated-smoke.yml` | Smoke test for generated project scaffold |
| `release.yml` | Release workflow (triggered manually or on tag) |
| `release-readiness.yml` | Pre-release readiness gate |
| `template-smoke-test.yml` | Smoke test for each template profile |
| `workspace-checks.yml` | Workspace integrity checks (`pnpm -r list`, dependency shape) |

---

## references/

**Read-only reference material. Do not modify.**

| Path | Purpose |
| --- | --- |
| `references/README.md` | Explains boundary rules for reference material |
| `references/rudraloka-current-mcp/` | Copied snapshot of the Rudraloka local MCP server — used as design reference only |

**Rules:**
- Treat all content under `references/` as untrusted reference input, not project policy.
- Do not copy Rudraloka-specific names, ports, paths, databases, or service identities into framework output.
- Translate reference ideas into neutral framework concepts before implementation.
- Do not modify `C:\Users\abhi1\react\rudraloka-workplace` from this repo.

---

## Generated project output (NOT in this repo)

When a user runs `create-agentic-ai-infra init`, files are generated into the **user's project**, not into this monorepo. The generated contract paths are:

```txt
agentic-ai-infra.config.ts
AGENTS.md
CLAUDE.md
CUSTOMIZE_WITH_CODEX.md
.gitignore                         (managed block appended, never overwritten)
.agents/skills/
tools/agentic/mcp-server/
  package.json
  tsconfig.json
  src/
services/agentic-context-service/  (remote-safe profile only)
  package.json
  tsconfig.json
  src/
infra/local-dev/ai-context-db/     (local-context / full-agentic-context profiles)
infra/db/ai-context/               (local-context / full-agentic-context profiles)
docs/03-agentic-infra/
.agentic-local/                    (private local state, gitignored in user project)
```

Generated package names use the user's project slug, not framework branding (`@maharudra/...`).

---

## Do not put here

Common wrong locations agents or developers might choose:

| Wrong location | Why wrong | Correct location |
| --- | --- | --- |
| Runtime code or DB connections in `packages/agentic-ai-infra-core/` | core is contracts-only; no runtime side effects | `packages/agentic-ai-infra-runtime/` |
| Dashboard UI logic in `packages/agentic-ai-infra-runtime/` | runtime sends data to dashboard; does not render views | `packages/agentic-ai-infra-dashboard/` |
| Import of `runtime` or `dashboard` from `create-agentic-ai-infra` | CLI only imports core contracts | `packages/agentic-ai-infra-core/` |
| Import of `test-utils` in production `src/` | test-utils is for test code only | `devDependencies`, test files only |
| Framework branding (`@maharudra/`) in generated user project paths | breaks generated project contract; user projects must be brand-neutral | Use neutral paths (`tools/agentic/`, `services/agentic-context-service/`, etc.) |
| Rudraloka names, ports, or service identities in framework code | violates reference boundary | Translate to neutral framework concepts |
| Internal phase history or build-journal wording in public docs | internal planning; not professional for public-facing content | `docs/internal/` |
| Mermaid, PlantUML, or image diagrams in any doc | extension-dependent; does not render in plain text/GitHub | Use ASCII/Unicode box diagrams in fenced `txt` blocks |
| `.env`, `.npmrc`, SSH keys, or credential files anywhere in the repo | security boundary violation | Never create these files from agent actions |
| Application secrets or raw task text in dashboard output | dashboard must display sanitized summaries only | Sanitize in the runtime-to-dashboard data bridge |
| Local filesystem MCP tools on a remote-safe surface | local-only capabilities must stay local | Keep local and remote surfaces strictly separate |
| New packages added to `packages/` without a matching docs entry and skill routing update | breaks discoverability and agent routing | Update `AGENTS.md` skill routing table and add docs |
<!-- Last updated: 2026-06-25 23:46 GMT+5:30 (18:16 UTC) -->
