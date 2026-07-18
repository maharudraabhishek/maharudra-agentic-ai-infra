# Local Knowledge Scanner And Chunking

## Purpose

Milestone 2 adds a safe way to preview what Rudraloka could index later.

The scanner and chunkers are local MCP developer tools. They are not production RAG. Milestone 2 used them for preview only; Milestone 3 reuses the same policy and chunkers for manual mock indexing into the local AI DB.

## What The Tools Do

- `preview_project_knowledge_scan` shows approved files, skipped files, hashes, source types, and skip reasons.
- `preview_project_chunks` shows short bounded previews of chunks for one approved file.
- `run_knowledge_pipeline_evals` checks the scanner and chunker guardrails.
- `index_project_knowledge` uses the scanner/chunker output to store mock embeddings in the local AI DB after migrations are applied.
- `get_project_knowledge_index_status` returns safe counts and run metadata for that local index.

```txt
approved source paths
   |
   v
scanner metadata
   |
   v
chunk preview
   |
   v
human review
```

This diagram shows the review loop. The tools let you inspect the future indexing inputs before embeddings or storage exist.

## What The Tools Do Not Do

The preview tools do not:

- write to source files
- write chunks to Postgres
- create embeddings
- run vector search
- run full-text search
- retrieve context for answers
- call paid providers

The Milestone 3 indexing tool still does not call paid providers, run retrieval, run full-text search, mutate source files, or expose full chunks/vectors. Its only write target is the local AI DB RAG index.
- read `.env*`, `.npmrc`, keys, tokens, credentials, `.git`, `node_modules`, `dist`, `build`, `coverage`, or `.mcp-local`

## Approved Sources

The indexing policy allows:

- `AGENTS.md`
- `CLAUDE.md`
- `.agents/skills/**/SKILL.md`
- `docs/**/*.md`, excluding `docs/99-archive/` by default
- `mcp/rudraloka-dev-mcp/src/**/*.ts`

`docs/99-archive/` is excluded by default so old historical notes do not pollute current context.

## Safety Limits

The MCP config defines conservative local limits:

- `MAX_KNOWLEDGE_SCAN_FILES`
- `MAX_KNOWLEDGE_FILE_BYTES`
- `MAX_KNOWLEDGE_CHUNKS_PER_FILE`
- `MAX_CHUNK_PREVIEW_CHARS`
- `DEFAULT_FALLBACK_CHUNK_CHARS`
- `DEFAULT_FALLBACK_CHUNK_OVERLAP_CHARS`

These limits prevent huge scans, large file reads, excessive memory use, and oversized MCP responses.

## Manual Workflow

1. Add the new tool names to Codex `enabled_tools`.
2. Restart Codex or the MCP client so the tool list reloads.
3. Run `preview_project_knowledge_scan` with:

```json
{
  "scope": "docs-and-mcp",
  "includeArchived": false
}
```

4. Run `preview_project_chunks` on `AGENTS.md`.
5. Run `preview_project_chunks` on one MCP TypeScript file such as `mcp/rudraloka-dev-mcp/src/server.ts`.
6. Run `run_knowledge_pipeline_evals`.

## Expected Results

The scan report should contain metadata only:

- file paths
- source types
- file hashes
- content hashes
- sizes
- archive flags
- skip reasons

It should not contain full file contents.

Chunk previews should contain short previews only. The full chunk text is kept inside the local function call and is not returned as a large raw dump.

## Troubleshooting

If a file is skipped, check the `skipReason`.

Common reasons:

- `archive-excluded`: the file is under `docs/99-archive/` and archive inclusion is off.
- `blocked-directory`: the path includes a blocked folder such as `node_modules`.
- `blocked-sensitive-path`: the path looks like a secret, token, credential, private key, `.env*`, or `.npmrc`.
- `unsupported-extension`: the file extension is not allowed for knowledge preview.
- `too-large`: the file exceeds `MAX_KNOWLEDGE_FILE_BYTES`.
- `not-in-allowed-roots`: the file is safe to exist in the repo but is not part of the approved knowledge source list.

## Verification

After changing MCP source code, run:

```powershell
pnpm --filter rudraloka-dev-mcp run typecheck
pnpm --filter rudraloka-dev-mcp run build
pnpm --filter rudraloka-dev-mcp run lint
pnpm --filter rudraloka-dev-mcp run test
```

Then restart Codex/MCP before expecting newly registered tools to appear.

When the restarted MCP server exposes the updated tool list, run `run_mcp_security_evals` and confirm it still passes.
