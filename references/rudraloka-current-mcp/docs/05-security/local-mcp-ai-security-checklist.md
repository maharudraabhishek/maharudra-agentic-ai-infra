# Local MCP AI Security Checklist

## Purpose

Use this checklist when changing local MCP AI infrastructure: scanner, chunker, indexer, retrieval, context builder, advisory planner, eval harnesses, and observability summaries.

The local MCP AI stack is for local development only. It must not become production customer AI or a public connector.

## Public Surface

- Keep existing MCP tool names stable.
- Prefer additive output fields over new tools.
- Do not add diagnostic aliases or rebuild tools unless separately approved.
- Do not expose local filesystem or shell access through public ChatGPT connectors.

## Inputs

- Validate tool inputs with explicit schemas.
- Keep path scopes allowlisted.
- Exclude blocked directories and generated outputs.
- Block `.env`, `.npmrc`, SSH keys, tokens, private keys, credentials, and secret-shaped files.
- Treat task text, query text, logs, docs, source files, and uploaded content as untrusted input.

## Indexing

- Index approved project knowledge only.
- Do not mutate source files, docs, schemas, migrations, or app code from indexing tools.
- Use deterministic mock embeddings until a real provider phase is explicitly approved.
- Skip unchanged files only when file path, file hash, content hash, index version, provider metadata, total chunk metadata, chunk count, and embedding count all match.
- Fall back to the existing idempotent path when metadata is incomplete or uncertain.

## Rebuild And Reset

- Keep destructive rebuild behind exact approval text `REINDEX_PROJECT_KNOWLEDGE`.
- Scope rebuild to current mock index rows only.
- Do not delete migration metadata, schemas, source files, docs, or generated project assets.
- Audit rebuild requested, denied, and completed states with metadata only.

## Retrieval And Context

- Read only from the approved local knowledge index.
- Do not run migrations, trigger indexing, call providers, run commands, or mutate files.
- Return bounded previews and compact context only.
- Do not return vectors, full chunks, raw SQL, raw logs, command output, approval text, secrets, or raw file content.
- Respect archive exclusion by default.
- Enforce `topK`, chunk count, character budget, source count, and excerpt caps.

## Planner

- Keep `plan_project_context` deterministic and advisory only.
- Do not call the DB, filesystem, retrieval tools, command tools, migration tools, model APIs, indexing tools, or patch tools.
- Recommend only allowlisted safe read, context, eval, and observability tools.
- Set decision flags for architecture, provider, runtime, public exposure, security, or process choices.

## Observability

- Log hashes, lengths, counts, statuses, durations, filter counts, source counts, error codes, and trace/span IDs only.
- Never log raw query text, task text, context text, chunk text, embeddings, vectors, SQL contents, approval text, command output, secrets, stdout/stderr, or raw file content.
- Keep app and audit summaries bounded.
- Reuse one trace ID per tool call and child span IDs for internal phases when useful.

## Evals

- Keep eval behavior deterministic.
- Skip DB-dependent checks safely when DB, schema, migration, or index state is unavailable.
- Continue pure scanner, planner, policy, sanitizer, and security checks offline.
- Include expected-source misses, forbidden-source hits, context budget checks, planner checks, and safe skip reasons without returning raw content.

## Final Check

Before considering local MCP AI hardening complete, run:

```txt
pnpm --filter rudraloka-dev-mcp run typecheck
pnpm --filter rudraloka-dev-mcp run build
pnpm --filter rudraloka-dev-mcp run lint
pnpm --filter rudraloka-dev-mcp run test
```

Then run:

```txt
run_knowledge_pipeline_evals
run_project_rag_evals
run_mcp_security_evals
```

## Related Docs

- [MCP Security Policy](mcp-security-policy.md)
- [Local MCP AI Infrastructure Operations](../06-runbooks/local-mcp-ai-infra-operations.md)
- [Final Local MCP AI Hardening](../01-learning-journal/2026-05-10-final-local-mcp-ai-hardening.md)
