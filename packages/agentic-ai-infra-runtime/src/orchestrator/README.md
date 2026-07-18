# Runtime Supervisor Policy

This module provides the default runtime implementation of the core
`SupervisorPolicy` contract. It is intentionally a pure registry lookup: it
does not execute agents, access external systems, or add a container service.

## Public surface

| Export | Responsibility |
| --- | --- |
| `DefaultSupervisorPolicy` | Selects the canonical manager id, then the first manager-role fallback. |
| `AgentOrchestrator` | Composes supervisor-selected single, sequential, or parallel routes with post-run content and feedback seams. |
| `AgentOrchestratorOptions` | Injects the route policy, single-agent execution port, forward-compatible multi-agent executor, registry, and optional guardrail seams. |
| `OrchestratorRunInput` | Supplies raw task text, an optional caller trace id, bounded context, and permitted tools. |
| `OrchestratorSubRun` | Discriminates single-agent and multi-agent executor reports and records attempts. |
| `OrchestratorRefusal` | Captures a typed orchestration-level denial without implementation details. |
| `OrchestratorReport` | Aggregates planned agents, sub-runs, synthesis, usage, and mandatory guardrail verdicts. |

## Usage

```typescript
const result = new DefaultSupervisorPolicy().route({ task: safeTask, registry });

if (!result.ok) {
  // The registry has no manager; no execution should start.
  return result;
}
```

The implementation returns `agent.no-manager-registered` with fatal severity
when no manager is available. It never substitutes another role or throws.

## Agent composition

`AgentOrchestrator` is the Layer 10 composition boundary. It turns raw task text
into safe metadata for routing, invokes one injected single-agent execution port
per planned sub-run, then records the output-only content and feedback verdicts
in one aggregate report. The guard and feedback seams default to no-op
implementations, so adding the orchestrator does not activate model calls,
network access, or extra policy behavior.

```typescript
const orchestrator = new AgentOrchestrator({
  supervisorPolicy: new DefaultSupervisorPolicy(),
  singleAgentExecutor: new SingleAgentExecutor({ config }),
  multiAgentExecutor: new TokenEfficientMultiAgentExecutor({ config }),
  agentRegistry: registry
});

const result = await orchestrator.run({
  task: "Review the runtime architecture",
  traceId: "caller-trace"
});
```

Every supervisor result is canonicalized by registered id before execution.
The executor receives that id and the outer trace id, and its report must return
both unchanged. This prevents forged policy or observability attribution.

The single route preserves the direct single-agent execution path. Sequential
and parallel routes run one single-agent sub-run per planned agent through the
shared retry primitive, then merge role-prefixed summaries and aggregate token
usage. The injected multi-agent executor is retained for container wiring and
future homogeneous fan-out; current composition does not call it. Bounded
shared-context composition remains a required follow-up.

## Composition call flow

The orchestrator preserves three boundaries: routing never receives raw task
text, the executor remains responsible for execution, and guard/feedback hooks
only inspect the completed bounded synthesis. Sequential composition threads
prior summaries into the next agent's task; parallel composition waits for every
branch with `Promise.allSettled` and keeps successful branches when at least one
agent succeeds.

```txt
OrchestratorRunInput.task
        |
        v
classifyTask() --> SupervisorPolicy.route({ task, registry })
                                |
                                v
             +-------------------+-------------------+
             |                   |                   |
             v                   v                   v
          single             sequential           parallel
             |                   |                   |
             v                   v                   v
 SingleAgentExecutor   runWithRetry(agent 1)   Promise.allSettled(
      .execute(...)         |                    runWithRetry(agent N)
             |              v                   )
             |        runWithRetry(agent N)          |
             +-------------------+-------------------+
                                 |
                                 v
                  role-prefixed synthesis + token totals
                                 |
                                 v
              response policy action (when configured)
                                 |
                                 v
              ContentGuard.inspect(output synthesis)
                 | block -> failed FrameworkResult
                 | rewrite -> safe replacement only
                                 |
                                v
              FeedbackHook.evaluate(run and trace ids)
                                |
                                v
                       OrchestratorReport
```

`OrchestratorReport` intentionally does not extend the multi-agent executor
report, whose literal runtime invariants do not describe a composed run.
Consumers safely branch on `subRun.executorReport.kind` before using a
single-agent `result` or multi-agent `synthesis`.

```typescript
import type { OrchestratorSubRun } from "@maharudra/agentic-ai-infra-runtime";

function summaryFor(subRun: OrchestratorSubRun): string {
  return subRun.executorReport.kind === "single"
    ? subRun.executorReport.report.result.summary
    : subRun.executorReport.report.synthesis;
}
```

Injected supervisor, executor, guard, and feedback implementations are trust
boundaries. Unexpected throws become sanitized `framework.internal-error`
results. Response `ask`/`abstain` and content `block` actions do not return the
rejected synthesis.

## Call flow

```txt
SupervisorRouteInput
        |
        v
DefaultSupervisorPolicy.route()
        |
        +--> findById("manager")
        |          |
        |          +--> single manager plan
        |
        +--> findByRole("manager")[0]
                   |
                   +--> single manager plan or fatal failure
```

## Report-shape flow

The following type relationship preserves executor-specific information without
claiming that an aggregate orchestration run satisfies executor-only invariants.

```txt
OrchestratorReport (kind: "orchestrator"; sibling of executor reports)
        |
        +--> subRuns[]: OrchestratorSubRun
                    |
                    +--> kind: "single" --> SingleAgentRunReport.result
                    |
                    +--> kind: "multi"  --> RuntimeMultiAgentRunReport.synthesis
```
