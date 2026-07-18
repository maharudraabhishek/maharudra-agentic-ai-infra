# Actual Usage Imports

The framework can import actual token usage data from external provider/client export files and display it alongside framework-estimated visible usage in the dashboard.

## Why Import Actual Usage?

Framework token estimates are computed from context assembly and tool execution tracking. They do not include:

- Provider-side reasoning tokens
- Provider-billed system prompt tokens
- Streaming overhead or retry costs
- Tokens from context not assembled by the framework

Importing actual usage data from provider exports lets you compare what the framework tracked with what the provider billed, and identify the sources of any gap.

## Supported Import Formats

| Source key | Format | Provider |
| --- | --- | --- |
| `openai-csv` | OpenAI usage dashboard CSV | OpenAI / Codex |
| `anthropic-usage-api-json` | Anthropic usage API JSON response | Anthropic / Claude |
| `anthropic-csv` | Anthropic console CSV export | Anthropic / Claude |
| `manual-json` | User-maintained JSON array | Any |
| `manual-csv` | User-maintained CSV | Any |
| `generic-csv` | Generic CSV with at least one token count column | Any |

## Import Command

Generated projects with the dashboard enabled include an `import-usage` script. Run it from the generated project root:

```powershell
pnpm --dir tools/agentic/mcp-server import-usage --source openai-csv --file ./usage/openai-usage.csv
pnpm --dir tools/agentic/mcp-server import-usage --source anthropic-usage-api-json --file ./usage/claude-usage.json
pnpm --dir tools/agentic/mcp-server import-usage --source manual-csv --file ./usage/my-usage.csv
```

All import operations are offline. No network calls are made. The importer reads the file you provide and writes a safe JSON batch to `.agentic-local/usage-imports/`.

### Import Options

| Flag | Description | Default |
| --- | --- | --- |
| `--source <format>` | Required. Source format key. | — |
| `--file <path>` | Required. Path to the export file. | — |
| `--max-rows <n>` | Maximum rows to parse. | 10,000 |
| `--no-hash-user-ids` | Skip hashing user identifier columns. | Hash by default |
| `--redact-user-ids` | Replace user identifiers with `[redacted]`. | Off |

## What Fields Are Imported

Safe fields extracted from each row:

- `provider`, `client`, `model`
- `projectId`, `workspaceId`
- `taskType`, `runId`, `traceId`
- `timestamp`, `dateRange`
- `inputTokens`, `outputTokens`, `totalTokens`
- `cacheReadTokens`, `cacheWriteTokens` (when available)
- `reasoningTokens` (only when explicitly in the export — never inferred)
- `cost`, `currency` (when available)
- `confidence` — `high` for per-request exports, `approximate` for daily aggregates

## What Is NOT Imported

These fields are stripped before any record is saved:

- `prompt` / `completion` / `message` / `content` / `text`
- `request` / `response` / `body` / `payload`
- `api_key` / `secret` / `password`
- `email` / `user_email` (treated as an unsafe column — stripped entirely)
- User identifiers (`user_id`, `userid`, `account_id`, etc.) are hashed by default

## Stored Data Location

Imported batches are stored as safe JSON files under:

```
.agentic-local/usage-imports/
```

This folder is gitignored by default. Imported usage data is never committed to source control unless you explicitly move or copy the files.

## Column Format Reference

### OpenAI CSV (`openai-csv`)

Expected columns (from the OpenAI usage dashboard export):

```
date, model, n_requests, n_context_tokens_total, n_generated_tokens_total, operation
```

Records are per-day aggregates; confidence is `approximate`.

### Anthropic JSON (`anthropic-usage-api-json`)

Accepts both a raw JSON array and an object with a `data` array:

```json
[
  { "model": "claude-sonnet-4-6", "input_tokens": 4000, "output_tokens": 1100, "timestamp": "..." }
]
```

or:

```json
{ "data": [ ... ] }
```

`cache_creation_input_tokens` maps to `cacheWriteTokens`. `cache_read_input_tokens` maps to `cacheReadTokens`. Confidence is `high` for per-request records.

### Anthropic CSV (`anthropic-csv`)

Expected columns (from the Anthropic console export):

```
date, model, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens
```

Records are per-day aggregates; confidence is `approximate`.

### Manual JSON / Manual CSV (`manual-json`, `manual-csv`, `generic-csv`)

Flexible formats. Required: at least one of `input_tokens`, `output_tokens`, or `total_tokens`. Optional but useful: `provider`, `client`, `model`, `run_id`, `trace_id`, `task_type`, `cost`, `currency`.

Standard header names (all lowercase, underscored):

```
provider, client, model, run_id, trace_id, task_type,
input_tokens, output_tokens, total_tokens,
cache_read_tokens, cache_write_tokens, reasoning_tokens,
cost, currency, timestamp
```

## Confidence Levels

| Value | When used |
| --- | --- |
| `high` | Per-request records from authoritative provider API responses |
| `estimated` | Records from manual files or inferred fields |
| `approximate` | Daily/monthly aggregated exports where per-run granularity is lost |

## Related Documentation

- [estimated-vs-actual-token-usage.md](estimated-vs-actual-token-usage.md) — reconciliation and delta analysis
- [docs/06-runbooks/importing-actual-usage-data.md](../06-runbooks/importing-actual-usage-data.md) — step-by-step import walkthrough
- [docs/06-runbooks/benchmarking-codex-vs-claude-code.md](../06-runbooks/benchmarking-codex-vs-claude-code.md) — Codex vs Claude comparison modes
