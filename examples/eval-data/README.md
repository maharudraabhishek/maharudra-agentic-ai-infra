# Eval Datasets — Sample Format

This directory holds JSON eval datasets consumed by `DatasetEvaluator`.

## Schema (version 1)

Required fields per item: `id`, `question`, `expectedChunks`, `expectedAnswer`,
`expectedToolCalls`.

Optional fields: `tags`, `difficulty`, `matchMode`, `tokenBudget`, `metadata`.

Top-level: `version` (must be `1`), `name`, optional `description`, `items` array.

Example item:

```json
{
  "id": "stable-unique-identifier",
  "question": "input fed to the system under eval",
  "expectedChunks": ["chunk-id-1"],
  "expectedAnswer": "expected string",
  "expectedToolCalls": ["agentic.retrieval.search"],
  "tags": ["security"],
  "difficulty": "easy",
  "matchMode": "substring",
  "tokenBudget": 4000,
  "metadata": { "source": "your-source", "createdAt": "2026-05-22" }
}
```

## Match modes

- `substring` (default) — case-insensitive substring match after whitespace
  normalization
- `exact` — case-sensitive exact match after trim
- `semantic` — delegated to the optional LLM-judge evaluator; skipped when the
  LLM judge is not registered

## Security

- Do NOT include PII, secrets, API keys, or production data
- Datasets are read by the framework but never logged or transmitted

## Adding new datasets

Drop a `.json` file in this directory. The dataset loader rejects path
traversal — filenames must be plain (no `/`, `\`, `..`).
