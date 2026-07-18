# Stage 24 — Phase 11: Documentation
## Claude Code Prompt — MahaRudra Agentic AI Infra

---

## BEFORE YOU START

**Platform:** Windows 11, PowerShell, Node >= 20, **pnpm only**
**CI command:** `pnpm run ci`
**Read first:** `AGENTS.md`, `STATUS.md`, `kb.md`, `STRUCTURE.md`, `docs/internal/v3-architecture-snapshot.md` (find the Stage 23 row — Stage 24 is appended after it)
**Prerequisite:** Phases 1–10 complete; CI green at ~416 tests
**Expected after this phase:** ~416 tests passing (docs only, no new tests)

---

## SCOPE — Phase 11 only

Ship documentation for the Stage 24 system. Two audiences:
1. **Public docs** (`docs/04-core-framework/`, `docs/07-dashboard/`, module READMEs) — describe the eval architecture without stage numbers
2. **Internal docs** (`docs/internal/`, `STATUS.md`, `kb.md`) — describe Stage 24 as a stage with decisions and learning notes

All other phases must already be complete. This phase touches docs, READMEs, and tracking files only — no TypeScript source changes.

---

## FILES TO CHANGE

```
docs/04-core-framework/evaluation-architecture.md              NEW (public)
docs/04-core-framework/retrieval-evals.md                      MODIFY (update existing)
docs/07-dashboard/trajectory-and-eval-views.md                 MODIFY (add /evals route)
docs/08-examples/vectorless-local.md                           MODIFY (executor options syntax)
docs/08-examples/local-context.md                              MODIFY (executor options syntax)
docs/internal/learning-notes/stage-24-eval-architecture.md     NEW (internal)
docs/internal/v3-architecture-snapshot.md                      MODIFY (add Stage 24 row)
packages/agentic-ai-infra-core/src/evals/README.md             MODIFY (mention new types)
packages/agentic-ai-infra-runtime/src/evals/README.md          MODIFY (suites + store)
packages/agentic-ai-infra-runtime/src/harness/README.md        MODIFY (mention EvalHarness)
STATUS.md                                                       MODIFY (prepend Stage 24 entry)
kb.md                                                           MODIFY (prepend Stage 24 entry)
STRUCTURE.md                                                    MODIFY (add new files)
```

---

## CHANGE 1 — `docs/04-core-framework/evaluation-architecture.md` (NEW)

```markdown
# Evaluation Architecture

The framework's evaluation layer answers a single question: *does an agent
run satisfy its quality, safety, and cost criteria?* It does so deterministically
and locally by default, with optional LLM-judge augmentation.

## Components

| Component | Location | Responsibility |
|---|---|---|
| `EvalStore` (interface) | `core/src/evals/types.ts` | Storage contract for eval run records |
| `InMemoryEvalStore` | `runtime/src/evals/eval-store.ts` | Default in-memory ring buffer |
| `EvalHarness` | `runtime/src/harness/eval-harness.ts` | Registers and dispatches suites |
| `EvalSuiteContract` (interface) | `core/src/evals/types.ts` | Contract every suite implements |
| `RetrievalQualitySuite` | `runtime/src/evals/retrieval-quality-suite.ts` | Wraps `runRetrievalQualityEvals()` |
| `AgentEvaluator` | `runtime/src/evals/agent-evaluator.ts` | Aggregates history + re-evaluates rules |
| `DatasetEvaluator` | `runtime/src/evals/dataset-evaluator.ts` | Scores a dataset against actual run outputs |
| `LlmJudgeEvaluator` | `runtime/src/evals/llm-judge-evaluator.ts` | Optional LLM-as-judge (disabled by default) |

## Data flow

```text
Multi-agent run completes
    │
    ▼
TokenEfficientMultiAgentExecutor builds RuntimeMultiAgentRunReport
    │
    ▼
runAgentRuntimeEvals({ report }) → QualityReport
    │
    ▼
EvalStore.push({ runId, traceId, recordedAt, report })
    │
    ▼  (on-demand)
