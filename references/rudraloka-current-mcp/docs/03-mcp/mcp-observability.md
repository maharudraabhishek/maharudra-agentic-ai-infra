# MCP Observability

## Logs vs Audit Logs

App logs describe tool execution metadata: which tool ran, operation type, status, duration, and safe metadata.

Audit logs record security-relevant decisions: write attempts, patch applications, command attempts, and eval runs.

The two logs answer different questions:

- App log: "What happened operationally?"
- Audit log: "What security-relevant action was attempted?"

## Core Fields

`timestamp` records when the event happened.

`traceId` links related events from one tool call.

`spanId` identifies a specific operation.

`operationType` describes the kind of operation, such as `read`, `command`, `patch_apply`, or `eval`.

`status` records `attempt`, `success`, `denied`, or `error`.

`durationMs` records how long the operation took.

## Why stdout Is Not Used For Logs

STDIO MCP uses stdout for protocol messages. If the server writes normal logs to stdout, it can corrupt the MCP protocol stream.

Operational logs should go to local JSONL files. Human-readable diagnostics should not be mixed into stdout.

## Log Size Protection

Local JSONL logs are append-only, so they need a size boundary.

Before appending, the MCP server checks the current log file size. If the file is over the configured threshold, it keeps one rotated backup:

- `app.jsonl` becomes `app.1.jsonl`
- `audit.jsonl` becomes `audit.1.jsonl`

This is intentionally simple for local development. The goal is to avoid unbounded `.mcp-local/` growth without adding dependencies or writing logs to stdout.

## Raw Logs Vs Safe Summaries

Raw app and audit logs live under blocked local state. They are internal CCTV footage: useful for debugging and investigations, but too detailed to expose directly to an AI client.

`audit_read_summary` and `log_read_summary` are redacted incident reports. They return only an allowlisted set of fields such as timestamps, trace IDs, tool names, operation status, safe file paths, package/script names, IDs, hashes, exit codes, and bounded messages.

This output filtering matters even when older JSONL records contain unsafe key names. A summary reader must sanitize on output, not assume every historical log line was written by the newest logger code.

## MCP Response Content Vs File Content

MCP tool responses naturally use a protocol wrapper named `content`. That wrapper is not the same thing as unsafe file `content` or proposal bodies.

Security checks should inspect the sanitized summary event payloads, not fail just because the MCP protocol response has a top-level `content` field containing text.

## What Logs Must Not Contain

Logs and audit summaries must not contain:

- File contents.
- Patch bodies.
- New-file contents.
- Command stdout or stderr.
- Approval text.
- Secrets or secret-shaped values.

The goal is useful observability without turning logs into another source of sensitive data.

## Summary Sanitization

Summary tools use defensive allowlist sanitization. Forbidden fields such as `content`, `originalText`, `replacementText`, `stdout`, `stderr`, `rawPatch`, `fileContent`, `text`, `commandOutput`, `fullContent`, and `patchBody` must never appear in `audit_read_summary` or `log_read_summary` output.

If a future tool needs another summary field, add it deliberately to the allowlist, document why it is safe, and update eval coverage.
