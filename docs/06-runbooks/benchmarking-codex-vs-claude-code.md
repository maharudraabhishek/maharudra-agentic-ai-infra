# Benchmarking Codex vs Claude Code Token Usage

This runbook explains how to compare token usage between Codex and Claude Code using the framework's benchmark comparison feature.

## Important: What Can and Cannot Be Compared

The framework tracks what it assembles. It cannot directly measure what a provider bills.

| Metric | Available without import | Available after import |
| --- | --- | --- |
| Framework-estimated context tokens | Yes | Yes |
| Shared-context savings estimate | Yes | Yes |
| Per-run actual billed tokens | No | Yes (if import includes run_id) |
| Per-day actual billed tokens | No | Yes (daily aggregates) |
| Hidden reasoning tokens | No | Yes (only if provider exposes them) |
| Exact cost per run | No | Yes (if import includes cost) |

## Comparison Modes

Three modes control what is shown in `buildEstimatedVsActualComparisons`:

### `estimated-only` (default before import)

Shows framework-estimated visible token counts for each client label. All values are labeled "Estimated visible framework tokens". No actual data is needed.

Use this to compare how much context the framework assembled for Codex-style runs vs Claude Code-style runs, based on your framework session records.

### `estimated-vs-actual` (after import)

Shows both estimated and actual data side by side. Clients without imported actual data are included but labeled `hasActualData: false`.

Use this when you have import files for at least one client.

### `actual-imported-only`

Shows only clients that have imported actual data. Clients with no import file are omitted entirely.

Use this when you want a clean comparison based only on provider-reported numbers.

## Step-by-Step Comparison

### 1. Label Your Framework Runs by Client

When recording token usage in framework runs, set the `client` field to distinguish Codex runs from Claude Code runs:

```typescript
tokenRecorder.recordUsage({
  traceId: session.traceId,
  runId: session.runId,
  scope: "shared-context",
  task: { taskType: "architecture-review" },
  toolName: undefined,
  agentRole: "orchestrator",
  usage: { inputTokens: 3000, outputTokens: 800, totalTokens: 3800 }
});
```

The client label comes from the run metadata. Ensure runs include `client: "codex"` or `client: "claude-code"` in their context so reconciliation can group them correctly.

### 2. Export Usage from Each Provider

**Codex (OpenAI):**
Export a CSV from the OpenAI usage dashboard covering the same period as your Codex sessions.

**Claude Code (Anthropic):**
Export a JSON or CSV from the Anthropic console covering the same period as your Claude Code sessions.

### 3. Import Both Files

```powershell
pnpm --dir tools/agentic/mcp-server import-usage --source openai-csv --file ./usage/codex-usage.csv
pnpm --dir tools/agentic/mcp-server import-usage --source anthropic-usage-api-json --file ./usage/claude-code-usage.json
```

### 4. View the Dashboard

Open `http://127.0.0.1:8788`. The **Actual Usage Imports** and **Estimated vs Actual Reconciliation** panels show aggregate metrics for both clients.

For per-client breakdowns, use the `/data.json` endpoint and call `buildEstimatedVsActualComparisons(report, "estimated-vs-actual")` in your consumer code.

## Interpreting the Delta

A positive delta (actual > estimated) means the provider billed more than the framework tracked. Common causes:

| Cause | Codex impact | Claude impact |
| --- | --- | --- |
| System prompt tokens | OpenAI system prompts are billed but not tracked | Anthropic system prompts are billed but not tracked |
| Reasoning tokens | o1/o3 models have high reasoning overhead | Extended thinking tokens add significant overhead |
| Daily granularity of export | High — daily CSV may include unrelated calls | High — same |
| Missing run_id in export | Only daily exports are available by default | Same |

A negative delta (actual < estimated) is unusual. It may indicate that the framework's heuristic token counter is overestimating, or that the imported data covers a subset of runs.

## Honesty Labels in Output

The `EstimatedVsActualComparison` output for each client always includes `notes`. Example:

**Codex (estimated only, no import yet):**
```
notes:
  - "Estimated visible framework tokens only."
  - "Hidden provider system/reasoning tokens are not included."
  - "Import actual usage data to enable a real comparison."
```

**Claude Code (after import):**
```
notes:
  - "Imported actual provider/client usage."
  - "Delta may include hidden system/reasoning/client overhead."
```

Never report framework-estimated numbers as Codex or Claude Code's actual consumption unless actual import data exists.

## Limitations

- **No automatic API import**: The importer reads files you provide. It does not call the OpenAI or Anthropic API directly. This is intentional; API import would require credential handling outside the framework's security boundary.
- **Daily aggregate granularity**: Most export CSVs are per-day aggregates, not per-run. Strong run-level matching requires `run_id` in the export, which is only available via the API response format.
- **Reasoning tokens**: OpenAI's o-series and Anthropic's extended thinking tokens may or may not appear in export files depending on your plan and API version.

## Related Documentation

- [docs/07-dashboard/actual-usage-imports.md](../07-dashboard/actual-usage-imports.md)
- [docs/07-dashboard/estimated-vs-actual-token-usage.md](../07-dashboard/estimated-vs-actual-token-usage.md)
- [docs/06-runbooks/importing-actual-usage-data.md](importing-actual-usage-data.md)
- [docs/06-runbooks/token-efficiency-debugging.md](token-efficiency-debugging.md)
