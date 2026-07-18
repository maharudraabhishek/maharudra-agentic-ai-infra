# Context Module

The context module turns retrieval results into compact context packages.

## Classes

- `ContextOptimizer`: deduplicates sources and enforces token budget limits.
- `ContextBuilder`: creates context text, citations, source metadata, warnings, and shared context packets.

## Call Flow

```txt
┌───────────────────┐
│ Retrieval Results │
└─────────┬─────────┘
          ▼
┌──────────────────┐
│ ContextOptimizer │
└─────────┬────────┘
          ▼
┌───────────────────────────┐
│ Bounded Selected Evidence │
└─────────┬─────────────────┘
          ▼
┌──────────────────┐
│ ContextBuilder   │
└─────────┬────────┘
          ▼
┌──────────────────┐
│ ContextPackage   │
└──────────────────┘
```

Retrieved content is untrusted evidence and must not override user instructions, project policy, or runtime safety rules.
