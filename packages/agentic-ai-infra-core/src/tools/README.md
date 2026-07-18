# Tools Module

The tools module defines how framework and project tools are described before any runtime adapter exposes them.

## Main Types And Classes

- `ToolContract` describes a tool id, category, risk level, runtime policy, and output policy.
- `ToolRuntimePolicy` describes where a tool may run.
- `ToolOutputPolicy` describes bounded-output and remote-safe behavior.
- `ToolContractRegistry` defines the registry interface.
- `InMemoryToolContractRegistry` stores immutable tool contracts for tests and runtime composition.

```txt
┌──────────────┐
│ ToolContract │
└──────┬───────┘
       ├── uses → ToolRuntimePolicy
       └── uses → ToolOutputPolicy

┌──────────────────────────────┐
│ InMemoryToolContractRegistry │
└──────────────┬───────────────┘
               ├── implements → ToolContractRegistry
               └── stores → ToolContract
```

## Call Flow

```txt
┌──────────────┐
│ ToolContract │
└──────┬───────┘
       ▼
┌───────────────────────────────────────┐
│ InMemoryToolContractRegistry.register │
└──────┬────────────────────────────────┘
       ▼
┌────────────────────┐
│ registry.list      │
└──────┬─────────────┘
       ▼
┌────────────────────┐
│ Security Filter    │
└──────┬─────────────┘
       ▼
┌──────────────────────────────┐
│ Runtime Adapter Registration │
└──────────────────────────────┘
```

Tool contracts are metadata first. Actual execution code belongs in runtime implementations that can enforce mode-specific safety.
