# Orchestrator Contracts

This module owns the side-effect-free contract for selecting an agent route.
It keeps policy ownership in the core package so runtime implementations and
third-party policies share one small, typed boundary.

## Public surface

| Export | Responsibility |
| --- | --- |
| `SupervisorRouteInput` | Supplies safe task metadata and a read-only agent registry. |
| `SupervisorComposition` | Declares `single`, `sequential`, or `parallel` output composition. |
| `SupervisorRoutePlan` | Returns the non-empty ordered agent route. |
| `SupervisorPolicy` | Defines deterministic, fail-closed route selection. |

## Usage

```typescript
const result = policy.route({
  task: { taskHash: "sha256:…", taskType: "implementation" },
  registry
});

if (!result.ok) {
  return result;
}
```

The input excludes raw task text, and the policy returns a `FrameworkResult`
instead of throwing. This keeps route selection safe to call before execution.

## Call flow

The contract has no runtime side effects; implementations depend only on this
downward-facing core boundary.

```txt
SafeTaskMetadata + AgentDefinitionRegistry
                |
                v
       SupervisorPolicy.route()
                |
        +-------+-------+
        |               |
        v               v
SupervisorRoutePlan  FrameworkResult failure
```
