# Agent Definition and Registry

Layer 10 — Agent Runtime & Orchestration.

This document describes the agent definition surface available in
`@maharudra/agentic-ai-infra-core` and the registry implementation in
`@maharudra/agentic-ai-infra-runtime`. It covers what is enforced today,
what is declared for future stages, and how to wire definitions into the
runtime.

## Concepts

### `AgentProfile`

The slim, serializable identity used in user config. Four fields:

- `id` — stable identifier (unique within a project)
- `role` — one of the framework's `AgentRole` values
- `description` (optional)
- `maxContextTokens` (optional)

`AgentProfile` is what users write in their `agentic-ai-infra.config.ts`.

### `AgentDefinition`

The runtime type produced by the registry. Structurally an intersection of
`AgentProfile` (identity) and seven optional policy fields:

| Field | Stage 25 | Stage 26 | Stage 27+ |
|---|:---:|:---:|:---:|
| `allowedTools`     | ✅ enforced (planning) | ✅ (execution) |  |
| `budgetPolicy`     | ✅ enforced (planning) | ✅ (execution) |  |
| `evalRules`        | ✅ used by single-agent eval | ✅ multi-agent |  |
| `modelPolicy`      | declared | ✅ enforced |  |
| `retrievalPolicy`  | declared | ✅ enforced |  |
| `memoryPolicy`     | declared | declared | ✅ enforced |
| `approvalPolicy`   | declared | mutating tools | richer workflows |

Fields marked "declared" are present in the type so future stages don't
have to retroactively change configs. They have no runtime effect yet.

### `AgentDefinitionRegistry`

A read-only lookup interface with four methods:

- `list()` — all definitions in insertion order
- `findById(id)` — one definition, or `undefined`
- `findByRole(role)` — list of definitions matching the role, in insertion order
- `count()` — total registered

Mutation lives on the concrete `InMemoryAgentDefinitionRegistry` class
(`register()`), not on the interface. Consumers depend on the interface.

## Default registry

Every container ships with six default definitions, one per built-in
agent role:

- `manager`
- `architecture-reviewer`
- `security-reviewer`
- `implementation-planner`
- `eval-reviewer`
- `docs-reviewer`

All six are created with no policy fields set. By default, the registry
adds zero new restrictions over previous framework behavior. Users opt in
to per-agent policy by overriding a default definition.

## Wiring

The container auto-wires a registry from `config.agents.agents`. No code
change is required to get the defaults. To override a default, declare an
agent profile with the matching id:

```typescript
const config: AgenticInfraProjectConfig = {
  project: { name: "MyApp", slug: "my-app" },
  profiles: ["full-agentic-context"],
  agents: {
    mode: "single-agent",
    agents: [
      {
        id: "manager",
        role: "manager",
        description: "Custom coordinator",
        maxContextTokens: 12000
      }
    ]
  }
};
```

To register definitions with policy fields, construct a custom registry
and pass it via `RuntimeStartOptions.agentRegistry`:

```typescript
import {
  InMemoryAgentDefinitionRegistry,
  createRuntimeServiceContainer
} from "@maharudra/agentic-ai-infra-runtime";

const registry = new InMemoryAgentDefinitionRegistry()
  .register({
    id: "manager",
    role: "manager",
    allowedTools: ["agentic.retrieval.search", "agentic.context.build"],
    budgetPolicy: { maxTokens: 4000 },
    evalRules: {
      forbiddenTools: ["agentic.write.propose"],
      hardBudget: 5000
    }
  });

const container = createRuntimeServiceContainer({
  config,
  agentRegistry: registry
});
```

Future framework stages will introduce a config schema for rich definitions
so the custom-registry pattern is not required.

## Enforcement semantics

### `allowedTools`

Applied as a tightening filter on top of the existing role × category floor
in the harness. Three behaviors:

- `undefined` — no per-agent restriction; falls through to role × category
- `[]` — empty allowlist; the agent selects no tools
- `[...]` — intersection: only ids in both the planner's selection AND the
  allowlist survive

