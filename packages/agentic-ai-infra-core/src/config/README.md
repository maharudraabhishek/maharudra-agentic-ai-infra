# Config Module

The config module owns the project configuration shape and validation rules.

## Main Types And Classes

- `AgenticInfraProjectConfig` is the user-facing configuration object.
- `ResolvedProjectConfig` is the profile-expanded configuration used by runtime services.
- `ExtensionProviderConfig` describes custom storage, retrieval, runtime, tool, or observability providers.
- `DefaultConfigValidator` validates safety, references, ports, token budgets, and remote-safe boundaries.

```txt
┌───────────────────────┐
│ ResolvedProjectConfig │
└───────────┬───────────┘
            │ extends
            ▼
┌───────────────────────────┐
│ AgenticInfraProjectConfig │
└───────────┬───────────────┘
            │ uses
            ▼
┌─────────────────────────┐
│ ExtensionProviderConfig │
└─────────────────────────┘

┌────────────────────────┐       uses       ┌───────────────────────┐
│ DefaultProfileResolver │─────────────────▶│ ResolvedProjectConfig │
└────────────────────────┘                  └───────────────────────┘

┌────────────────────────┐       uses       ┌───────────────────────┐
│ DefaultConfigValidator │─────────────────▶│ ResolvedProjectConfig │
└────────────────────────┘                  └───────────────────────┘
```

## Call Flow

```txt
┌───────────────────────────┐
│ AgenticInfraProjectConfig │
└─────────────┬─────────────┘
              ▼
┌───────────────────────────┐
│ DefaultProfileResolver    │
└─────────────┬─────────────┘
              ▼
┌───────────────────────────┐
│ ResolvedProjectConfig     │
└─────────────┬─────────────┘
              ▼
┌───────────────────────────┐
│ DefaultConfigValidator    │
│ .validate                 │
└─────────────┬─────────────┘
              ▼
┌───────────────────────────┐
│ FrameworkResult With      │
│ Warnings/Errors           │
└───────────────────────────┘
```

Validation is intentionally strict at trust boundaries. Remote runtime settings, path policies, provider references, and tool safety checks are treated as product safety rules rather than optional hints.
