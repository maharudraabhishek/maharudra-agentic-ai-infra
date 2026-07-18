# Codex MCP Setup

## Why Global Config Is Preferred

The current preferred setup uses Codex global MCP config so the local Rudraloka MCP server is available consistently across Codex sessions.

Global config path:

```txt
C:\Users\abhi1\.codex\config.toml
```

## enabled_tools

When MCP tools are added, `enabled_tools` must include the tool name before Codex can use it.

Current important tools include:

- `project_info`
- `safe_list_files`
- `safe_read_file`
- `propose_file_patch`
- `apply_approved_patch`
- `propose_new_file`
- `apply_approved_new_file`
- `run_allowed_pnpm_script`
- `audit_read_summary`
- `log_read_summary`
- `run_mcp_security_evals`
- `check_local_ai_db`
- `get_local_ai_migration_status`
- `run_local_ai_migrations`
- `preview_project_knowledge_scan`
- `preview_project_chunks`
- `run_knowledge_pipeline_evals`
- `index_project_knowledge`
- `get_project_knowledge_index_status`

After adding new MCP tools in source, update the global Codex `enabled_tools` list manually. Do not edit global config through the local MCP server.

For Milestone 2 knowledge preview, add these entries:

```toml
"preview_project_knowledge_scan",
"preview_project_chunks",
"run_knowledge_pipeline_evals",
```

For Milestone 3 mock indexing, also add:

```toml
"index_project_knowledge",
"get_project_knowledge_index_status",
```

These tools do not enable retrieval or context planning. They allow manual mock indexing and safe index status only.

## Restart Codex

After changing MCP config or adding new MCP tools, restart Codex so it reloads the tool list.

## Verify MCP

In Codex, verify MCP availability with:

```txt
/mcp
```

Then check whether `rudraloka-dev-mcp` and the expected tools are visible.

## After MCP Source Changes

After changing MCP source code:

1. Run `pnpm --filter rudraloka-dev-mcp run typecheck`.
2. Run `pnpm --filter rudraloka-dev-mcp run build`.
3. Restart the MCP client session.
4. Confirm new tools are visible.
