# MCP Security Eval Harness

## What It Is

The MCP security eval harness is a repeatable local test suite exposed through `run_mcp_security_evals`.

Mental model: it is a security drill for the MCP server. It checks that unsafe requests still fail closed.

## Currently Implemented Tests

The current suite checks:

- Secret file blocking.
- Path traversal blocking.
- Blocked directory listing.
- Unknown extension blocking.
- Command allowlist blocking.
- Patch approval enforcement.
- New-file overwrite protection.
- Log and audit summary safety.

## Why Expected Denials Count As Passes

Most evals intentionally ask for unsafe behavior.

For example, reading `.env` should fail. Listing `node_modules` should fail. Applying a patch with wrong approval text should fail.

Those denials are the success condition.

Summary sanitization is similar. If old or synthetic log records contain fields such as `originalText`, `replacementText`, `content`, `stdout`, or `stderr`, the safe summary output should omit those fields. That omission is a pass because the model-facing summary stayed redacted.

## Log And Audit Summary Safety

The `log-audit-summary-safety` check inspects sanitized summary event payloads from `audit_read_summary` and `log_read_summary`.

It does not treat the normal MCP protocol response wrapper named `content` as unsafe by itself. The unsafe case is file content, patch bodies, command output, or proposal text appearing inside summary event objects.

The eval also exercises synthetic legacy records so old unsafe JSONL shapes remain filtered on output even after the logger implementation changes.

## How To Run In MCP Inspector

Start MCP Inspector with the correct `RUDRALOKA_PROJECT_ROOT` environment variable. Then call:

```txt
run_mcp_security_evals
```

Use empty input:

```json
{}
```

If the project root is wrong, path checks and temp-file behavior may point at the wrong workspace.

## How To Run From Codex

After Codex reloads the MCP server and the tool is enabled, ask Codex to call `run_mcp_security_evals` with empty input.

The output is a JSON report with suite status, totals, and per-check results.

## When To Run

Run the eval harness after MCP refactors, security policy changes, write workflow changes, command policy changes, or observability changes.

The eval harness does not replace code review, but it catches important policy regressions quickly.

