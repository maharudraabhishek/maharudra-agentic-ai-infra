# MCP Inspector Testing

## Why Project Root Matters

MCP Inspector can start the server from a directory that is not the Rudraloka workspace. If `RUDRALOKA_PROJECT_ROOT` is not set, the server may resolve the wrong project root.

Set:

```powershell
$env:RUDRALOKA_PROJECT_ROOT = "C:\Users\abhi1\react\rudraloka-workplace"
```

## Run MCP Inspector

Use the existing MCP Inspector workflow for your environment and make sure the server command points at `rudraloka-dev-mcp`.

Use pnpm commands only for project scripts.

## Test project_info

Call:

```txt
project_info
```

Confirm the project root is:

```txt
C:\Users\abhi1\react\rudraloka-workplace
```

## Test Controlled Write

Use a harmless docs file when testing controlled writes.

Expected flow:

1. Call `propose_file_patch`.
2. Review the preview.
3. Call `apply_approved_patch` only with exact `APPLY_PATCH:<patchId>` text.
4. Run typecheck/build if MCP source changed.

## Test Security Evals

Call:

```txt
run_mcp_security_evals
```

Input:

```json
{}
```

Expected result: JSON report with `status` set to `passed` when all expected-denial checks succeed.

