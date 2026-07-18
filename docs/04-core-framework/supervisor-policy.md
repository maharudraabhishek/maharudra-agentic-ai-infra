# Supervisor Policy

`SupervisorPolicy` is the framework contract that chooses which registered
agents may run for a task. It receives only safe task metadata and a read-only
agent registry, then returns either a non-empty route or a typed failure. This
makes route selection deterministic and safe to perform before execution.

## Default policy

`DefaultSupervisorPolicy` selects a single manager in this order:

1. The definition with the reserved `manager` id.
2. The first definition whose role is `manager`.

If neither exists, it returns the fatal `agent.no-manager-registered` error.
It does not choose a different role, mutate the registry, start an agent, or
access external systems.

## Example

```typescript
import type { SafeTaskMetadata } from "@maharudra/agentic-ai-infra-core";
import {
  DefaultSupervisorPolicy,
  InMemoryAgentDefinitionRegistry
} from "@maharudra/agentic-ai-infra-runtime";

const task: SafeTaskMetadata = {
  taskHash: "sha256:example",
  taskType: "implementation"
};
const registry = new InMemoryAgentDefinitionRegistry().register({
  id: "manager",
  role: "manager"
});
const result = new DefaultSupervisorPolicy().route({ task, registry });

if (result.ok) {
  console.log(result.value.agents[0]?.id); // manager
}
```

## Routing flow

The policy is a pure routing boundary. A caller can handle its failure before
any downstream execution work begins.

```txt
Safe task metadata + read-only registry
                 |
                 v
      DefaultSupervisorPolicy.route()
                 |
        +--------+--------+
        |                 |
        v                 v
manager id          manager role fallback
        |                 |
        +--------+--------+
                 |
        +--------+--------+
        |                 |
        v                 v
single-agent plan   fatal no-manager result
```

## Orchestrator execution

`AgentOrchestrator` is the runtime composition boundary that consumes the
policy result. It classifies the raw task before routing, executes the selected
route through an injected single-agent execution port, and records
content-safety and feedback verdicts after the bounded synthesis is available.
Sequential and parallel plans execute one isolated sub-run per planned agent,
then merge role-prefixed summaries and token usage. The default guard and
feedback implementations are no-ops, so this composition does not make a model,
network, or filesystem call by itself.

```typescript
import {
  AgentOrchestrator,
  DefaultSupervisorPolicy,
  SingleAgentExecutor,
  TokenEfficientMultiAgentExecutor
} from "@maharudra/agentic-ai-infra-runtime";

const orchestrator = new AgentOrchestrator({
  supervisorPolicy: new DefaultSupervisorPolicy(),
  agentRegistry: registry,
  singleAgentExecutor: new SingleAgentExecutor({ config, agentRegistry: registry }),
  multiAgentExecutor: new TokenEfficientMultiAgentExecutor({ config, agentRegistry: registry })
});

const result = await orchestrator.run({
  task: "Review the local runtime architecture",
  traceId: "request-trace"
});
```

The single route preserves the direct single-agent execution path. Sequential
composition forwards prior summaries into later task text. Parallel composition
waits for every branch and keeps partial success as an aggregate result with
warnings; when every branch fails, the orchestrator returns a typed failure.

```txt
Raw task text
     |
     v
classifyTask() --> SupervisorPolicy.route({ safe task, registry })
                                      |
                                      v
             +------------+-------------+
             |            |             |
             v            v             v
          single      sequential      parallel
             |            |             |
             v            v             v
 SingleAgentExecutor  retried       allSettled
      .execute()      sub-runs      retried sub-runs
             |            |             |
             +------------+-------------+
                          |
                          v
             role-prefixed synthesis + token totals
                                      |
                                      v
                      ContentGuard.inspect(synthesis)
                                      |
                                      v
                  FeedbackHook.evaluate(run, trace, synthesis)
                                      |
                                      v
                            OrchestratorReport
```

## Public API

| Package | Export | Purpose |
| --- | --- | --- |
| `@maharudra/agentic-ai-infra-core` | `SupervisorRouteInput` | Safe inputs for route selection. |
| `@maharudra/agentic-ai-infra-core` | `SupervisorComposition` | Output composition declaration. |
| `@maharudra/agentic-ai-infra-core` | `SupervisorRoutePlan` | Non-empty agent route and composition. |
| `@maharudra/agentic-ai-infra-core` | `SupervisorPolicy` | Contract for deterministic routing. |
| `@maharudra/agentic-ai-infra-runtime` | `DefaultSupervisorPolicy` | Default manager-routing implementation. |
| `@maharudra/agentic-ai-infra-runtime` | `AgentOrchestratorOptions` | Constructor dependencies for routing, execution, registry, forward-compatible multi-agent executor wiring, and optional seams. |
| `@maharudra/agentic-ai-infra-runtime` | `OrchestratorRunInput` | Bounded task, trace, context, and tool inputs for one composed run. |
| `@maharudra/agentic-ai-infra-runtime` | `AgentOrchestrator` | Single, sequential, and parallel composition implementation and aggregate report boundary. |
