---
name: ai-infra-design
description: Use when designing Rudraloka AI infrastructure including RAG, embeddings, vector databases, chunking, context-window management, orchestration, eval harnesses, and AI observability. Separates local dev MCP AI infrastructure from production Rudraloka AI infrastructure.
---

# AI Infra Design

Use this skill for AI infrastructure design, especially RAG, embeddings, vector storage, orchestration, evaluations, and observability.

## Separate The Two Planes

Always distinguish between:

- Local dev MCP AI infrastructure: tools for safe local development, repo automation, controlled file access, patch workflows, and developer assistance.
- Production Rudraloka AI infrastructure: customer-facing or business-facing AI systems, service deployments, data pipelines, retrieval services, evals, monitoring, and governed runtime behavior.

Do not treat the local MCP server as the production AI control plane unless the user explicitly chooses that architecture after reviewing tradeoffs.
Explain concepts, mental models, examples, and tradeoffs before implementation prompts.
Do not provide detailed implementation prompts before the user chooses an option.

For large AI infrastructure subsystems, create design/spec documentation before implementation. The spec should describe goals, non-goals, data flow, security policy, eval strategy, observability, tool contracts, implementation phases, and open decisions.

Context engineering is the umbrella for selecting the right information for the model. RAG is the retrieval layer inside that umbrella. Agentic planning can orchestrate retrieval, exact file reads, safe tool use, security/architecture context, eval checks, and user decision points.

## Design Areas

Cover the relevant parts of the system:

- Retrieval model: source documents, trust boundaries, freshness, grounding, citations, and fallback behavior.
- Embeddings: model choice, versioning, dimensions, batching, re-embedding strategy, and metadata.
- Vector database: tenancy, filters, access control, migrations, backup, deletion, and cost.
- Local AI runtime setup: document folder location, start/stop/reset workflow, memory/cost tradeoffs, local-vs-production boundaries, and future expansion points before adding dependent implementation.
- Chunking: boundaries, overlap, metadata, document structure, deterministic IDs, and reprocessing.
- Context management: prompt budget, ranking, reranking, compression, memory, and refusal behavior.
- Orchestration: tool boundaries, retries, idempotency, approval gates, and deterministic workflows where possible.
- Evaluations: golden sets, regression tests, hallucination checks, retrieval metrics, safety tests, and release gates.
- Observability: traces, model inputs/outputs, redaction, audit events, latency, cost, and quality signals.
- Provider strategy: when the user does not want paid provider usage, prefer a provider interface plus a mock provider first, then introduce local or hosted providers only after explicit approval.

## Security And Product Rules

- Keep secrets, credentials, private keys, and `.env*` files out of AI-accessible context.
- Do not require API keys, paid provider usage, or env-file changes for a design phase unless the user explicitly approves that implementation path.
- Do not create `.env` files for local AI infrastructure runtimes unless the user explicitly approves that secret-management path.
- Ground product claims in approved content.
- Source prices, inventory, and availability from databases or APIs, not model guesses.
- Require explicit user confirmation for checkout, payment, ordering, or irreversible business actions.
- Log security-relevant decisions without exposing secrets or sensitive payloads.

## Output Shape

Provide a design that calls out assumptions, recommended defaults, open decisions, and validation steps. Use pnpm only when package commands are relevant.

## Documentation

Use the numbered docs structure consistently:

- Learning notes belong in `docs/01-learning-journal/`.
- AI infra docs belong in `docs/04-ai-infra/`.
- Architecture decisions belong in `docs/02-architecture/architecture-decisions.md`.

When the user learns about RAG, embeddings, chunking, vector databases, eval harnesses, orchestration, context window management, observability, or local-vs-production AI infra, add or update a detailed beginner-friendly learning note in `docs/01-learning-journal/`.

Learning notes should explain the concept, why it matters, a simple mental model, a practical Rudraloka example, flow or architecture diagrams when useful, tradeoffs, common mistakes, how it connects to existing architecture, and related links to `docs/04-ai-infra/` or architecture docs.

AI infra docs should include pipeline diagrams for chunking, embeddings, vector search, RAG, context engineering, evals, observability, and orchestration when useful. Prefer beginner-friendly ASCII diagrams first; use Mermaid when the flow is complex and the target doc supports it. Add a short explanation below every diagram.

Do not only write prompts or commands. Explain the AI infrastructure concept before implementation details.
