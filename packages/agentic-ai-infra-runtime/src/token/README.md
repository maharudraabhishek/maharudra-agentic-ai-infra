# Token Module

The token module provides deterministic token accounting.

## Classes

- `HeuristicTokenCounterProvider`: stable local character-based estimate.
- `TokenBudgetManager`: hard budget checks and role budget lookup.
- `TokenUsageRecorder`: safe in-memory token usage records.

## Flow

```txt
┌───────────────────┐
│ Runtime Operation │
└─────────┬─────────┘
          ▼
┌───────────────────┐
│ Token Estimate    │
└─────────┬─────────┘
          ▼
┌───────────────────┐
│ Budget Check      │
└─────────┬─────────┘
          ▼
┌───────────────────┐
│ Safe Token Record │
└─────────┬─────────┘
          ▼
┌───────────────────┐
│ Dashboard Summary │
└───────────────────┘
```
