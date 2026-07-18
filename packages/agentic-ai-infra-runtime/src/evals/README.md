# Evals Module

The evals module provides deterministic framework-level checks.

## Functions

- `runAgentRuntimeEvals`: checks required roles, forbidden tools, context duplication, token budget, and safe trajectory metadata.

## Flow

```txt
┌─────────────────────────────────┐
│ Multi-Agent Report + Trajectory │
└──────────────┬──────────────────┘
               ▼
┌─────────────────────────────────┐
│ Eval Helpers                    │
└──────────────┬──────────────────┘
               ▼
┌─────────────────────────────────┐
│ QualityReport                   │
└─────────────────────────────────┘
```

## Stage 24 additions

- `InMemoryEvalStore` — ring buffer implementing `EvalStore`
- `RetrievalQualitySuite` — adapter over `runRetrievalQualityEvals`
- `AgentEvaluator` — surfaces history + re-runs rules
- `DatasetEvaluator` — scores datasets against actual run outputs
- `DatasetLoader` — safe filesystem loader with traversal guards
- `LlmJudgeEvaluator` — optional LLM-as-judge, disabled by default

All suites use lazy options providers — input is pulled at `run()` time, not
at construction.
