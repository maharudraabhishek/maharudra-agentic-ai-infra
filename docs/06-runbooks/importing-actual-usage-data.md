# Importing Actual Usage Data

This runbook walks through importing provider/client usage export files into the framework for dashboard comparison.

## Prerequisites

- Dashboard is enabled in your generated project (`--dashboard` passed to `init`).
- Project has been built: `pnpm --dir tools/agentic/mcp-server build`.
- You have a usage export file from your provider (see export instructions below).

## Step 1: Obtain Your Usage Export

### OpenAI / Codex

1. Sign in to [platform.openai.com](https://platform.openai.com).
2. Go to **Usage** → **Export** (or via the API: `GET /v1/usage`).
3. Download as CSV. The file will have columns including `date`, `model`, `n_context_tokens_total`, `n_generated_tokens_total`.
4. Save as `./usage/openai-usage.csv`.

### Anthropic / Claude

**Option A — API JSON export:**
1. Call the Anthropic usage API and save the response JSON.
2. Save as `./usage/claude-usage.json`.

**Option B — Console CSV export:**
1. Sign in to [console.anthropic.com](https://console.anthropic.com).
2. Go to **Usage** → **Export**.
3. Download as CSV. The file will have columns including `date`, `model`, `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`.
4. Save as `./usage/claude-usage.csv`.

**Option C — Manual JSON:**
Maintain your own JSON array:

```json
[
  {
    "provider": "anthropic",
    "client": "claude-code",
    "model": "claude-sonnet-4-6",
    "run_id": "run-abc123",
    "trace_id": "trace-xyz",
    "input_tokens": 4000,
    "output_tokens": 1100,
    "total_tokens": 5100,
    "timestamp": "2024-01-15T10:00:00Z",
    "cost": 0.0156,
    "currency": "USD"
  }
]
```

## Step 2: Run the Import

From the generated project root:

```powershell
# OpenAI CSV
pnpm --dir tools/agentic/mcp-server import-usage --source openai-csv --file ./usage/openai-usage.csv

# Anthropic JSON
pnpm --dir tools/agentic/mcp-server import-usage --source anthropic-usage-api-json --file ./usage/claude-usage.json

# Anthropic CSV
pnpm --dir tools/agentic/mcp-server import-usage --source anthropic-csv --file ./usage/claude-usage.csv

# Manual JSON
pnpm --dir tools/agentic/mcp-server import-usage --source manual-json --file ./usage/my-usage.json

# Manual CSV
pnpm --dir tools/agentic/mcp-server import-usage --source manual-csv --file ./usage/my-usage.csv
```

The importer:
- Reads the file you provide (no network calls)
- Strips all unsafe content (prompts, bodies, API keys)
- Hashes user identifiers by default
- Writes a safe JSON batch to `.agentic-local/usage-imports/`
- Prints a summary to stderr

### Privacy Options

```powershell
# Redact user identifiers instead of hashing
--redact-user-ids

# Skip all user identifier handling (raw value stored — use carefully)
--no-hash-user-ids

# Limit rows parsed
--max-rows 5000
```

## Step 3: View in Dashboard

Start the dashboard and open the browser:

```powershell
pnpm --dir tools/agentic/mcp-server dashboard
# open http://127.0.0.1:8788
```

After import, the dashboard shows:

- **Actual Usage Imports** — record count, total actual tokens, sources, cost summary (if available)
- **Estimated vs Actual Reconciliation** — matched runs, unmatched counts, total delta

## Troubleshooting

**"No parser registered for source"**
Check the `--source` value. Supported: `openai-csv`, `anthropic-usage-api-json`, `anthropic-csv`, `manual-json`, `manual-csv`, `generic-csv`.

**"CSV produced no data rows"**
The CSV may have a non-standard header row or be empty. Open the file and verify the first row is a header with at least one of: `total_tokens`, `input_tokens`, `n_context_tokens_total`.

**"Failed to parse JSON"**
Verify the JSON file is valid with a JSON linter. The file must be a JSON array `[...]` or an object with a `data` array `{ "data": [...] }`.

**All records show zero tokens**
The column names in your file may not match the expected names. Check the column format reference in [actual-usage-imports.md](../07-dashboard/actual-usage-imports.md).

**Large delta in reconciliation**
This is expected when the import uses daily aggregates (confidence: `approximate`). Daily aggregates span multiple framework runs and cannot be matched per-run. See [estimated-vs-actual-token-usage.md](../07-dashboard/estimated-vs-actual-token-usage.md) for possible delta causes.

**Import data not appearing in dashboard**
The `DashboardDataProvider` must be updated to load batches from `.agentic-local/usage-imports/` and pass them to `buildUsageImportSummary` and `reconcileUsage`. Check the generated `dashboard.ts` entrypoint and the runtime dashboard provider.

## Security Notes

- Never import files that contain API keys, secrets, or prompt content.
- The importer strips known unsafe columns but cannot guarantee third-party export formats are safe.
- Review any CSV or JSON file before importing it into a production project environment.
- Imported data is stored locally and gitignored by default. Do not manually commit `.agentic-local/usage-imports/` files.

## Related Documentation

- [docs/07-dashboard/actual-usage-imports.md](../07-dashboard/actual-usage-imports.md)
- [docs/07-dashboard/estimated-vs-actual-token-usage.md](../07-dashboard/estimated-vs-actual-token-usage.md)
- [docs/06-runbooks/benchmarking-codex-vs-claude-code.md](benchmarking-codex-vs-claude-code.md)
