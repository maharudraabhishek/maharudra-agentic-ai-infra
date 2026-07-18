# Profiles Module

The profiles module converts simple user-facing profile names into concrete framework configuration.

## Main Types And Classes

- `BuiltInProfileName` lists the supported profile names.
- `ProfileDefinition` stores a profile name, description, and partial config.
- `ProfileResolver` defines the resolution interface used by packages.
- `DefaultProfileResolver` layers built-in profiles under the user config.

## Call Flow

```txt
┌───────────────────────────┐
│ profiles: secure-readonly │
└─────────────┬─────────────┘
              ▼
┌──────────────────────────────┐
│ DefaultProfileResolver.resolve│
└─────────────┬────────────────┘
              ▼
┌───────────────────────────┐
│ Merge Profile Defaults    │
└─────────────┬─────────────┘
              ▼
┌───────────────────────────┐
│ Merge User Overrides      │
└─────────────┬─────────────┘
              ▼
┌───────────────────────────┐
│ ResolvedProjectConfig     │
└───────────────────────────┘
```

Profile resolution keeps generated and hand-authored config small while still producing explicit runtime, storage, retrieval, and security settings.
