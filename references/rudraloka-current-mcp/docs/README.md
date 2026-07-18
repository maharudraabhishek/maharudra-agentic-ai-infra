# Rudraloka Engineering Docs

This folder is the engineering knowledge base for Rudraloka. It explains how the system is built, why decisions were made, how local AI-assisted development works, and how future production AI infrastructure should evolve.

Use these docs as docs-as-code: keep them versioned, reviewed, and updated when the project changes. New engineers should be able to start here and build a clear mental model before running commands.

## Recommended Reading Order

1. [00-start-here/](00-start-here/)
2. [01-learning-journal/](01-learning-journal/)
3. [02-architecture/](02-architecture/)
4. [03-mcp/](03-mcp/)
5. [04-ai-infra/](04-ai-infra/)
6. [05-security/](05-security/)
7. [06-runbooks/](06-runbooks/)

## Folder Guide

[00-start-here/](00-start-here/) is the project front door. Read it first for project goals, current status, and the AI development operating system.

[01-learning-journal/](01-learning-journal/) captures learning from day 1. These notes explain concepts, examples, diagrams, and tradeoffs in simple language before commands or prompts, including the [local MCP hardening note](01-learning-journal/2026-05-09-local-mcp-hardening.md), the [Codex and Claude compatibility note](01-learning-journal/2026-05-09-codex-claude-compatibility.md), the [agentic context RAG design note](01-learning-journal/2026-05-09-agentic-context-rag-design.md), the [local pgvector runtime note](01-learning-journal/2026-05-09-local-pgvector-runtime.md), the [local AI DB schema and migrations note](01-learning-journal/2026-05-09-local-ai-db-schema-and-migrations.md), the [final local MCP AI hardening note](01-learning-journal/2026-05-10-final-local-mcp-ai-hardening.md), and the [final local MCP quality gate note](01-learning-journal/2026-05-11-final-local-mcp-quality-gate.md).

[02-architecture/](02-architecture/) contains platform architecture, service folder strategy, and architecture decision records.

[03-mcp/](03-mcp/) documents the local Rudraloka MCP server, controlled writes, observability, the [MCP hardening checklist](03-mcp/mcp-hardening-checklist.md), and security eval harness.

[04-ai-infra/](04-ai-infra/) covers the AI infrastructure roadmap, RAG, embeddings, vector search, eval concepts, local MCP AI plans, the [local MCP agentic context RAG design spec](04-ai-infra/local-mcp-agentic-context-rag-design-spec.md), the [retrieval benchmark quality gate](04-ai-infra/retrieval-benchmark-quality-gate.md), the local pgvector runtime under [infra/local-dev/postgres-pgvector/](../infra/local-dev/postgres-pgvector/README.md), and the completed local MCP AI hardening layer.

[05-security/](05-security/) contains security policy, rationale, MCP-specific safeguards, the [local MCP AI security checklist](05-security/local-mcp-ai-security-checklist.md), [prompt-injection defense](05-security/prompt-injection-defense.md), and the [dependency security audit policy](05-security/dependency-security-audit.md).

[06-runbooks/](06-runbooks/) contains practical operational guides for Codex, Claude Code compatibility, MCP Inspector, troubleshooting, the [local pgvector runtime](06-runbooks/local-pgvector-runtime.md), [local AI DB migrations](06-runbooks/local-ai-db-migrations.md), [local MCP AI infrastructure operations](06-runbooks/local-mcp-ai-infra-operations.md), and the [final local MCP quality gate](06-runbooks/final-local-mcp-quality-gate.md), including the [Claude Code compatibility runbook](06-runbooks/claude-code-compatibility.md).

[99-archive/](99-archive/) keeps historical notes and temporary verification docs separate from current source-of-truth docs.

## Documentation Principles

- Explain why before how.
- Use simple examples and mental models.
- Document tradeoffs, not only final choices.
- Preserve architecture decisions explicitly.
- Keep current docs separate from historical docs.
- Update docs after major architecture, MCP, security, or AI infra changes.
- Prefer links from index docs to detailed docs instead of duplicating full content.

## How Codex Should Use These Docs

Codex should read the relevant docs before making changes. For example, MCP changes should start with `AGENTS.md`, [05-security/mcp-security-policy.md](05-security/mcp-security-policy.md), and the relevant files under [03-mcp/](03-mcp/).

For architecture or process choices, Codex should explain concepts and tradeoffs first, give a recommendation separately, and wait for the user to choose before writing detailed implementation prompts or making changes.
