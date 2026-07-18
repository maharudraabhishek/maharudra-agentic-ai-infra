# Agents Module

The agents module implements deterministic provider-free executors.

## Classes

- `SingleAgentExecutor`: creates a bounded local plan for one agent.
- `TokenEfficientMultiAgentExecutor`: routes required roles over one shared context packet.
- `DeterministicAgentRouter`: classifies tasks and selects roles.
- `RoleContextSlicer`: creates role-specific slices without duplicating full context.
- `SynthesisEngine`: builds a bounded deterministic synthesis.

## Canonical single-agent identity

`SingleAgentExecutor.execute()` accepts an optional registered `agentId` and a
caller trace id. With a registry configured, it resolves the id once and uses
the same definition for role attribution, tool policy, token budget, response
policy, and eval rules. An explicitly unknown id fails closed.

```typescript
await executor.execute({
  task: "Review the authorization boundary",
  agentId: "security-specialist",
  traceId: "trace-review-1"
});
```

Context sources are available evidence, not automatic citations. A source in a
context package is not reported as cited unless an executor explicitly
attributes output to it.

```txt
┌──────────────────────────────────┐
│ TokenEfficientMultiAgentExecutor │
└──────────────┬───────────────────┘
               ├── uses → DeterministicAgentRouter
               ├── uses → RoleContextSlicer
               └── uses → SynthesisEngine

┌─────────────────────┐
│ SingleAgentExecutor │
└──────────┬──────────┘
           └── uses → SynthesisEngine
```

## Flow

```txt
┌──────┐
│ Task │
└──┬───┘
   ▼
┌───────────────────┐
│ taskHash/taskType │
└──┬────────────────┘
   ▼
┌───────────────────────┐
│ Shared Context Packet │
└──┬────────────────────┘
   ▼
┌───────────────────────┐
│ Role Slices           │
└──┬────────────────────┘
   ▼
┌────────────────────────────┐
│ Deterministic Role Outputs │
└──┬─────────────────────────┘
   ▼
┌───────────────────────┐
│ Bounded Synthesis     │
└───────────────────────┘
```
