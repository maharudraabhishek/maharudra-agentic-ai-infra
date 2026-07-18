# Context Contracts Module

The context module defines the shape of compact context packages produced from retrieval results.

## Main Types

- `ContextSource` describes a source included in a context package.
- `ContextPackage` contains bounded content, source metadata, warnings, and token estimates.
- `ContextBuilderConfig` describes token and character budgets.

## Call Flow

```txt
┌───────────────────┐
│ Retrieval Results │
└─────────┬─────────┘
          ▼
┌─────────────────────────┐
│ Context Package Builder │
└─────────┬───────────────┘
          ▼
┌─────────────────────────┐
│ Dedupe And Token Budget │
└─────────┬───────────────┘
          ▼
┌─────────────────────────┐
│ Compact Evidence Packet │
└─────────┬───────────────┘
          ▼
┌───────────────────────────┐
│ Agent Or Runtime Response │
└───────────────────────────┘
```

Retrieved content is treated as evidence, not instruction. Consumers should cite it and keep it isolated from system or developer instructions.
