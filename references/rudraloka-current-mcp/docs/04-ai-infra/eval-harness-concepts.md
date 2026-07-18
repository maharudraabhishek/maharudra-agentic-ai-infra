# Eval Harness Concepts

## What An Eval Harness Is

An eval harness is a repeatable way to test behavior.

For AI systems, behavior can include model outputs, tool choices, refusals, retrieval quality, and safety rules.

## Unit Tests vs AI Evals

Unit tests check deterministic code.

Example: `assertAllowedPnpmScript` rejects an unknown script.

AI evals check behavior that may involve prompts, retrieval, model judgment, and tool use.

Example: a product recommendation agent refuses to invent inventory or price.

## Local MCP Security Evals

The current local MCP eval harness checks security behavior around tools:

- Block secrets.
- Block traversal.
- Enforce command allowlists.
- Enforce approval text.
- Keep log summaries safe.

These evals are close to unit tests because they exercise deterministic policy functions and services.

## Future Local RAG And Planner Evals

Local RAG evals should check whether approved project knowledge retrieval finds the expected sources and avoids forbidden sources.

Planner evals should check whether the context planner chooses the right strategy for the task.

```txt
Eval query
   |
   v
Retriever / planner
   |
   v
Returned sources + strategy
   |
   v
Assertions
   |-- expected source found
   |-- forbidden source absent
   |-- context size acceptable
   `-- strategy matches task
```

This diagram shows that retrieval quality and planning quality can be tested separately from model prose quality.

Example local evals:

- A patch approval question should retrieve controlled-write docs and patch service code.
- A no-secret-indexing question should retrieve `AGENTS.md` and the MCP security policy.
- An architecture decision question should retrieve the architecture-decision skill and architecture docs.
- A Claude compatibility question should retrieve `CLAUDE.md` and the Claude compatibility runbook.

## Future Product AI Evals

Future product AI evals should check:

- Recommendations use approved content.
- Prices come from APIs or databases.
- Inventory comes from APIs or databases.
- Checkout requires explicit confirmation.
- Retrieval cites the right sources.
- The model refuses when context is missing.

## Rudraloka Example

Suppose a user asks:

```txt
Recommend a premium incense bundle under $50.
```

The eval should check that:

- Product names come from approved catalog content.
- Prices come from the product API or database.
- Out-of-stock items are not recommended.
- Claims are grounded.
- Checkout is not triggered without confirmation.

## Related Docs

- [Local MCP Agentic Context Engineering + RAG Design Spec](local-mcp-agentic-context-rag-design-spec.md)
- [Agentic Context Engineering And RAG Design](../01-learning-journal/2026-05-09-agentic-context-rag-design.md)
