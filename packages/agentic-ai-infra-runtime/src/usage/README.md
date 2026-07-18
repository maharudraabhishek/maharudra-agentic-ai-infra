# Usage Import Runtime Module

Offline parsers, reconciliation logic, and dashboard summary builders for actual provider/client usage import.

## Responsibility

This module implements the `UsageImportParser` interface from core for each supported format. It never makes network calls, never reads API keys, and never stores prompts, request bodies, or user emails.

## Main Exports

| Export | Type | Purpose |
| --- | --- | --- |
| `OpenAICsvParser` | Class | Parses OpenAI usage dashboard CSV exports |
| `AnthropicCsvParser` | Class | Parses Anthropic console CSV exports |
| `AnthropicUsageApiJsonParser` | Class | Parses Anthropic usage API JSON responses |
| `ManualCsvParser` | Class | Parses user-maintained or generic CSV files |
| `ManualJsonParser` | (via `getUsageImportParser`) | Parses user-maintained JSON arrays |
| `getUsageImportParser(source)` | Function | Resolves the right parser for a format string |
| `importActualUsage(content, fileName, opts)` | Function | Main entry point: parse + return result |
| `reconcileUsage(estimated, actualBatches)` | Function | Match estimated runs to actual records |
| `buildEstimatedVsActualComparisons(report, mode)` | Function | Per-client summaries with truthfulness labels |
| `buildUsageImportSummary(batches)` | Function | Dashboard-ready import totals |
| `buildReconciliationSummary(report)` | Function | Dashboard-ready reconciliation totals |

## Supported Formats

| Source | Format | Notes |
| --- | --- | --- |
| `openai-csv` | OpenAI usage dashboard CSV | Per-day aggregated; `n_context_tokens_total` + `n_generated_tokens_total` |
| `anthropic-usage-api-json` | Anthropic usage API JSON | Per-request or per-day; `cache_creation_input_tokens` mapped to cache fields |
| `anthropic-csv` | Anthropic console CSV | Per-day aggregated; `cache_creation_input_tokens` + `cache_read_input_tokens` |
| `manual-json` | User-maintained JSON array | Flexible; any object with at least one token count field |
| `manual-csv` | User-maintained CSV | Generic headers; must include at least one token count column |
| `generic-csv` | Generic CSV | Same as manual-csv; use when no specific format applies |

## Privacy Rules

- User identifier columns (`user_id`, `userid`, `user`, `account_id`, etc.) are SHA-256 hashed by default (16 hex chars). Set `redactUserIds: true` to replace them with `[redacted]` instead.
- Unsafe columns (`prompt`, `completion`, `message`, `content`, `api_key`, `secret`, etc.) are stripped before any record is built.
- Files exceeding `maxFileSizeBytes` (default 10 MB) are rejected before parsing.
- Data rows exceeding `maxRows` (default 10,000) are skipped and counted.

## Reconciliation Priority

```txt
  1. Exact runId match          → matchStatus: "matched-run-id"        (strong)
  2. Exact traceId match        → matchStatus: "matched-trace-id"       (strong)
  3. Timestamp ±5 min window    → matchStatus: "matched-timestamp-window" (weak)
  4. client + model label match → matchStatus: "matched-client-model"   (weak)
  5. No match (estimated side)  → matchStatus: "unmatched-estimated"
  6. No match (actual side)     → matchStatus: "unmatched-actual"
```

Weak matches are always labeled in the report. The `possibleCauses` field on `UsageReconciliationReport` always explains why deltas may exist, so consumers cannot mistake estimates for exact billing figures.

## Call Flow

```txt
  importActualUsage(content, fileName, options)
        │
        ▼
  getUsageImportParser(options.source)
        │
        ▼  (e.g. OpenAICsvParser)
  parser.parse(content, fileName, options)
        │  parseCsvWithMapper / ManualJsonParser
        ▼
  ActualUsageImportResult { ok, batch, errors, warnings }
        │
        │  (batch stored as JSON in .agentic-local/usage-imports/)
        │
        ▼
  reconcileUsage(estimatedRecords, [batch])
        │
        ▼
  UsageReconciliationReport
        │
        ▼
  buildEstimatedVsActualComparisons(report, mode)
        │
        ▼
  EstimatedVsActualComparison[] → dashboard views
```
