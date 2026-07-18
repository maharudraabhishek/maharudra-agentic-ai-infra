# 2026-05-08 AI Engineer Roadmap

## Why Project-Based Learning

AI engineering is easier to learn when each concept has a job.

Reading about embeddings, RAG, agents, evals, and observability is useful, but the ideas become durable when they solve a real system problem. Rudraloka is the production learning project where those ideas become working infrastructure.

The learning loop is:

1. Build a small useful capability.
2. Explain the mental model.
3. Record the tradeoffs.
4. Add safety checks.
5. Use the result in the next project step.

## AI Concepts vs Production AI Systems

Learning AI concepts means understanding ideas like embeddings, prompts, context windows, and vector search.

Building production AI systems means adding the engineering around those ideas:

- Security boundaries.
- Data freshness.
- Evaluation.
- Observability.
- Rollback.
- Human approval.
- Cost and latency control.
- Safe failure behavior.

An embedding demo can answer a question. A production RAG system must also know what content it is allowed to use, how fresh it is, how to cite it, and what to do when retrieval is weak.

## AI-Assisted Development Layer vs Product AI Layer

Rudraloka has two AI planes.

The AI-assisted development layer helps build the project. The local MCP server lets Codex inspect safe files, propose writes, run allowlisted checks, and run security evals.

The product AI layer will eventually serve Rudraloka users. It may include search, recommendations, support, admin intelligence, and commerce-aware agents.

These planes should stay separate. Local development tools can access a developer workspace. Product AI must use production APIs, approved content, access control, and user confirmation for sensitive actions.

## Why MCP Comes First

MCP comes first because it gives Codex safe tools before the project adds more complex AI systems.

The mental model: before giving an AI assistant more power, build the tool bridge with rails. MCP is that bridge.

## Rudraloka As The Production Learning Project

Rudraloka will grow across frontend, backend, mobile, infrastructure, MCP, RAG, evals, and observability. This makes it a practical learning surface for AI engineering instead of a toy repository.

Future user-facing AI features could include:

- Product recommendations grounded in approved catalog content.
- Admin assistants that summarize operational data.
- Search over help, product, and order knowledge.
- Agentic workflows that prepare actions but require user confirmation before checkout or payment.

