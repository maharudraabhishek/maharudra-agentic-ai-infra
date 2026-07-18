# Retrieval Context Storage

Retrieval, context building, and storage work together as one framework surface.

```txt
                         ┌───────────┐
                         │ User Task │
                         └─────┬─────┘
                               ▼
                    ┌──────────────────┐
                    │ Retrieval Router │
                    └────────┬─────────┘
                             │
       ┌─────────────┬───────┴───────┬──────────────┬─────────────┬────────────┐
       ▼             ▼               ▼              ▼             ▼            ▼
┌───────────┐ ┌──────────────┐ ┌─────────────┐ ┌──────────┐ ┌───────────┐ ┌────────┐
│ Full-text │ │ pgvector     │ │ Document    │ │ Page     │ │ Symbol/   │ │ Graph  │
│ Provider  │ │ Storage      │ │ Tree        │ │ Index    │ │ Code      │ │        │
└─────┬─────┘ └──────┬───────┘ └──────┬──────┘ └────┬─────┘ └─────┬─────┘ └───┬────┘
      └──────────────┴───────────────┬┴─────────────┴─────────────┴──────────┘
                                      ▼
                          ┌─────────────────────┐
                          │ Context Builder     │
                          └──────────┬──────────┘
                                     ▼
                          ┌─────────────────────┐
                          │ Bounded Context     │
                          │ Package             │
                          └─────────────────────┘
```

## Storage Role

Storage keeps reviewed sources, document chunks, index metadata, migration status, cache metadata, freshness metadata, and observability records. Database migrations are discovered and reported separately from execution.

```txt
┌────────────┐  ┌─────────────────────────┐  ┌───────────────────────────┐  ┌──────────────────────────────────┐
│ Maintainer │  │ Migration Status Reader │  │ Explicit Migration Runner │  │ Postgres Pgvector-Capable Schema │
└─────┬──────┘  └────────────┬────────────┘  └─────────────┬─────────────┘  └────────────────┬─────────────────┘
      │ inspect reviewed files│                             │                                 │
      │──────────────────────▶│                             │                                 │
      │ pending/applied status│                             │                                 │
      │◀──────────────────────│                             │                                 │
      │ exact approval text                                 │                                 │
      │────────────────────────────────────────────────────▶│                                 │
      │                                                     │ apply reviewed migrations        │
      │                                                     │────────────────────────────────▶│
      │                                                     │ migration result                 │
      │                                                     │◀────────────────────────────────│
```

The framework does not run migrations automatically during import, runtime startup, CLI init, validation, or doctor checks.

## Retrieval Role

Retrieval providers return bounded previews and safe metadata. Providers report recoverable states such as not configured, not indexed, storage unavailable, or unsupported input when they cannot run.

## Context Role

The context builder selects relevant retrieval results, applies budget limits, deduplicates sources, and adds a warning that retrieved content is untrusted evidence rather than instruction.
