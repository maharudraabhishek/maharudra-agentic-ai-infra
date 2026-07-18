# @maharudra/agentic-ai-infra-core

Core contracts for the MahaRudra Agentic AI Infra framework.

## Available Capabilities

- Typed project config contracts.
- Built-in capability profiles.
- Profile resolution and config validation.
- Local STDIO MCP, remote HTTPS MCP, and API service runtime contracts.
- Tool, permission, approval, and remote-safe filtering contracts.
- Agent, retrieval, context, token, storage, eval, cache, freshness, and observability contracts.
- Typed framework result, validation issue, and error helpers.

The package is side-effect free: importing it does not start services, read local files, access environment variables, connect to databases, or open network connections.

## Module Map

- `src/config/` defines `AgenticInfraProjectConfig`, `ResolvedProjectConfig`, and `DefaultConfigValidator`.
- `src/profiles/` defines built-in profile definitions and `DefaultProfileResolver`.
- `src/security/` defines remote-safe policies and `DefaultRemoteSafeToolFilter`.
- `src/tools/` defines `ToolContract`, `ToolContractRegistry`, and `InMemoryToolContractRegistry`.
- `src/runtime/` defines local STDIO MCP, remote HTTPS MCP, API service, and runtime policy contracts.
- `src/retrieval/` defines provider input, output, router, and bounded-result contracts.
- `src/context/` defines compact context package contracts.
- `src/storage/` defines storage provider and migration contracts.
- `src/cache/` defines cache and freshness contracts.
- `src/observability/` defines dashboard, audit, trace, and safe logging contracts.
- `src/agents/`, `src/token/`, `src/evals/`, and `src/harness/` define workflow, budget, diagnostic, and test-helper contracts.

## Contract Flow

```txt
┌────────────────┐
│ Project Config │
└───────┬────────┘
        ▼
┌──────────────────┐
│ Profile Resolver │
└───────┬──────────┘
        ▼
┌──────────────────┐
│ Config Validator │
└───────┬──────────┘
        ▼
┌────────────────────────────┐
│ Tool And Security Policies │
└───────┬────────────────────┘
        ▼
┌──────────────────────────────────────────────┐
│ Runtime, Retrieval, Storage, Context Contracts│
└───────┬──────────────────────────────────────┘
        ▼
┌──────────────────────────────────┐
│ Runtime Package Implementations  │
└──────────────────────────────────┘
```

Each source folder contains a local README that lists its main contracts and how they participate in the package flow.