Dashboard /evals route, MCP tool agentic.evals.agent-eval
```

The single-agent executor accepts the `evalStore` option for forward
compatibility but does not push records — `runAgentRuntimeEvals` requires a
`RuntimeMultiAgentRunReport`. Single-agent evaluation arrives in a later
release alongside per-agent definitions.

## MCP surface

Two MCP tools expose evals to remote clients:

- `agentic.evals.run` — runs a named suite (default `retrieval-quality`).
- `agentic.evals.agent-eval` — runs the `agent-evaluator` suite which surfaces
  the most recent `EvalStore` history plus an on-demand re-evaluation against
  the configured rules.

Both tools return the same `AggregateQualityReport` shape:

```typescript
{
  status: "passed" | "failed" | "skipped",
  suites: QualityReport[],
  total: number,
  passed: number,
  failed: number,
  skipped: number
}
```

`status` is the worst-of across `suites[*]`: any failure beats any pass beats
all-skipped.

## Eval datasets

JSON datasets live under `examples/eval-data/` and are validated by
`validateEvalDataset()`. The minimum item shape is:

```json
{
  "id": "stable-identifier",
  "question": "input fed to the system",
  "expectedChunks": ["chunk-id-1"],
  "expectedAnswer": "expected string",
  "expectedToolCalls": ["tool-id"]
}
```

Optional `matchMode` selects the answer-matching strategy:
- `"substring"` (default) — case-insensitive substring match
- `"exact"` — case-sensitive byte-equality after trim
- `"semantic"` — delegated to `LlmJudgeEvaluator` (skipped when LLM judge is off)

`DatasetLoader` rejects path-traversal segments (`..`, `/`, `\\`, absolute paths).

## LLM judge — disabled by default

`LlmJudgeEvaluator` is registered only when both conditions hold:
1. `config.evals.llmJudge.enabled === true`
2. A `SmartRouter` is wired into the runtime container

When either is false the suite is not registered and `DatasetEvaluator` returns
`"skipped"` for items with `matchMode: "semantic"`.

Results are cached by `sha256(question | expected | actual)` so identical
inputs are deterministic.

## Configuration

```typescript
const config = {
  // ...
  evals: {
    store: { capacity: 100 },       // ring buffer size, default 100
    llmJudge: {
      enabled: false                // default off
    }
  }
};
```

`config.evals` is optional on both `AgenticInfraProjectConfig` and
`ResolvedProjectConfig`. Profiles do not carry eval config — it is project-level.
```

---

## CHANGE 2 — `docs/04-core-framework/retrieval-evals.md`

Append a section at the end:

```markdown
## Stage 24+: Suite-based dispatch

`runRetrievalQualityEvals()` is also wrapped by `RetrievalQualitySuite`
(`runtime/src/evals/retrieval-quality-suite.ts`), which implements
`EvalSuiteContract`. The suite is auto-registered into the runtime
`EvalHarness`. Direct callers can still use `runRetrievalQualityEvals()`; the
suite is just a thin adapter that exposes the same evals via the harness's
unified `runAll()` / `runSuite("retrieval-quality")` API.

See `docs/04-core-framework/evaluation-architecture.md` for the full picture.
```

---

## CHANGE 3 — `docs/07-dashboard/trajectory-and-eval-views.md`

Add a new section near the bottom (preserve existing content):

```markdown
## /evals route

The dashboard exposes a dedicated `/evals` route showing aggregate eval
results pulled from the runtime `EvalStore`.

- `GET /evals` — HTML view with summary stats and an SVG distribution chart
- `GET /evals.json` — JSON shape `{ latest, history }` where each entry is an
  `EvalRunRecord`

All records are sanitized before serialization: secrets matching common API
key patterns and absolute filesystem paths are redacted to `[redacted]`;
fields whose key appears in the dashboard's `UNSAFE_KEYS` list are dropped
entirely.

The dashboard server enforces loopback-bind by default — `/evals` is not
accessible over public networks without an explicit remote policy.
```

---

## CHANGE 4 — `docs/08-examples/vectorless-local.md`

Update the existing code snippet that constructs `SingleAgentExecutor`. Find:

```typescript
const executor = new SingleAgentExecutor(
  config,
  trajectoryRecorder,
  tokenRecorder,
  sessionManager
);
```

Replace with:

```typescript
const executor = new SingleAgentExecutor({
  config,
  trajectoryRecorder,
  tokenRecorder,
  sessionManager
});
```

Add a one-line note: *Executor constructors now accept an options object instead of positional parameters.*

---

## CHANGE 5 — `docs/08-examples/local-context.md`

Same change pattern as Change 4. Update the constructor call to the options-object form.

---

## CHANGE 6 — `docs/internal/learning-notes/stage-24-eval-architecture.md` (NEW)

