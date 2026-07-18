# Token Contracts Module

The token module defines budget contracts used by retrieval, context, dashboard, and agent workflow code.

## Main Types

- `TokenBudgetConfig` defines total, context, response, and reserve token limits.
- `TokenEfficiencyConfig` enables token-efficient behavior and stores the active budget.
- `ToolTokenUsageBreakdown` attributes token estimates to tools.
- `TokenEfficiencyReport` includes shared-context estimates and savings.

## Call Flow

```txt
┌───────────────────────┐
│ TokenEfficiencyConfig │
└───────────┬───────────┘
            ▼
┌─────────────────────────┐
│ Retrieval Result Limits │
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│ Context Optimizer       │
└───────────┬─────────────┘
            ▼
┌───────────────────────────┐
│ Dashboard Usage Summaries │
└───────────────────────────┘
```

Token contracts are central to keeping generated context compact and predictable.
