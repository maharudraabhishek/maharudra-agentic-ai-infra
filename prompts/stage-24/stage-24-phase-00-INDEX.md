# Stage 24 — Claude Code Execution Index

**MahaRudra Agentic AI Infra — Stage 24: AgentEvaluator + EvalHarness + EvalStore + Eval Datasets + Dashboard `/evals`**

---

## Why this is split

Stage 24 is ~30 files across 11 phases. A single prompt would cause attention drift and hard-to-debug failures. Each phase below is a **standalone Claude Code prompt** with its own CI gate.

**Run order is strict — do not skip ahead.** Each phase depends on the prior phases producing green CI.

---

## Phase order

| Phase | Prompt file | What it adds | Depends on |
|---|---|---|---|
| 1 | `stage-24-phase-01-core-types.md` | Core types + validator + config + ErrorCode | — |
| 2 | `stage-24-phase-02-eval-store.md` | `InMemoryEvalStore` ring buffer | Phase 1 |
| 3 | `stage-24-phase-03-eval-harness.md` | `EvalHarness` + `aggregateReports` | Phase 1 |
| 4 | `stage-24-phase-04-builtin-suites.md` | `RetrievalQualitySuite`, `AgentEvaluator`, `DatasetEvaluator`, `DatasetLoader` | Phases 1–3 |
| 5 | `stage-24-phase-05-eval-data-fixtures.md` | `examples/eval-data/*.json` + README | Phase 1 |
| 6 | `stage-24-phase-06-llm-judge.md` | `LlmJudgeEvaluator` (disabled by default) | Phases 1, 3 |
| 7 | `stage-24-phase-07-executor-refactor.md` | Executor constructors → options object; MultiAgent eval push | Phase 2 |
| 8 | `stage-24-phase-08-mcp-tools.md` | Upgrade `agentic.evals.run`; add `agentic.evals.agent-eval` | Phases 3, 4 |
| 9 | `stage-24-phase-09-runtime-wiring.md` | Wire `EvalStore` + `EvalHarness` into `RuntimeServiceContainer` | Phases 1–8 |
| 10 | `stage-24-phase-10-dashboard-evals.md` | Dashboard `/evals` route + URL routing refactor | Phase 2 |
| 11 | `stage-24-phase-11-documentation.md` | Public + internal docs, `STATUS.md`, `kb.md`, `STRUCTURE.md` | All prior |

---

## How to use

1. Start a fresh Claude Code session.
2. Paste **one phase file** into it.
3. Let Claude Code complete that phase, ending with `pnpm run ci ✓` and the phase done-signal.
4. Verify CI is green locally.
5. Start a new session for the next phase.

Do not run two phases in one session — coherence drops sharply.

---

## Hard invariants (D1–D17) — applied to every phase

These cannot be violated by any phase:

- **D1** `budget-exceeded` does NOT trigger SmartRouter fallback (hard stop).
- **D2** All token estimates use `Math.ceil(text.length / 4)` heuristic.
- **D3** `RetrievalRouter` is the only multi-provider merger.
- **D4** All errors are returned as `FrameworkResult<T>`. No throws across module boundaries.
- **D5** MCP tool contracts live in core, not runtime.
- **D6** Persistent storage goes through `StorageProvider`. `EvalStore` is NOT persistent storage — it is a runtime registry, same category as `TokenUsageRecorder`.
- **D7** `sourcePriority` stamping is in `RetrievalRouter`, not providers.
- **D8** `ContextOptimizer.optimize()` pre-sorts by `sourcePriority DESC, score DESC` at step 1.
- **D9** `ContextOptimizer.optimize()` and `ContextBuilder.build()` are async.
- **D10** `RetrievalResult.embedding?: readonly number[]` is optional; lazy resolution.
- **D11** `EvalsConfig` on `AgenticInfraProjectConfig` + `ResolvedProjectConfig`, NOT in profiles.
- **D12** `EvalHarness` in `runtime/src/harness/eval-harness.ts`; `EvalStore` interface in core; `InMemoryEvalStore` in `runtime/src/evals/`.
- **D13** Both MCP eval tools return `AggregateQualityReport` — single shape, no union, no v2.
- **D14** Suites needing dynamic input accept a lazy options provider (`() => Options`) in their constructor.
- **D15** `LlmJudgeEvaluator` registered only when `config.evals.llmJudge.enabled === true` AND `smartRouter` is wired.
- **D16** `RuntimeServiceContainer.evalStore` and `.evalHarness` are NON-OPTIONAL fields.
- **D17** Executor constructors use an options object (not positional). Only `TokenEfficientMultiAgentExecutor` pushes to `EvalStore`; `SingleAgentExecutor` accepts the option for forward compat but does not push (the eval input shape requires `RuntimeMultiAgentRunReport`).

---

## Test count trajectory

| After Phase | Expected total |
|---|---|
| Start (Stage 23) | 341 |
| 1 | ~360 |
| 2 | ~370 |
| 3 | ~380 |
| 4 | ~400 |
| 5 | ~400 (fixtures only) |
| 6 | ~405 |
| 7 | ~405 (refactor only) |
| 8 | ~410 |
| 9 | ~410 (wiring only) |
| 10 | ~416 |
| 11 | ~416 (docs only) |

Final target: **~416 tests passing, CI green**.

---

## Platform reminder

- Windows 11, PowerShell, Node >= 20, **pnpm only** (never npm, never yarn).
- CI command: `pnpm run ci` (build → typecheck → test → lint).
- Read `AGENTS.md` + `STATUS.md` at the start of every session.
