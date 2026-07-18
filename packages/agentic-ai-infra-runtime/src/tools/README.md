# Tools Module

The tools module defines the safe framework-level tool surface and runtime filtering.

## Functions

- `createFrameworkToolContracts`: builds bounded project, config, health, retrieval, context, and diagnostics tool contracts.
- `createRuntimeToolRegistry`: wraps contracts in a policy-enforcing registry (PolicyEnforcingToolRegistry) that validates remote-safety, critical risk level, and shell access at registration time rather than deferring to call time.
- `filterToolsForMode`: applies runtime mode filtering and remote-safe filtering.
- `assertRemoteToolsSafe`: rejects unsafe tools before remote registration.
- `assertSafeToolOutput`: rejects unsafe output classes such as secrets, vectors, raw SQL, stack traces, command output, and remote absolute paths.

## Execution Flow

```txt
┌────────────────┐
│ Tool Contracts │
└───────┬────────┘
        ▼
┌────────────────────────┐
│ Filter By Runtime Mode │
└───────┬────────────────┘
        ▼
Remote runtime?
├── No → Output safety assertion
└── Yes
    ▼
    Remote-safe predicate
    ▼
    Output safety assertion
```