```markdown
# Stage 24 — Eval Architecture Learning Notes

## Why this stage exists

Stage 21 introduced `runRetrievalQualityEvals` and `runAgentRuntimeEvals` as
pure functions. They worked but had no orchestration: every caller had to
construct input, invoke the function, and decide what to do with the report.
Stage 24 adds the orchestration layer.

## Decisions D11–D17 (locked)

- **D11** `EvalsConfig` on `AgenticInfraProjectConfig` and `ResolvedProjectConfig`,
  not on profiles. Profiles are for runtime mode / storage / network; eval
  config is project-level.
- **D12** `EvalHarness` lives in `runtime/src/harness/eval-harness.ts` — same
  directory as `AgentHarness`. `EvalStore` interface in core; `InMemoryEvalStore`
  in runtime.
- **D13** Both MCP eval tools return `AggregateQualityReport` — single
  normalized shape forever. No union, no v2.
- **D14** Suites needing dynamic input accept a lazy options provider
  (`() => Options`) in their constructor. `EvalSuiteContract.run()` stays as
  `() => Promise<FrameworkResult<QualityReport>>` — no arguments.
- **D15** `LlmJudgeEvaluator` is registered only when
  `config.evals.llmJudge.enabled === true` AND `smartRouter` is wired.
- **D16** `RuntimeServiceContainer.evalStore` and `.evalHarness` are
  NON-OPTIONAL fields. Always wired in-memory.
- **D17** Executor constructors use an options object (not positional). Only
  `TokenEfficientMultiAgentExecutor` pushes to `EvalStore`; `SingleAgentExecutor`
  accepts the option for forward compat but does not push — the eval input
  shape requires `RuntimeMultiAgentRunReport`.

## Why `AgentEvaluator` doesn't run the agent

The suite cannot trigger an agent run from inside itself — that would require
re-entering the executor with the original input, which the suite does not
hold. Instead, the executor pushes a record after each successful run, and
the suite surfaces those records. A live `reportProvider` option lets callers
re-evaluate the most recent run against tightened rules without re-running.

## Why `DatasetEvaluator` is NOT auto-registered

`DatasetEvaluator` requires a `DatasetLoader` (a base directory) and a dataset
filename. Auto-registering it at container construction would either require
unsafe defaults or force a filesystem read at startup. Both are unacceptable.
Callers register `DatasetEvaluator` explicitly when they're ready to evaluate.

## Why URL routing had to be added to the dashboard

The pre-Stage-24 dashboard server had a single `http.createServer` callback
that returned the same snapshot for every path — it dispatched only on
`Accept: application/json` for content-type. Adding `/evals` required
introducing real URL routing. The refactor preserves the existing `/` and
`/*.json` behavior; the only observable change is that `/evals` and
`/evals.json` now exist.

## Why SingleAgent doesn't push to EvalStore

`runAgentRuntimeEvals` takes `AgentRuntimeEvalInput` with `report?:
RuntimeMultiAgentRunReport`. `SingleAgentExecutor.execute()` returns
`SingleAgentRunReport`, which is structurally incompatible. Forcing a cast
or building a fake multi-agent report would be dishonest data in the store.
Single-agent eval is a follow-up: a later stage introduces
`AgentDefinition.evalRules`, which provides the right shape for both modes.

## What's deferred to Stage 25+

- `PostgresEvalStore` — same interface, persistent backing
- `AgentDefinition.evalRules` — per-agent eval rules, enabling single-agent eval
- LLM judge cost limits and per-call budgets
- Eval result diff views in the dashboard (compare two runs)
```

---

## CHANGE 7 — `docs/internal/v3-architecture-snapshot.md`

Locate the table or list of stages. Add an entry after the Stage 23 row:

```markdown
| Stage 24 | Eval architecture | `AgentEvaluator`, `EvalHarness`, `EvalStore`, `DatasetEvaluator`, `LlmJudgeEvaluator` (seam), `agentic.evals.agent-eval` tool, dashboard `/evals` route. Executor constructors refactored to options object. |
```

Match the formatting of the existing rows.

---

## CHANGE 8 — `packages/agentic-ai-infra-core/src/evals/README.md`

Append:

```markdown
## Stage 24 additions

This package now exports:

- `EvalStore` interface — implemented by `InMemoryEvalStore` (runtime)
- `EvalRunRecord` — one persisted eval record with correlation IDs
- `AggregateQualityReport` — normalized shape returned by MCP eval tools
- `EvalDataset`, `EvalDatasetItem`, `EvalAnswerMatchMode` — dataset schema
- `validateEvalDataset(value: unknown)` — hand-rolled validator returning
  `FrameworkResult<EvalDataset>`

The full architecture lives at
`docs/04-core-framework/evaluation-architecture.md`.
```

---

## CHANGE 9 — `packages/agentic-ai-infra-runtime/src/evals/README.md`

Append:

```markdown
## Stage 24 additions

- `InMemoryEvalStore` — ring buffer implementing `EvalStore`
- `RetrievalQualitySuite` — adapter over `runRetrievalQualityEvals`
- `AgentEvaluator` — surfaces history + re-runs rules
- `DatasetEvaluator` — scores datasets against actual run outputs
- `DatasetLoader` — safe filesystem loader with traversal guards
- `LlmJudgeEvaluator` — optional LLM-as-judge, disabled by default

All suites use lazy options providers — input is pulled at `run()` time, not
at construction.
```

---

## CHANGE 10 — `packages/agentic-ai-infra-runtime/src/harness/README.md`

Append:

```markdown
## Stage 24 additions

`EvalHarness` (in `eval-harness.ts`) was added alongside `AgentHarness`. The
two share no implementation — `AgentHarness` is the tool execution security
layer (permission → approval → handler → sanitize → record); `EvalHarness`
registers and dispatches eval suites.

`aggregateReports(reports: readonly QualityReport[]): AggregateQualityReport`
is also exported here for use by MCP eval tool handlers.
```

---

## CHANGE 11 — `STATUS.md`

Prepend the Stage 24 entry above the existing Stage 23 entry. Match the
format of Stage 23. Include:

- Test count: `~416/~416 passing`
- Date: today
- Summary: "Stage 24 — Eval architecture (AgentEvaluator + EvalHarness + EvalStore + DatasetEvaluator + LlmJudgeEvaluator seam + agentic.evals.agent-eval MCP tool + dashboard /evals route + executor refactor to options object)"
- Decisions locked: D11–D17
- CI: build ✓ typecheck ✓ test ✓ lint ✓

---

## CHANGE 12 — `kb.md`

Prepend a Stage 24 section above existing entries. List the D11–D17 decisions
verbatim (copy from the orchestrator's "Hard invariants" section). Add a
"Key files" subsection listing the new files.

---

## CHANGE 13 — `STRUCTURE.md`

Add the new files to the existing directory tree. New paths:

```
packages/agentic-ai-infra-core/src/evals/validator.ts
packages/agentic-ai-infra-runtime/src/evals/eval-store.ts
packages/agentic-ai-infra-runtime/src/evals/retrieval-quality-suite.ts
packages/agentic-ai-infra-runtime/src/evals/agent-evaluator.ts
packages/agentic-ai-infra-runtime/src/evals/dataset-loader.ts
packages/agentic-ai-infra-runtime/src/evals/dataset-evaluator.ts
packages/agentic-ai-infra-runtime/src/evals/llm-judge-evaluator.ts
packages/agentic-ai-infra-runtime/src/harness/eval-harness.ts
examples/eval-data/retrieval-quality.json
examples/eval-data/agent-runtime.json
examples/eval-data/README.md
docs/04-core-framework/evaluation-architecture.md
docs/internal/learning-notes/stage-24-eval-architecture.md
```

Match the existing tree formatting (indentation, tree characters).

---

## SELF-REVIEW CHECKLIST

- [ ] `docs/04-core-framework/evaluation-architecture.md` exists and avoids stage numbers in user-facing prose
- [ ] `docs/internal/learning-notes/stage-24-eval-architecture.md` documents D11–D17 with rationale
- [ ] `docs/07-dashboard/trajectory-and-eval-views.md` describes the new `/evals` route
- [ ] Both example docs updated to the options-object executor syntax
- [ ] `docs/internal/v3-architecture-snapshot.md` has a Stage 24 row
- [ ] All 3 module READMEs updated (core/evals, runtime/evals, runtime/harness)
- [ ] `STATUS.md` has Stage 24 prepended with test count, decisions, CI status
- [ ] `kb.md` has Stage 24 prepended with D11–D17
- [ ] `STRUCTURE.md` lists every new file under its correct directory
- [ ] No new tests added (docs phase)
- [ ] `pnpm run ci` passes — build ✓ typecheck ✓ test ✓ lint ✓
- [ ] No code changes outside docs/README files

---

## WHAT NOT TO DO

- Do NOT add stage numbers (Stage 24, Stage 25) to public docs in
  `docs/04-core-framework/` or `docs/07-dashboard/` — internal-only
- Do NOT reference unimplemented features as if they exist (no claims about
  `PostgresEvalStore`, `AgentDefinition.evalRules`, etc.)
- Do NOT add new test files
- Do NOT modify TypeScript source files in this phase
- Do NOT include exact line numbers in docs — line numbers drift
- Do NOT promise specific Stage 25 features — say "deferred to a later stage"

---

## DONE SIGNAL

```
Stage 24 Phase 11 complete.
Stage 24 complete.
Test count: [N]/[N] passing (target ~416).
CI: build ✓ typecheck ✓ test ✓ lint ✓
Files changed: 13
```
