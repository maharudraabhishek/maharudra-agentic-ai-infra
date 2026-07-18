# Agent Orchestrator

Layer 10 agent orchestration is the runtime boundary that turns a task into one
or more deterministic agent sub-runs and returns one aggregate report.

`AgentOrchestrator` is intentionally a runtime implementation, not a core
interface. The core package owns the routing contract (`SupervisorPolicy`) and
safe report types; the runtime package owns construction, default policy, guard
integration, and executor wiring.

## Concept

The orchestrator separates route selection from execution. A supervisor policy
receives safe task metadata and a read-only agent registry, then returns a
non-empty route. The orchestrator executes that route, applies the content guard
and feedback hook, and returns an `OrchestratorReport`.

```typescript
import { createRuntimeServiceContainer } from "@maharudra/agentic-ai-infra-runtime";

const containerResult = createRuntimeServiceContainer({ config });

if (containerResult.ok) {
  const run = await containerResult.value.orchestrator.run({
    task: "Review the local runtime boundary."
  });

  if (run.ok) {
    console.log(run.value.synthesis);
  }
}
```

The factory call is synchronous and side-effect-free. No transport is started and
no remote service is called until a caller explicitly starts a runtime surface or
invokes a collaborator that performs work.

## Supervisor Policy

`SupervisorPolicy` is the pure route-selection contract in core. It sees only
`SafeTaskMetadata` and the `AgentDefinitionRegistry`, so policy code does not
receive raw task text.

```typescript
import { fail, ok, type SupervisorPolicy } from "@maharudra/agentic-ai-infra-core";

const docsFirstPolicy: SupervisorPolicy = {
  route(input) {
    const docsReviewer = input.registry.findByRole("docs-reviewer")[0];
    const manager = input.registry.findById("manager");
    const selected = docsReviewer ?? manager;

    if (!selected) {
      return fail({
        code: "agent.no-manager-registered",
        message: "No manager or docs reviewer is registered.",
        severity: "fatal"
      });
    }

    return ok({
      agents: [selected],
      composition: "single"
    });
  }
};
```

A production policy should return a failed `FrameworkResult` if it cannot
produce at least one agent. The default runtime policy selects the canonical
`manager` definition and returns `agent.no-manager-registered` if no manager is
available.

## Composition Modes

The supervisor route declares how the selected agents should be composed.

Before execution, every planned id is replaced by its canonical registry
definition. The executor receives that id and the outer trace id. Unknown or
duplicate ids and executor reports with mismatched identity or trace fail closed.

| Mode | Behavior | Failure semantics |
| --- | --- | --- |
| `single` | Runs the first selected agent through the single-agent execution port. | Executor failure returns a failed `FrameworkResult`. |
| `sequential` | Runs one single-agent sub-run per selected agent in order, carrying prior role summaries into later tasks. | The first unusable sub-run fails the composition. |
| `parallel` | Runs one retried single-agent sub-run per selected agent with `Promise.allSettled`. | Partial success returns `ok` with warnings; total failure returns `fail`. |

The runtime container also wires `TokenEfficientMultiAgentExecutor` into the
orchestrator. Current composition paths keep retry accounting visible per
planned agent by invoking the single-agent execution port once for each sub-run.
These paths are not yet the shared-context token-efficient strategy; bounded
role-sliced composition remains the next corrective increment.

## Report Shape

`OrchestratorReport` is an aggregate report, not a subtype of the executor
reports. It records safe task metadata, the planned roles, every successful
sub-run, aggregate synthesis, aggregate token usage, and guard/feedback verdicts.

```typescript
if (run.ok && run.value.kind === "orchestrator") {
  for (const subRun of run.value.subRuns) {
    console.log(subRun.agentId, subRun.attemptCount);
  }
}
```

Important fields:

| Field | Meaning |
| --- | --- |
| `kind` | Always `"orchestrator"` for aggregate reports. |
| `plannedAgents` | Roles selected by the supervisor, in route order. |
| `subRuns` | One entry per successful executor invocation, including retry attempts. |
| `synthesis` | Bounded aggregate text produced from sub-run summaries. |
| `tokenUsage` | Aggregate usage across included sub-runs. |
| `contentVerdict` | Output content-safety verdict. The default guard is pass-through. |
| `feedback` | Post-output feedback verdict. The default hook accepts the output. |
| `response` | Optional response-policy verdict when a non-per-agent response policy applies. |
| `warnings` | Optional non-fatal composition warnings, such as parallel partial failure. |

