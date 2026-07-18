# Agent Modes And Token Efficiency

Token efficiency is core product architecture.

## Agent Modes

- Single-agent mode: one assistant uses compact, task-specific context.
- Token-efficient multi-agent mode: multiple agents work with narrow, bounded context slices derived from one shared context packet.

## Context Budget Principles

- Retrieve only what the task needs.
- Prefer summaries and citations over bulk context.
- Use exact reads for critical files.
- Keep security and architecture policy available when relevant.
- Track cost, latency, retrieval quality, and eval signals for dashboard visibility.

```txt
┌──────┐
│ Task │
└──┬───┘
   ▼
┌──────────────────┐
│ Context Strategy │
└────────┬─────────┘
         ├── Exact files ─────┐
         ├── Retrieval ───────┤
         ├── Policy docs ─────┤
         └── Summaries ───────┘
                              ▼
                    ┌───────────────────────┐
                    │ Bounded Agent Context │
                    └───────────────────────┘
```

The dashboard makes context and token tradeoffs visible instead of hidden.
