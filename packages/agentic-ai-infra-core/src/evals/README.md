# Evals Contracts Module

The evals module defines typed quality and diagnostic report shapes.

## Main Types

- `EvalStatus` describes pass, warning, or failure status.
- `EvalFinding` describes one bounded diagnostic finding.
- `EvalReport` groups findings and metadata for a named check.

## Call Flow

```txt
┌──────────────────────────┐
│ Runtime Or Package Check │
└─────────────┬────────────┘
              ▼
┌──────────────────────────┐
│ Eval Findings            │
└─────────────┬────────────┘
              ▼
┌──────────────────────────┐
│ EvalReport               │
└─────────────┬────────────┘
              ▼
┌──────────────────────────┐
│ Safe Diagnostic Output   │
└──────────────────────────┘
```

Eval reports should be bounded summaries. They are not a channel for raw files, raw SQL, secrets, or command output.

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
