# Config Reference

The project config is the user-facing entrypoint for MahaRudra Agentic AI Infra.

```ts
import type { AgenticInfraProjectConfig } from "@maharudra/agentic-ai-infra-core";

const config: AgenticInfraProjectConfig = {
  project: {
    name: "Example Project",
    slug: "example-project"
  },
  profiles: ["secure-readonly"]
};

export default config;
```

## Config Categories

- `project`: product name, slug, and description.
- `profiles`: capability profiles such as `minimal`, `remote-safe`, and `hybrid-all`.
- `runtime`: local STDIO MCP, remote HTTPS MCP, and API service surfaces.
- `storage`: storage provider declarations.
- `retrieval`: retrieval provider declarations and routing strategy.
- `agents`: single-agent or token-efficient multi-agent mode.
- `tokenEfficiency`: token budgets and counter provider references.
- `dashboard`: dashboard host, port, and visible signal categories.
- `security`: path policy, approval policy, prompt-injection defense, and remote safety settings.
- `freshness`: cache and source freshness policy.
- `observability`: safe logging, audit, and trace settings.

## Validation

The config validator checks project identity, runtime compatibility, remote security requirements, dashboard ports, retrieval/storage compatibility, multi-agent token policy, path policy, provider declarations, and strict security defaults.

```txt
┌───────────────────────────┐
│ AgenticInfraProjectConfig │
└─────────────┬─────────────┘
              ▼
┌───────────────────────────┐
│ Resolve Selected Profiles │
└─────────────┬─────────────┘
              ▼
┌───────────────────────────┐
│ Validate Runtime Surfaces │
└─────────────┬─────────────┘
              ▼
┌───────────────────────────┐
│ Validate Security Policy  │
└─────────────┬─────────────┘
              ▼
┌───────────────────────────┐
│ Validate Providers        │
└─────────────┬─────────────┘
              ▼
┌───────────────────────────┐
│ Validate Token Budgets    │
└─────────────┬─────────────┘
              ▼
┌───────────────────────────┐
│ FrameworkResult           │
│ With Warnings Or Errors   │
└───────────────────────────┘
```
