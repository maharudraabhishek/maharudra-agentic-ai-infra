# AI Infrastructure Roadmap

## Purpose

This roadmap describes how Rudraloka can add AI infrastructure first to local development workflows and later to production services. The two environments must stay distinct.

Local dev MCP AI infrastructure helps Codex understand and safely work inside the repository.

Production Rudraloka AI infrastructure supports user-facing or business-facing product behavior.

## Phase 1: Local Safety Foundation

The current local MCP server provides safe reads, controlled writes, allowlisted pnpm checks, and sanitized logs. This is the base layer for future AI development automation.

Do not expose local dev MCP to public ChatGPT web connectors. It has local workstation capabilities by design.

## Phase 2: Eval Harness

Status: first local MCP security eval harness implemented through `run_mcp_security_evals`.

The initial eval harness checks:

- Secret file blocking.
- Path traversal blocking.
- Blocked directory listing.
- Unknown extension blocking.
- Command allowlist blocking.
- Patch approval enforcement.
- New-file overwrite protection.
- Log and audit summary safety.

Evals should be deterministic where possible and runnable through pnpm or MCP-controlled tools. High-risk AI workflows should gain regression tests before they become production dependencies.

## Phase 3: Local Project Indexing

Add local indexing for approved repository content. The indexer must reuse or mirror MCP path policy:

- Block `.env*`, `.npmrc`, keys, tokens, credentials, `.git`, `node_modules`, build output, coverage output, and `.mcp-local`.
- Include only approved text extensions.
- Store deterministic document IDs and metadata.
- Track source file path, content hash, chunk hash, and index version.

Indexing should improve code and documentation search without bypassing the MCP server's safety model.

## Phase 4: Chunking

Chunk source and documentation by structure where possible:

- Markdown by headings.
- TypeScript by exports, functions, classes, and nearby comments when practical.
- Configuration by top-level keys.

Keep chunk IDs deterministic so changed chunks can be re-indexed without rebuilding everything.

## Phase 5: Embeddings And Vector Search

Add embeddings after indexing and chunking are stable. Store embedding model name, dimensions, created time, source hash, and chunk metadata.

Vector search should support metadata filtering by path, content type, package, and trust level. It should also support deletion and re-embedding when source files or embedding models change.

## Phase 6: RAG

Local RAG should retrieve approved project context for Codex while respecting blocked files and trust boundaries. It should cite source paths and prefer exact source content over model memory.

Production RAG should use approved business content, explicit access control, source freshness checks, and safe fallback behavior when retrieval confidence is low.

## Phase 7: Context Window Management

Add ranking, reranking, summarization, and prompt-budget policies. Context selection should prefer recent user intent, relevant source chunks, explicit architecture decisions, and security policy.

Summaries must not smuggle blocked content into model context. If a source is blocked for direct reading, it is also blocked for indexing and summarization.

## Phase 8: Orchestration

Local orchestration should coordinate safe reads, retrieval, patch proposals, checks, and review steps. It should stay deterministic where possible and use explicit approvals for writes.

Production orchestration should use service boundaries, idempotent operations, retries, timeouts, audit trails, and human confirmation for irreversible business actions such as checkout, payment, ordering, or account changes.

## Phase 9: Prompt And Tool Evals

Create eval sets for:

- Tool selection.
- Grounded answers.
- Refusal behavior.
- Patch proposal correctness.
- Retrieval precision and recall.
- Commerce safety rules.
- Regression cases from real incidents.

Use eval results as release signals before expanding tool capabilities or deploying production AI workflows.

## Phase 10: Observability And OpenTelemetry

The local MCP server already uses trace IDs and JSONL logs. Later, add OpenTelemetry-style traces and metrics where they provide real debugging value.

For production, capture latency, cost, token usage, retrieval quality, tool calls, refusal rates, error rates, and business outcome metrics. Redact or avoid sensitive payloads by default.

## Production AI Services Later

Production Rudraloka AI should evolve as separate services rather than as an exposed local dev MCP server. Future production services may include:

- Retrieval/indexing service.
- Embedding pipeline.
- Vector search service.
- Prompt orchestration service.
- Evaluation service.
- AI observability pipeline.
- Commerce-safe recommendation service.

Architecture choices for these services should be presented as options with tradeoffs, a recommendation, and a user decision point before implementation.

