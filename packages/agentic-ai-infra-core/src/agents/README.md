# Agents Contracts Module

The agents module defines how project agent workflows describe runtime style and shared context.

## Main Types

- `AgentRuntimeMode` distinguishes single-agent and token-efficient multi-agent operation.
- `SafeTaskMetadata` stores task hash, type, labels, and risk flags instead of raw task text.
- `SharedContextConfig` describes the shared context packet used by multi-agent workflows.
- `AgentRuntimeConfig` groups the runtime mode and shared-context settings.
- `MultiAgentRunReport` summarizes routed roles, role slices, deterministic outputs, and token savings.

## Call Flow

```txt
┌────────────────────┐
│ AgentRuntimeConfig │
└─────────┬──────────┘
          ▼
┌────────────────────┐
│ Token Budget Config│
└─────────┬──────────┘
          ▼
┌────────────────────┐
│ Context Builder    │
└─────────┬──────────┘
          ▼
┌────────────────────┐
│ Agent Workflow     │
└────────────────────┘
```

Agent settings stay separate from runtime startup so projects can change workflow strategy without changing transport security.
