# Storage Module

The storage module owns Postgres readiness, migration status, and explicit migration execution.

## Classes And Functions

- `PostgresStorageProvider`: lazy Postgres provider with health, migration status, migration execution, and close behavior.
- `StaticMigrationProvider`: supplies reviewed framework migrations.
- `FRAMEWORK_MIGRATIONS`: neutral schema definitions for retrieval, context, cache, freshness, eval, token, trace, and audit storage.
- `RUN_AGENTIC_AI_INFRA_MIGRATIONS`: exact approval text required for schema mutation.
- `migrationChecksum`: stable migration checksum helper.

## Call Flow

```txt
┌─────────────────────────┐
│ Storage Provider Method │
└────────────┬────────────┘
             ▼
┌─────────────────────────────────┐
│ Resolve Injected DB Or Lazy Pool│
└────────────┬────────────────────┘
             ├── Health check: fixed select
             ├── Status: metadata read only
             └── Run: exact approval + reviewed SQL
```

Migration status discovery never executes migration SQL.
