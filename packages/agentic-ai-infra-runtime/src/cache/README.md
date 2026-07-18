# Cache Module

The cache module provides deterministic cache and freshness helpers.

## Classes And Functions

- `stableHash`: SHA-256 hash helper for structured cache inputs.
- `buildCacheKey`: cache key builder that includes project, config, provider, source, input, and freshness versions.
- `InMemoryRuntimeCache`: simple final-interface-compatible memory cache.
- `evaluateFreshness`: source freshness warning helper.

## Call Flow

```txt
┌─────────────────┐
│ Operation Input │
└────────┬────────┘
         ▼
┌────────────────────────────────┐
│ Stable Hash + Version Metadata │
└────────┬───────────────────────┘
         ▼
┌─────────────────┐
│ Cache Key       │
└────────┬────────┘
         ▼
┌─────────────────┐
│ Cache Get/Set   │
└────────┬────────┘
         ▼
┌────────────────────┐
│ Freshness Warnings │
└────────────────────┘
```
