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

```txt
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
