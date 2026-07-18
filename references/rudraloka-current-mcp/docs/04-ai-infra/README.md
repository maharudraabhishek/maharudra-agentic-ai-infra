# AI Infrastructure

This folder explains Rudraloka's AI infrastructure roadmap and concepts.

Read in this order:

1. [ai-infra-roadmap.md](ai-infra-roadmap.md)
2. [rag-embeddings-vector-search.md](rag-embeddings-vector-search.md)
3. [eval-harness-concepts.md](eval-harness-concepts.md)
4. [local-mcp-ai-infra-plan.md](local-mcp-ai-infra-plan.md)
5. [local-mcp-agentic-context-rag-design-spec.md](local-mcp-agentic-context-rag-design-spec.md)
6. [retrieval-benchmark-quality-gate.md](retrieval-benchmark-quality-gate.md)
7. [Local pgvector runtime README](../../infra/local-dev/postgres-pgvector/README.md)
8. [Local AI DB migrations runbook](../06-runbooks/local-ai-db-migrations.md)
9. [Local project context planner runbook](../06-runbooks/local-project-context-planner.md)
10. [Local MCP AI infrastructure operations runbook](../06-runbooks/local-mcp-ai-infra-operations.md)
11. [Final local MCP quality gate runbook](../06-runbooks/final-local-mcp-quality-gate.md)

Keep local development AI infrastructure separate from production Rudraloka AI infrastructure.

Context engineering is the umbrella for deciding what information an AI assistant should see. RAG is the retrieval foundation underneath it. The current target for local MCP AI infrastructure is agentic context engineering: a planner chooses when to retrieve project knowledge, read exact files, include security/architecture docs, inspect evals, or ask the user for a decision.

Related learning note:

- [Agentic Context Engineering And RAG Design](../01-learning-journal/2026-05-09-agentic-context-rag-design.md)
- [Local pgvector Runtime](../01-learning-journal/2026-05-09-local-pgvector-runtime.md)
- [Local AI DB Schema And Migrations](../01-learning-journal/2026-05-09-local-ai-db-schema-and-migrations.md)
- [Agentic Context Planner](../01-learning-journal/2026-05-10-agentic-context-planner.md)
- [Final Local MCP AI Hardening](../01-learning-journal/2026-05-10-final-local-mcp-ai-hardening.md)
- [Final Local MCP Quality Gate](../01-learning-journal/2026-05-11-final-local-mcp-quality-gate.md)

Related runbook:

- [Local pgvector Runtime Runbook](../06-runbooks/local-pgvector-runtime.md)
- [Local AI DB Migrations Runbook](../06-runbooks/local-ai-db-migrations.md)
- [Local Project Context Planner Runbook](../06-runbooks/local-project-context-planner.md)
- [Local MCP AI Infrastructure Operations Runbook](../06-runbooks/local-mcp-ai-infra-operations.md)
- [Final Local MCP Quality Gate](../06-runbooks/final-local-mcp-quality-gate.md)
