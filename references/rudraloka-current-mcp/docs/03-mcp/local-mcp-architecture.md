# Local MCP Architecture

## Purpose

`mcp/rudraloka-dev-mcp` is Rudraloka's local development MCP server. It gives Codex controlled access to project metadata, safe reads, controlled writes, allowlisted pnpm checks, repeatable security evals, and sanitized observability.

It is a developer tool, not a production API and not a public ChatGPT web connector.

## Current Architecture

Codex or VS Code starts the MCP server locally and communicates over STDIO.

The server is:

```txt
mcp/rudraloka-dev-mcp
```

The entrypoint in `src/server.ts` stays thin. It registers tools and connects the STDIO transport.

## STDIO Design

STDIO is the right default for a local development MCP server because it does not open a public port and the MCP client owns process startup.

Operational logs must not go to stdout. In STDIO MCP, stdout is reserved for protocol messages. Writing diagnostic logs to stdout can corrupt the protocol stream.

Fatal startup errors may go to stderr because the process cannot safely continue with a partially initialized policy state.

## Layers

The tool layer in `src/tools/` defines MCP tool names, descriptions, input schemas, and response shapes.

The security layer in `src/security/` validates project paths, blocked names, allowed extensions, command allowlists, writable paths, proposal IDs, and exact approval text.

The service layer in `src/services/` performs file reads, patch proposal handling, new-file proposal handling, and allowlisted pnpm script execution after policy checks pass.

The observability layer in `src/observability/` creates trace IDs, app logs, audit events, and sanitized summaries.

The eval layer in `src/evals/` runs local policy regression checks against the same security and service functions used by MCP tools.

Configuration in `src/config/mcp-config.ts` centralizes server identity, project root, size limits, blocked paths, allowed extensions, writable paths, and local state paths.

## Local State

The server stores internal state under `.mcp-local/`:

- Patch proposals.
- New-file proposals.
- Audit JSONL events.
- App JSONL events.

Normal read and list tools block `.mcp-local/`. Use `audit_read_summary` and `log_read_summary` for bounded sanitized views instead of reading internals directly.

## Current Tools

`project_info` returns safe metadata about the project root, controlled-write mode, read limits, blocked directories, blocked files, allowed extensions, and registered tools.

`safe_list_files` lists immediate children of a safe project-relative directory.

`safe_read_file` reads small allowlisted text files.

`propose_file_patch` creates an exact-replacement patch proposal for an allowlisted writable file.

`apply_approved_patch` applies a proposed patch only when the approval text exactly matches `APPLY_PATCH:<patchId>`.

`propose_new_file` creates a new-file proposal for an allowlisted path whose parent already exists.

`apply_approved_new_file` creates a proposed file only when approval text exactly matches `APPLY_NEW_FILE:<proposalId>`.

`run_allowed_pnpm_script` runs only allowlisted pnpm scripts for allowlisted packages. It is not a generic shell.

`audit_read_summary` returns bounded audit metadata without patch bodies, secrets, file contents, or command output.

`log_read_summary` returns bounded sanitized app-log metadata without patch bodies, secrets, approval text, file contents, stdout, or stderr.

`run_mcp_security_evals` runs the local security eval harness and returns a structured JSON report.

`check_local_ai_db` checks local AI DB connectivity and pgvector availability with fixed queries.

`get_local_ai_migration_status` returns local AI DB migration metadata without exposing SQL contents.

`run_local_ai_migrations` runs reviewed migration files from `infra/db/local-ai/migrations/` only when approval text exactly equals `RUN_LOCAL_AI_MIGRATIONS`. It does not accept arbitrary SQL.

`preview_project_knowledge_scan` returns the Milestone 2 knowledge scanner report with safe metadata and hashes only.

`preview_project_chunks` returns bounded chunk previews for one indexable file. It does not return huge raw chunks, create embeddings, or write to the database.

`run_knowledge_pipeline_evals` runs read-only scanner/chunker evals for the Milestone 2 knowledge pipeline.

`index_project_knowledge` manually indexes approved project knowledge into the local AI DB with deterministic mock embeddings only.

`get_project_knowledge_index_status` returns safe local index counts and run metadata only.

`search_project_knowledge` searches the approved local knowledge index with mock pgvector search, Postgres full-text search, metadata filters, and heuristic reranking.

`get_relevant_context` builds compact bounded context from the approved local knowledge index.

`run_project_rag_evals` runs retrieval, context, and planner evals with DB-dependent checks skipped safely when the DB or index is not ready.

`plan_project_context` returns deterministic advisory context planning. It does not call the DB, read files, run retrieval, call models, execute commands, run migrations, index knowledge, apply patches, or mutate source files.

## Local Dev MCP vs ChatGPT-Safe HTTPS MCP

The local MCP server can read project files, propose writes, apply approved writes, and run allowlisted pnpm scripts. Those are local workstation capabilities.

Do not expose this server to ChatGPT web or public connectors.

A future ChatGPT-safe MCP server must be separate:

- HTTPS transport.
- Authentication.
- Business-safe tools only.
- No local filesystem access.
- No shell or general command execution.
- Production-grade rate limits, audit, and authorization.
