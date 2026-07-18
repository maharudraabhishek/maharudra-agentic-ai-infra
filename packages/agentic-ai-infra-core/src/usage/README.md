# Usage Import Contracts Module

The usage module defines typed contracts for importing actual provider/client token usage data and reconciling it with framework-estimated visible usage.

## Purpose

Framework token estimates reflect what the context assembly and tool execution pipeline tracked. They do not include hidden provider-side tokens (reasoning, system prompts, streaming overhead). This module provides the contracts for:

1. Importing actual usage exports (OpenAI CSV, Anthropic JSON/CSV, manual JSON/CSV)
2. Storing safe usage records (privacy-respecting, no prompts, no API keys)
3. Reconciling estimated vs actual usage (matched/unmatched, delta analysis)
4. Producing honest per-client comparisons (estimated-only vs actual-imported)

## Main Types

- `ActualUsageImportSource` — union of supported import formats
- `UsageImportConfidence` — confidence level of an imported record (high / estimated / approximate)
- `ActualUsageRecord` — one safe imported usage record; user IDs are hashed or omitted
- `ActualUsageImportBatch` — batch result from one file import
- `ActualUsageImportResult` — parse result with records, errors, and warnings
- `UsageImportParser` — interface for offline per-format parsers (implemented in runtime)
- `UsageImportMapper` — interface for mapping raw row key-value pairs to safe records
- `ReconciliationMatchStatus` — how an entry was matched (run-id, trace-id, timestamp, etc.)
- `UsageReconciliationEntry` — one row in a reconciliation report
- `UsageReconciliationReport` — full report comparing estimated vs actual with delta analysis
- `EstimatedVsActualComparison` — per-client summary with truthfulness labels
- `BenchmarkComparisonMode` — whether to show estimated-only, actual-only, or both
- `UsageImportOptions` — limits and privacy settings for one import operation

## Privacy Rules (Enforced by Implementations)

- Never store prompts, request/response bodies, or API keys.
- Hash or redact user identifiers by default.
- Reject files exceeding `maxFileSizeBytes`.
- Skip and count rows exceeding `maxRows`.
- Return structured errors for malformed rows.

## Relationship Diagram

```txt
  ┌──────────────────────────┐
  │  UsageImportParser       │──── implemented by runtime per-format parsers
  │  (core interface)        │
  └────────────┬─────────────┘
               │ produces
               ▼
  ┌──────────────────────────┐
  │  ActualUsageImportBatch  │
  │  + ActualUsageRecord[]   │──── stored in .agentic-local/usage-imports/
  └────────────┬─────────────┘
               │ fed into
               ▼
  ┌──────────────────────────┐     ┌──────────────────────────┐
  │  reconcileUsage()        │◄────│  TokenEfficiencyReport   │
  │  (runtime function)      │     │  (framework estimates)   │
  └────────────┬─────────────┘     └──────────────────────────┘
               │ produces
               ▼
  ┌──────────────────────────┐
  │  UsageReconciliationReport│
  │  + EstimatedVsActual[]   │──── consumed by dashboard views
  └──────────────────────────┘
```

## Truthfulness Guarantee

- Estimated values are always labeled "framework-estimated visible usage."
- Actual values are always labeled with source, date range, and confidence.
- Deltas are never hidden and always include `possibleCauses` notes.
- No comparison is claimed to represent exact provider billing unless the imported data includes verified cost fields.
