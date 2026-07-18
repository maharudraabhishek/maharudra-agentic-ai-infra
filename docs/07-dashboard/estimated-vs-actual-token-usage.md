# Estimated vs Actual Token Usage

The dashboard displays two distinct types of token counts. Understanding the difference is important for interpreting dashboard numbers accurately.

## Two Token Measurement Types

```txt
  Framework-Estimated Visible Usage
  ──────────────────────────────────
  What the framework tracked:
  - Context assembly tokens
  - Retrieval result tokens
  - Tool input/output estimates
  - Shared context savings vs naive estimate

  Imported Actual Provider/Client Usage
  ──────────────────────────────────────
  What the provider billed:
  - All of the above PLUS:
  - System prompt tokens (not tracked by framework)
  - Reasoning/chain-of-thought tokens (not always exposed)
  - Streaming overhead and retry costs
  - Client-side context not assembled by the framework
```

Framework estimates and actual provider usage are always labeled separately. The dashboard never presents framework-estimated numbers as exact billing figures.

## Reconciliation

When actual usage data is imported, `reconcileUsage()` matches estimated framework runs to actual records.

### Matching Priority

```txt
  1. runId exact match              → "matched-run-id"            (strongest)
  2. traceId exact match            → "matched-trace-id"          (strong)
  3. Timestamp ±5 min window        → "matched-timestamp-window"  (weak)
  4. client + model label match     → "matched-client-model"      (weak)
  5. No match found (estimated side) → "unmatched-estimated"
  6. No match found (actual side)   → "unmatched-actual"
```

Weak matches are reported but their delta values should be interpreted cautiously. When multiple weak matches are possible for the same actual record, the first match found is used.

### Why Unmatched Records Occur

**Unmatched estimated runs** — The run completed without an import file covering that time range, or the import used a different granularity (e.g. daily aggregates that span multiple runs).

**Unmatched actual records** — The actual export covers time periods or models for which no framework run exists (e.g. imported data from before the project used this framework, or API calls made outside the framework).

## Dashboard Reconciliation Panel

The Reconciliation panel in the dashboard shows aggregate metrics:

| Metric | Meaning |
| --- | --- |
| Matched runs | Estimated runs successfully correlated to an actual record |
| Unmatched estimated | Estimated runs with no matching actual record |
| Unmatched actual | Actual records with no matching estimated run |
| Estimated visible tokens | Framework-tracked token total |
| Imported actual tokens | Sum of totalTokens from imported records |
| Token delta | Actual minus estimated (positive = actual exceeded estimate) |
| Delta % | Delta as percentage of estimated total |

## Codex vs Claude Code Comparison Modes

Three benchmark comparison modes are available:

| Mode | What it shows |
| --- | --- |
| `estimated-only` | Framework-estimated tokens for each client. No actual data needed. All values labeled "estimated". |
| `actual-imported-only` | Only clients that have imported actual data are shown. Clients without actual data are omitted. |
| `estimated-vs-actual` | Both sides shown. Clients without actual data are included but labeled `hasActualData: false`. |

### Truthfulness Labels

Every per-client comparison in `EstimatedVsActualComparison` includes a `notes` array. These notes always explain:

- Whether the numbers are estimated, actual, or partial
- That delta may include hidden provider-side tokens
- That large deltas may indicate granularity mismatch

### When Only One Client Has Actual Data

If Codex data is imported but Claude Code data is not, the comparison shows:

- Codex: actual imported data with delta analysis
- Claude Code: framework estimates only, labeled accordingly

Never fabricate actual usage for a client that has no imported data.

## Possible Delta Causes

The reconciliation report always includes a `possibleCauses` field. Common causes:

| Cause | Typical impact |
| --- | --- |
| Hidden reasoning tokens | High for o1/o3 models; not visible to framework |
| Provider system prompt | Always billed; not tracked by framework |
| Streaming/retry overhead | Small; varies by provider plan |
| Daily aggregated imports | Large; may span multiple unrelated runs |
| Missing runId/traceId | Prevents strong matching; weak matches may pair wrong records |
| Framework-external API calls | Any calls made directly to the API outside the framework |

## Cost Summary

The dashboard shows a cost summary panel only when imported records include cost fields. Framework estimates never include a cost projection because:

- Token-to-cost rates change over time and by provider plan
- Cached token discounts vary by API tier
- Batch API pricing differs from real-time pricing

Cost display is always labeled "imported actual cost" and shows the currency from the import file.

## Related Documentation

- [actual-usage-imports.md](actual-usage-imports.md) — how to import usage data and supported formats
- [docs/06-runbooks/importing-actual-usage-data.md](../06-runbooks/importing-actual-usage-data.md)
- [docs/06-runbooks/benchmarking-codex-vs-claude-code.md](../06-runbooks/benchmarking-codex-vs-claude-code.md)
