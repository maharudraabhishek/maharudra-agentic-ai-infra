# Troubleshooting

## Wrong Project Root In MCP Inspector

Symptom: `project_info` shows an unexpected project root.

Cause: MCP Inspector started the server from the wrong working directory.

Fix: set `RUDRALOKA_PROJECT_ROOT` before starting Inspector:

```powershell
$env:RUDRALOKA_PROJECT_ROOT = "C:\Users\abhi1\react\rudraloka-workplace"
```

## spawn EINVAL On Windows

Symptom: command execution fails with a Windows spawn error.

Cause: Windows command shims and shell invocation can be tricky.

Fix: keep command execution inside the MCP allowlisted pnpm runner. Do not add arbitrary shell execution.

## packageManager pnpm@latest Error

Symptom: package manager metadata causes tool or install confusion.

Cause: `pnpm@latest` can be less deterministic than a pinned version.

Fix: prefer explicit pnpm versioning when the workspace is ready to pin package manager metadata.

## TypeScript node:path Or node:fs/promises Type Error

Symptom: TypeScript cannot resolve Node built-in modules.

Cause: Node types may not be included in `tsconfig.json`.

Fix: ensure the MCP package TypeScript config includes Node types.

## rootDir/outDir TypeScript Warning

Symptom: TypeScript warns about inferred root with `outDir`.

Cause: `outDir` is set without a clear source root.

Fix: keep `rootDir` set to `src` and `include` scoped to `src`.

## Codex Extension Not Showing MCP

Symptom: `/mcp` does not show `rudraloka-dev-mcp`.

Causes:

- Global config not updated.
- Codex not restarted.
- Tool not listed in `enabled_tools`.
- MCP server build is stale.

Fix: update config, run build, restart Codex, and check `/mcp` again.

## Forgot To Run Build After MCP Source Changes

Symptom: TypeScript source changed but Codex still sees old tool behavior.

Cause: built `dist/` output is stale.

Fix:

```powershell
pnpm --filter rudraloka-dev-mcp run build
```

## run_mcp_security_evals Not Visible

Symptom: the eval tool is not available in Codex.

Likely cause: `enabled_tools` was not updated or Codex was not restarted after the tool was added.

Fix: add `run_mcp_security_evals` to enabled tools, rebuild the MCP package, and restart Codex.