`allowedTools` cannot broaden what a role is allowed to do. A definition
that lists a write tool for a security-reviewer role is still blocked by
the role × category floor — defense in depth.

At execution time, the harness applies the same allowlist as a safety net when
the tool call carries `agentId` and the default permission gate has a registry.
If either value is absent, the branch is skipped and the baseline role and
runtime policy checks apply.

```typescript
import { DefaultPermissionGate } from "@maharudra/agentic-ai-infra-runtime";

const decision = new DefaultPermissionGate(agentRegistry).decide({
  runtimeMode: "local-stdio-mcp",
  tool,
  requestedCapability: tool.category,
  agentId: "manager"
});
```

### `approvalPolicy.requiresApproval`

When `requiresApproval` is true for the resolved agent, mutating tools must pass
the exact-approval layer after baseline permission checks. Valid approval is not
pre-empted; missing or incorrect text returns `runtime.approval-required` with
`refusalReason: "approval-required"`. The
mutating-tool predicate is the same one used by `DefaultApprovalPolicy`: explicit
tool approval policy, state mutation, migrations, write/admin category, or
high/critical risk.

If `agentId` is absent, the registry is absent, or the id does not resolve, the
agent-level branch is inert. Exact approval text handling remains in
`DefaultApprovalPolicy.check()` and is still transient: approval text is not
recorded or exposed through dashboard data.

### `budgetPolicy.maxTokens`

A ceiling on the agent's effective token budget. The effective budget is
`min(projectBudget, agentBudget)`. The agent budget never widens the
project budget.

### `evalRules`

Used by the single-agent eval suite (`single-agent-safety` suite name).
Three checks:

- `requiredTools` — every listed id must appear in the agent's selection
- `forbiddenTools` — no listed id may appear in the agent's selection
- `hardBudget` — total tokens used must not exceed the ceiling

Each check is skipped when its rule is undefined or empty. Skipped checks
do not fail the overall report.

`SingleAgentExecutor` pushes an `EvalRunRecord` after each run when
`evalRules` is set AND `evalStore` is wired. Without `evalRules`, no
record is pushed.

## Validation

The config validator catches duplicate ids in `agents.agents` at validation
time, surfacing the existing `config.duplicate-id` error code. The registry
also validates at register time (defense in depth) and throws on:

- empty or whitespace `id`
- `role` not in the `AgentRole` union
- duplicate `id` within the registry

Register-time errors are programmer errors (not user input errors) and
throw synchronously rather than returning a `FrameworkResult`.

## Limits

- Definitions are not persisted today. The registry is in-memory only.
- Rich policy fields are not yet expressible in `AgenticInfraProjectConfig`;
  users wanting full policy on a definition must pass a custom registry.
- Rich approval workflows beyond the coarse mutating-tool gate remain future
  work. Exact approval text is still checked at the tool policy layer.

These limits are addressed in subsequent framework stages.

## Public API surface

From `@maharudra/agentic-ai-infra-core`:

```typescript
export type AgentDefinition;
export type AgentBudgetPolicy;
export type AgentEvalRules;
export type AgentModelPolicy;
export type AgentRetrievalPolicy;
export type AgentMemoryPolicy;
export type AgentApprovalPolicy;
export interface AgentDefinitionRegistry;
```

From `@maharudra/agentic-ai-infra-runtime`:

```typescript
export class InMemoryAgentDefinitionRegistry;
export function createAgentDefinitionRegistry(
  profiles?: readonly AgentProfile[]
): InMemoryAgentDefinitionRegistry;
export const DEFAULT_AGENT_DEFINITIONS: readonly AgentDefinition[];
export function runSingleAgentEvals(
  report: SingleAgentEvalInput,
  definition?: AgentDefinition
): QualityReport;
export const SINGLE_AGENT_SUITE_NAME: "single-agent-safety";
```

`RuntimeServiceContainer.agentRegistry` is always present.
`ExecutorOptions.agentRegistry` is optional; when absent the executor
behaves as it did before this surface existed.
