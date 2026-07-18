# Core Contracts And Config System

## What Contracts Are

Contracts are typed promises between parts of the framework. A retrieval provider contract says what inputs it accepts and what results it returns. A runtime contract says what a local or remote surface must declare before it can be used.

```txt
┌───────────┐
│ Interface │
└─────┬─────┘
      ├── Implementation A
      ├── Implementation B
      └── Implementation C
```

The interface stays stable while implementations can vary.

## Why Frameworks Use Interfaces

Interfaces let the framework support local tools, remote tools, storage providers, retrieval providers, dashboards, evals, and agents without hardcoding one implementation.

For example, `RetrievalProvider` can describe full-text retrieval, pgvector retrieval, document-tree retrieval, symbol/code retrieval, graph retrieval, or a custom extension provider.

## Dependency Inversion

Dependency inversion means high-level framework logic depends on contracts, not concrete tools.

```txt
┌──────────────────┐       depends on       ┌────────────────────────────┐
│ Config Validator │───────────────────────▶│ Runtime And Tool Contracts │
└──────────────────┘                         └────────────────────────────┘

┌───────────────────┐      depends on       ┌────────────────────────────┐
│ Concrete Adapters │──────────────────────▶│ Runtime And Tool Contracts │
└───────────────────┘                        └────────────────────────────┘
```

The contract points inward. Adapters depend on the framework contract, not the other way around.

## Profile Resolver Mental Model

Profiles are named bundles of config defaults.

```txt
┌─────────────────┐       ┌─────────────┐
│ minimal profile │       │ User config │
└────────┬────────┘       └──────┬──────┘
         └──────────────┬────────┘
                        ▼
              ┌─────────────────┐
              │ Resolved Config │
              └────────┬────────┘
                       ▼
              ┌─────────────────┐
              │ Validator       │
              └─────────────────┘
```

Users choose simple names such as `secure-readonly` or `remote-safe`. The resolver expands those names into typed runtime, security, retrieval, token, and observability settings.

## Tradeoffs

- Contracts require careful naming and validation.
- Profiles reduce user complexity but must stay well documented.
- Security defaults must be strict enough to protect remote surfaces.
- Token efficiency should reduce noise without reducing engineering quality.

## Common Mistakes

- Letting remote surfaces reuse local filesystem tools.
- Treating retrieved text as instruction instead of evidence.
- Allowing user config to weaken mandatory security defaults.
- Adding runtime behavior before the config and validation contract is clear.
- Hiding token budgets and retrieval quality from observability.

## How This Prevents Rewrites

Typed contracts let each package evolve without repeatedly changing the whole framework. The core package defines what runtime, retrieval, token, storage, eval, and dashboard surfaces mean. Implementations can then plug into those contracts cleanly.
