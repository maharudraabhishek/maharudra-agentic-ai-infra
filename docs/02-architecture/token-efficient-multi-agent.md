# Token-Efficient Multi-Agent Architecture

Token-efficient multi-agent execution gives each routed role enough evidence without duplicating the full context for every role.

```txt
┌────────────────────────────┐
│ Task Text Used Transiently │
└──────────────┬─────────────┘
               ▼
┌────────────────────────────┐
│ taskHash + taskType        │
└──────────────┬─────────────┘
               ▼
┌────────────────────────────┐
│ Retrieve Context Once      │
└──────────────┬─────────────┘
               ▼
┌────────────────────────────┐
│ Shared Context Packet      │
└──────────────┬─────────────┘
               ├── manager slice
               ├── security-reviewer slice
               ├── architecture-reviewer slice
               ├── implementation-planner slice
               ├── eval-reviewer slice
               └── docs-reviewer slice
```

## Deterministic Execution

The executor is provider-free. It does not call external LLMs, model SDKs, tokenization SDKs, or network services. Role outputs are structured deterministic review and planning summaries based on local rules and context slice metadata.

## Routing

The router selects only required roles. Security, tool, migration, and runtime tasks route to `security-reviewer`; architecture and provider choices route to `architecture-reviewer`; implementation tasks route to `implementation-planner`; test and eval tasks route to `eval-reviewer`; docs tasks route to `docs-reviewer`.

## Budget Flow

```txt
┌───────────────────────┐
│ Shared Context Tokens │
└───────────┬───────────┘
            ▼
┌───────────────────────┐
│ Role Slice Budgets    │
└───────────┬───────────┘
            ▼
┌───────────────────────┐
│ Agent Output Budgets  │
└───────────┬───────────┘
            ▼
┌───────────────────────┐
│ Synthesis Budget      │
└───────────┬───────────┘
            ▼
┌───────────────────────┐
│ Hard Budget Check     │
└───────────────────────┘
```

The token report compares estimated naive duplicated-context cost with actual shared-context cost.