## Refusals And Safe Failures

Routing and execution failures stay inside `FrameworkResult` wherever they are
expected operational outcomes. The caller checks `result.ok` instead of catching
normal policy failures.

The orchestrator can surface denials through typed refusal data when a lower
layer supplies it. Active values include `approval-required` and
`agent-allowlist`; the closed `RefusalReason` union remains the source of truth.
Retry wrappers preserve a supplied reason, and parallel partial success can
include bounded refusals alongside successful sub-runs.

```typescript
const run = await container.orchestrator.run({ task: "Use only read tools." });

if (!run.ok) {
  console.error(run.error.code);
}
```

Raw task text is not written into the report. The public report stores safe task
metadata and bounded synthesis text.

Output actions are enforced: content `block` returns `output.unsafe`, content
`rewrite` returns only its replacement, and a missing replacement fails closed.
Response `ask` or `abstain` does not return the rejected synthesis. Throws from
injected routing, execution, guard, or feedback seams become sanitized
`framework.internal-error` results.

## Container Wiring

`createRuntimeServiceContainer()` returns a non-optional orchestrator slot:

```typescript
const result = createRuntimeServiceContainer({ config });

if (result.ok) {
  await result.value.orchestrator.run({ task: "Summarize retrieval setup." });
}
```

The container auto-wires:

| Dependency | Source |
| --- | --- |
| `supervisorPolicy` | `DefaultSupervisorPolicy`, unless `supervisorPolicy` is supplied. |
| `agentRegistry` | Container registry, including the six default definitions. |
| `singleAgentExecutor` | Built from the resolved config and container services. |
| `multiAgentExecutor` | Built from the same executor options for forward-compatible wiring. |
| `contentGuard` | Container content guard, defaulting to `NoopContentGuard`. |
| `feedbackHook` | Container feedback hook, defaulting to `NoopCritiqueLoop`. |

Advanced hosts and tests can replace the full orchestrator:

```typescript
const result = createRuntimeServiceContainer({
  config,
  orchestrator: customOrchestrator
});
```

Or they can keep the default orchestrator construction and replace only routing:

```typescript
const result = createRuntimeServiceContainer({
  config,
  supervisorPolicy: docsFirstPolicy
});
```

The service relationship is:

```txt
createRuntimeServiceContainer()
  |
  +-- resolves config and runtime services
  +-- builds agent registry, guards, feedback hook
  +-- builds single-agent and multi-agent executors
  +-- builds AgentOrchestrator
        |
        +-- SupervisorPolicy.route()
        +-- SingleAgentExecutor.execute() per selected sub-run
        +-- ContentGuard.inspect()
        +-- FeedbackHook.evaluate()
        +-- OrchestratorReport
```

## Public API Surface

| Package | Export | Role |
| --- | --- | --- |
| `@maharudra/agentic-ai-infra-core` | `SupervisorPolicy` | Pure routing interface. |
| `@maharudra/agentic-ai-infra-core` | `SupervisorRouteInput` | Safe task metadata plus registry. |
| `@maharudra/agentic-ai-infra-core` | `SupervisorRoutePlan` | Non-empty agent route plus composition mode. |
| `@maharudra/agentic-ai-infra-runtime` | `DefaultSupervisorPolicy` | Deterministic manager-first policy. |
| `@maharudra/agentic-ai-infra-runtime` | `AgentOrchestrator` | Runtime composition implementation. |
| `@maharudra/agentic-ai-infra-runtime` | `AgentOrchestratorOptions` | Constructor dependency shape. |
| `@maharudra/agentic-ai-infra-runtime` | `OrchestratorReport` | Aggregate run report. |
| `@maharudra/agentic-ai-infra-runtime` | `OrchestratorSubRun` | One executor invocation in an aggregate report. |
| `@maharudra/agentic-ai-infra-runtime` | `OrchestratorRefusal` | Typed denial metadata when present. |
| `@maharudra/agentic-ai-infra-runtime` | `RuntimeServiceContainer.orchestrator` | Auto-wired runtime entry point. |
