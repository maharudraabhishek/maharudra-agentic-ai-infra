# Cache Contracts Module

The cache module defines freshness and cache metadata contracts used by context services.

## Main Types

- `CachePolicyConfig` defines cache age, strategy, and key scope.
- `FreshnessPolicyConfig` defines source-version and staleness expectations.
- `FreshnessConfig` groups project-level freshness behavior.

## Call Flow

```txt
┌───────────────┐
│ Request Input │
└───────┬───────┘
        ▼
┌───────────────────┐
│ Cache Key Builder │
└───────┬───────────┘
        ▼
┌───────────────────┐
│ Freshness Policy  │
└───────┬───────────┘
        ▼
┌──────────────────────────┐
│ Context Package Metadata │
└───────┬──────────────────┘
        ▼
┌──────────────────────────┐
│ Stale Warning When Needed│
└──────────────────────────┘
```

Cache and freshness metadata help prevent agents from treating old retrieved context as current project truth.
