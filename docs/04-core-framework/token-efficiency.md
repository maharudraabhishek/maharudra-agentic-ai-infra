# Token Efficiency

Token efficiency is a runtime and observability concern.

## Components

- `HeuristicTokenCounterProvider`: deterministic local estimate.
- `TokenBudgetManager`: hard budget enforcement and role budget lookup.
- `TokenUsageRecorder`: safe usage records for tools, agents, shared context, and synthesis.
- `TokenEfficiencyReport`: total usage, tool breakdown, shared-context estimate, and savings.

## Overflow

When context is too large, lower-priority context is trimmed before role slices are built. If total usage exceeds the hard budget, the runtime returns a typed failure.

```txt
┌───────────────────┐
│ Candidate Context │
└─────────┬─────────┘
          ▼
┌──────────────────────────┐
│ Heuristic Token Estimate │
└─────────┬────────────────┘
          ▼
Within budget?
├── Yes → Record safe token usage
└── No
    ▼
    Trim lower-priority context
    ▼
    Within hard budget?
    ├── Yes → Record safe token usage
    └── No → Typed budget failure
```

## Safe Records

Token records store task hash and safe task type only. They do not store raw task text, approval text, full chunks, vectors, raw SQL, stack traces, or command output.
