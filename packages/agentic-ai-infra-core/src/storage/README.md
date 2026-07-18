# Storage Contracts Module

The storage module defines storage and migration contracts used by runtime implementations.

## Main Types

- `StorageProviderConfig` describes filesystem, Postgres, memory, or custom storage.
- `StorageConfig` groups provider settings and defaults.
- `MigrationDefinition` describes one reviewed framework migration.
- `MigrationStatus` reports whether a migration is pending or applied.
- `StorageProvider` defines health, status, and migration operations.

## Call Flow

```txt
┌───────────────┐
│ StorageConfig │
└───────┬───────┘
        ▼
┌──────────────────┐
│ Storage Provider │
└───────┬──────────┘
        ├── healthCheck
        └── discoverMigrationStatus
            └── Explicit migration runner call
```

Migration status discovery is read-only. Migration execution is an explicit operation guarded by the runtime implementation.
