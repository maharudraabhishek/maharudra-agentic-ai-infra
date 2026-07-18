# Retrieval Contracts Module

The retrieval module defines provider contracts and bounded result shapes.

## Main Types

- `RetrievalProviderConfig` describes a configured provider.
- `RetrievalRouterConfig` describes strategy and result limits.
- `RetrievalInput` describes a query, filters, and budgets.
- `RetrievalResult` describes a bounded preview with score and safe metadata.
- `RetrievalProvider` is the provider interface used by runtime implementations.

## Call Flow

```txt
┌────────────────┐
│ RetrievalInput │
└───────┬────────┘
        ▼
┌────────────────────────────┐
│ RetrievalProvider.retrieve │
└───────┬────────────────────┘
        ▼
┌────────────────────────────────────────┐
│ FrameworkResult With Retrieval Results │
└───────┬────────────────────────────────┘
        ▼
┌───────────────────────────┐
│ Router Dedupe And Scoring │
└───────┬───────────────────┘
        ▼
┌───────────────────────────┐
│ Context Builder           │
└───────────────────────────┘
```

Providers return bounded evidence. They must not return vectors, secrets, raw full files, or unbounded chunks.
