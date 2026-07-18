---
name: architecture-decision
description: Use when making Rudraloka architecture decisions or comparing system designs. Presents options with pros, cons, and tradeoffs; never decides for the user; includes a separate recommendation and an explicit decision point.
---

# Architecture Decision

Use this skill when the user needs help deciding between architecture approaches.

## Grounding

Start by identifying:

- The decision being made.
- Current constraints from the repository, `AGENTS.md`, and any user-provided requirements.
- What is known, unknown, and assumption-dependent.
- Whether the decision affects local development, production systems, or both.

Use pnpm-only language when commands or package workflows are relevant.
Explain concepts, mental models, examples, and tradeoffs before implementation prompts.

## Response Structure

Present the decision in this order:

1. Context.
2. Option A with pros, cons, and tradeoffs.
3. Option B with pros, cons, and tradeoffs.
4. Option C with pros, cons, and tradeoffs when a third path is genuinely relevant.
5. Recommendation as lead engineer.
6. User decision point.

Keep the recommendation separate from the decision. Do not present it as final authority, and do not implement until the user chooses an option or explicitly asks for a default.
Do not provide detailed implementation prompts before the user chooses an option.

## Evaluation Criteria

Consider:

- Security and least privilege.
- Operational complexity.
- Local developer experience.
- Production deployability.
- Testability and observability.
- Data ownership and service boundaries.
- Scalability and distributed systems implications.
- Migration path and rollback strategy.
- Cost and maintenance burden.

## Decision Hygiene

Avoid false precision. If important data is missing, name what would change the decision. Prefer reversible choices when requirements are still forming.

## Documentation

After the user chooses, record durable decisions in `docs/02-architecture/architecture-decisions.md`. If the decision teaches an important concept, add or update a learning note in `docs/01-learning-journal/`.

Learning notes should be detailed and beginner-friendly. Include what the concept means, why it matters, a simple mental model, a practical Rudraloka example, flow or architecture diagrams when useful, tradeoffs, common mistakes, how it connects to existing architecture, and related links.

Architecture docs and decision records should include system, component, service communication, deployment, or boundary diagrams when useful. Prefer beginner-friendly ASCII diagrams first; use Mermaid when the flow is complex and the target doc supports it. Add a short explanation below every diagram.

Do not provide detailed implementation prompts before the user chooses an option. Explain options and tradeoffs first, record the decision after the choice, then provide implementation steps.
