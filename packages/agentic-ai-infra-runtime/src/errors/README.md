# Errors Module

The errors module wraps core `FrameworkResult` helpers for runtime code.

## Functions

- `runtimeFailure`: builds a typed runtime failure with configurable severity.
- `recoverable`: creates a recoverable operational failure.
- `fatal`: creates a fatal trust-boundary failure.

## Flow

```txt
┌───────────────┐
│ Runtime Guard │
└───────┬───────┘
        ▼
┌──────────────┐
│ Error Helper │
└───────┬──────┘
        ▼
┌─────────────────────────┐
│ FrameworkResult Failure │
└─────────────────────────┘
```

Runtime methods return typed failures for expected policy/readiness states instead of throwing.
