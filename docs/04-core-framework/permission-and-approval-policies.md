# Permission And Approval Policies

Permission and approval policies protect tool execution.

```txt
┌──────────────┐
│ Tool Request │
└──────┬───────┘
       ▼
Runtime mode allowed?
├── No → Typed denial
└── Yes
    ▼
    Role allowed?
    ├── No → Typed denial
    └── Yes
        ▼
        Approval required?
        ├── No → Handler execution → Sanitized output
        └── Yes
            ▼
            Exact approval matched?
            ├── No → Typed denial
            └── Yes → Handler execution → Sanitized output
```

## Registration-time enforcement

Permission enforcement operates at two layers. The first layer — registration time — catches structural, static violations when a tool is added to the registry. The second layer — call time — handles dynamic, contextual decisions that depend on who is calling and with what approval.

```txt
  REGISTRATION TIME (static — evaluated once per tool per startup)
  ────────────────────────────────────────────────────────────────
  PolicyEnforcingToolRegistry.register(contract)
        │
        ├─ Remote mode active?
        │   └─ isRemoteSafeTool(contract) must be true
        │       Checks: category not in {write, command, admin}
        │               riskLevel not high or critical
        │               no shellAccess / localFilesystem / migrationAccess / arbitrarySqlAccess
        │               output not raw files / vectors / SQL / stack traces / local paths
        │               remoteSafe flag set on both runtimePolicy and outputPolicy
        │
        ├─ riskLevel === "critical"?
        │   └─ Blocked — no RuntimeConfig permit mechanism exists (fail closed)
        │
        └─ shellAccess or category === "command"?
            └─ Blocked unless localStdioMcp.allowShell is true and no remote mode active

  CALL TIME (dynamic — evaluated per tool invocation)
  ────────────────────────────────────────────────────────────────
  DefaultPermissionGate.decide(input)
        │
        ├─ Tool allowed in this runtime mode? (allowedModes check)
        ├─ Network access disabled?
        ├─ Shell / command blocked?
        ├─ Arbitrary SQL blocked?
        ├─ Agent role permits this tool?
        └─ Remote mode: re-runs isRemoteSafeTool as defense in depth
```

**What registration time catches:** structural properties that are constants on the ToolContract. A remote-unsafe tool registered in a remote-mode runtime, a critical-risk tool with no explicit permit, or a shell-access tool in a non-shell config will all fail at startup with a descriptive error.

**What call time catches:** contextual properties that are only known per request — which agent role is invoking the tool, whether the approval text matches exactly, and dynamic mode overrides.

**Example — registration failure:**

```typescript
// Config declares a remote surface:
const config: RuntimeConfig = { modes: ["remote-http-mcp"] };

// This tool is local-filesystem-only and cannot cross the remote boundary:
const localTool: ToolContract = {
  id: "project.file.read",
  category: "read",
  riskLevel: "medium",
  runtimePolicy: {
    allowedModes: ["local-stdio-mcp"],
    remoteSafe: false,
    localFilesystem: true
  },
  outputPolicy: { remoteSafe: false }
  // ...
};

// createRuntimeToolRegistry throws ToolRegistrationPolicyError at startup:
// "Tool "project.file.read" cannot be registered in remote-http-mcp mode:
//  does not satisfy the remote-safe predicate."
const registry = createRuntimeToolRegistry([localTool], config);
```

The error surfaces at service container construction time, before the MCP server binds or accepts any request.

## Permission Gate

The permission gate checks runtime mode, remote-safe metadata, shell access, network access, arbitrary SQL access, migration access, and role-level tool permissions.

Remote-safe surfaces reject local filesystem, write, shell, migration, arbitrary SQL, raw file, vector, raw SQL, stack trace, command-output, and local-path exposure.

## Exact Approval

Mutating or sensitive tools require exact approval. Migration execution uses:

```txt
RUN_AGENTIC_AI_INFRA_MIGRATIONS
```

Approval text is never stored, logged, displayed, hashed into public summaries, or sent to the dashboard. Records store only `approvalMatched`, `policyId`, and safe error code.
