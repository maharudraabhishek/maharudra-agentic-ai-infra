# Phase 1 Notes - MCP Infrastructure

## Status

These notes describe the first read-only MCP foundation. The current local MCP server has since expanded to controlled writes, allowlisted pnpm scripts, security evals, and sanitized observability summaries.

For the current design, see:

- `../03-mcp/local-mcp-architecture.md`
- `../05-security/mcp-security-policy.md`

## What Was Built

Created a secure local STDIO MCP server:

- `project_info`
- `safe_list_files`
- `safe_read_file`

## Package Manager

This project uses pnpm.

## Workspace Name

The root workspace is:

```txt
rudraloka-workplace
```

## Security Decisions

- Read-only first.
- No arbitrary command execution.
- No write access.
- No secret file access.
- No path traversal.
- No public HTTP exposure.

## Why STDIO

STDIO is preferred for local development MCP servers because:

- It does not open a public network port.
- It runs as a child process of the AI client.
- It has a smaller attack surface than HTTP.
- It is easier to keep local filesystem tools private.

