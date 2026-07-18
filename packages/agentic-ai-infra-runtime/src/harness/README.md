# Harness Module

The harness module is the runtime tool execution boundary.

## Classes

- `AgentHarness`: checks policy, approval, handler execution, output sanitization, token recording, and trajectory recording.
- `DefaultPermissionGate`: enforces runtime mode, remote-safe metadata, role permissions, disabled capability classes, and optional agent-definition policies.
- `DefaultApprovalPolicy`: enforces exact approval for mutating or sensitive tools.
- `SafeOutputSanitizer`: removes unsafe output fields and redacts unsafe values.

```txt
┌──────────────┐
│ AgentHarness │
└──────┬───────┘
       ├── uses → DefaultPermissionGate
       ├── uses → DefaultApprovalPolicy
       ├── uses → SafeOutputSanitizer
       ├── uses → ToolExecutionHandler
       ├── uses → TokenUsageRecorder
       └── uses → InMemoryTrajectoryRecorder
```

## Flow

```txt
┌──────────────┐
│ Tool Request │
└──────┬───────┘
       ▼
┌─────────────────┐
│ Permission Gate │
└──────┬──────────┘
       ▼
┌─────────────────┐
│ Approval Policy │
└──────┬──────────┘
       ▼
┌─────────────────┐
│ Handler         │
└──────┬──────────┘
       ▼
┌─────────────────┐
│ Sanitizer       │
└──────┬──────────┘
       ▼
┌─────────────────┐
│ Safe Recorders  │
└─────────────────┘
```

## Stage 24 additions

`EvalHarness` (in `eval-harness.ts`) was added alongside `AgentHarness`. The
two share no implementation — `AgentHarness` is the tool execution security
layer (permission → approval → handler → sanitize → record); `EvalHarness`
registers and dispatches eval suites.

`aggregateReports(reports: readonly QualityReport[]): AggregateQualityReport`
is also exported here for use by MCP eval tool handlers.

## Agent identity policy

`AgentHarness.executeTool()` accepts an optional `agentId`. When the default
permission gate also has an `AgentDefinitionRegistry`, the gate resolves that id
before a tool handler can run:

```typescript
const harness = new AgentHarness({
  tools,
  handlers,
  agentRegistry
});

await harness.executeTool({
  toolId: "agentic.context.build",
  runtimeMode: "local-stdio-mcp",
  agentId: "manager"
});
```

The check is deliberately additive. If `agentId` is absent, or the harness was
constructed without a registry, the gate keeps the baseline runtime-mode,
remote-safe, role-floor, shell, network, and SQL checks. If the registry resolves
the agent, `allowedTools` refuses tools outside the agent allowlist after the
shared remote-safe checks. An approval-gated mutation continues to the exact
approval policy: matching text reaches the handler, while missing or incorrect
text returns `runtime.approval-required` with the typed refusal reason.

```txt
Tool request
  |
  v
Permission gate
  |
  +-- runtime mode / network / shell / SQL / role / remote-safe checks
  |
  +-- agentId + registry + allowedTools excludes tool id
  |      -> refusalReason: agent-allowlist
  |
  v
Exact approval policy
  +-- missing/mismatch -> runtime.approval-required
  +-- match -> handler -> sanitizer -> safe recorders
```
