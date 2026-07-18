# Security Module

The security module defines the policy contracts used to keep remote runtime surfaces bounded and safe.

## Main Types And Classes

- `SecurityConfig` defines project-level safety switches.
- `PathSafetyPolicy` describes path traversal and secret-path handling.
- `RemoteSafeToolFilter` describes the contract for runtime tool filtering.
- `DefaultRemoteSafeToolFilter` rejects local filesystem, shell, raw file, vector, and secret-returning tools for remote mode.

```txt
┌────────────────┐
│ SecurityConfig │
└───────┬────────┘
        │ uses
        ▼
┌──────────────────┐
│ PathSafetyPolicy │
└──────────────────┘

┌─────────────────────────────┐
│ DefaultRemoteSafeToolFilter │
└──────────────┬──────────────┘
               │ implements
               ▼
┌──────────────────────┐
│ RemoteSafeToolFilter │
└──────────────────────┘
```

## Call Flow

```txt
┌────────────────┐
│ Tool Contracts │
└───────┬────────┘
        ▼
┌────────────────────────────────────┐
│ DefaultRemoteSafeToolFilter.filter │
└───────┬────────────────────────────┘
        ▼
┌────────────────────────────┐
│ Remote-Safe Tool Contracts │
└───────┬────────────────────┘
        ▼
┌──────────────────────────────┐
│ Runtime Adapter Registration │
└──────────────────────────────┘
```

Remote-safe filtering is a defense-in-depth rule. Runtime adapters must still enforce their own startup and output policies even when the config has already been validated.
