# Stage 26 — Phase 04 — Wire `approval-required` + `agent-allowlist` refusals; `agentId` plumbing

ONE phase, ONE session. Wire the two reserved `RefusalReason` codes through
`DefaultPermissionGate`, and thread agent identity to the gate via `agentId?` on
`AgentHarnessToolInput`.

---

## BEFORE YOU START — read these from source

1. `packages/agentic-ai-infra-runtime/src/harness/index.ts`:
   - `DefaultPermissionGate.decide(input: PermissionGateInput): PermissionDecision`
     (line ~166). Read ALL existing branches and their ORDER:
     1. `mode-not-allowed`  2. `network-blocked`  3. `shell-blocked`
     4. `arbitrary-sql-blocked`  5. `role-floor`  6. `remote-safe`  → then `allowed:true`.
   - The explicit TODO comment near line ~219:
     `// TODO D35 — Stage 26 will plumb "approval-required" and "agent-allowlist" ...`
     This is the wiring point. Replace the TODO with real branches.
2. `packages/agentic-ai-infra-core/src/security/types.ts`:
   - `PermissionGateInput` (line ~47) — `{ runtimeMode, tool, requestedCapability, agentRole? }`.
     **There is NO `agentId` yet.** You add it.
   - `RefusalReason` (line ~21) — `approval-required` and `agent-allowlist` already exist.
   - `PermissionDecision` — `{ allowed, reason, requiredApproval?, refusalReason? }`.
   - `ApprovalPolicy` — read its shape; confirm the field used to require approval
     (grep `requiresApproval` in core).
 3. `packages/agentic-ai-infra-core/src/agents/types.ts`:
    - `AgentDefinition.approvalPolicy?: AgentApprovalPolicy` and `.allowedTools?`.
    - CONFIRMED: `AgentApprovalPolicy = { readonly requiresApproval?: boolean }` (line ~399).
    - `AgentDefinitionRegistry.findById(id)`.
4. `packages/agentic-ai-infra-core/src/harness/types.ts`:
   - `AgentHarnessToolInput` — confirm it has `agentRole?: AgentRole` (line ~24) and NO
     `agentId`. You add `agentId?: string`.
   - Find where `AgentHarnessToolInput` flows into a `PermissionGateInput` (grep
     `decide(` in `runtime/src/harness/index.ts`, line ~424) so you thread `agentId` through.
5. `packages/agentic-ai-infra-runtime/src/agents/index.ts`:
   - `enforceAllowedTools(...)` — the planning-time filter (grep it). Confirm it SILENTLY
     filters disallowed ids. The gate branch you add is the **execution-time** second guard
     (defense in depth) — it does NOT replace `enforceAllowedTools`.
6. `packages/agentic-ai-infra-runtime/src/feedback-loops/retry-loop.ts`:
   - The `NEVER_RETRY` set. **Confirm it already contains `runtime.approval-required` and
     `agent.tool-not-in-allowlist`.** These are `ErrorCode`s. The refusal codes you wire
     (`approval-required`, `agent-allowlist`) are `RefusalReason` VALUES — a different
     taxonomy. **DO NOT add `RefusalReason` strings to `NEVER_RETRY`** — that set is keyed on
     `ErrorCode`. (This corrects §6 of the architectural-design doc, which conflated the two.)

---

## LOCKED DECISIONS THIS PHASE HONORS

- **D-F1**: add `agentId?: string` to `AgentHarnessToolInput`. When present AND the registry
  has a definition for that id, the gate reads `approvalPolicy` and `allowedTools`. When absent
  (legacy callers / current test setups), the gate behaves exactly as Stage 25.5 (D23).
- **NEVER_RETRY needs NO extension** — `runtime.approval-required` and
  `agent.tool-not-in-allowlist` are already in the set; the new refusals map onto existing
  error codes / existing deny semantics. This is your locked decision and it is confirmed by
  source. Do not touch `NEVER_RETRY` in this phase.
- **The gate needs the registry.** `DefaultPermissionGate` does not hold one today. Add an
  optional constructor dependency `agentRegistry?: AgentDefinitionRegistry`. When absent, the
  two new branches are inert (the gate cannot look up agent policy) → D23-safe.
- **Branch order**: the agent-level `approval-required` check goes EARLY (before
  `mode-not-allowed`) — it is a coarse refusal: if the agent requires approval and none was
  given, there is no point checking mode/network/shell. The `agent-allowlist` check goes where
  the TODO sits (after `remote-safe`, before final `allowed:true`).
- **`approval-required` reuses the existing error code path.** The typed
  `refusalReason: "approval-required"` is ADDITIVE on the `PermissionDecision`; the existing
  free-form `reason: string` stays. Do not invent a new `ErrorCode`.

---

## FILES TO CHANGE

### MODIFY — `packages/agentic-ai-infra-core/src/harness/types.ts`

Add ONE optional field to `AgentHarnessToolInput`, beside `agentRole?`:

```typescript
  /**
   * Stable id of the calling agent (Stage 26). When present and the gate has a
   * registry with a matching `AgentDefinition`, the gate enforces that agent's
   * `approvalPolicy` and `allowedTools`. Absent → Stage 25.5 behavior (D23).
   */
  readonly agentId?: string;
```

### MODIFY — `packages/agentic-ai-infra-core/src/security/types.ts`

Add `agentId?: string` to `PermissionGateInput`, beside `agentRole?`:

```typescript
  readonly agentId?: string;
```

### MODIFY — `packages/agentic-ai-infra-runtime/src/harness/index.ts`

1. Give `DefaultPermissionGate` an optional registry dependency. Confirm the current
   constructor (it may be parameterless today). Add:

```typescript
export class DefaultPermissionGate implements PermissionGate {
  constructor(private readonly agentRegistry?: AgentDefinitionRegistry) {}
  // ...
}
```

   Then update every construction site of `DefaultPermissionGate` (grep
   `new DefaultPermissionGate(`) — most will keep passing nothing (inert, D23). The harness/
   container wiring that HAS a registry passes it. **List every call site you touched in the
   changelog.**

2. **EARLY branch — agent approval** (insert as the FIRST check inside `decide`, before
   `mode-not-allowed`):

```typescript
    // Stage 26: agent-level approval. Coarse refusal — checked before tool policy.
    if (input.agentId && this.agentRegistry) {
      const def = this.agentRegistry.findById(input.agentId);
      // CONFIRMED in source: AgentApprovalPolicy.requiresApproval?: boolean.
      const agentRequiresApproval = def?.approvalPolicy?.requiresApproval === true;
      // Reuse the EXACT mutating predicate the tool-level path uses — do not
      // reinvent it. DefaultApprovalPolicy.requiresApproval(tool) returns true
      // for runtimePolicy.requiresApproval | mutatesState | migrationAccess,
      // category "write" | "admin", riskLevel "high" | "critical".
      const toolIsMutating = new DefaultApprovalPolicy().requiresApproval(tool);
      if (agentRequiresApproval && toolIsMutating) {
        return {
          allowed: false,
          reason: `Agent "${input.agentId}" requires approval for "${tool.id}".`,
          refusalReason: "approval-required" satisfies RefusalReason
        };
      }
    }
```

> CONFIRMED in source (do not re-derive): `AgentApprovalPolicy = { requiresApproval?: boolean }`
 > at `core/src/agents/types.ts:399`. The mutating predicate is the public method
 > `DefaultApprovalPolicy.requiresApproval(tool: ToolContract): boolean` at
 > `runtime/src/harness/index.ts:295`. Reuse it exactly as shown (construct a
 > `DefaultApprovalPolicy` or hoist a shared instance). The agent-level gate is coarse:
 > `agentRequiresApproval && toolIsMutating` → refuse with `approval-required`. There is no
 > per-tool approval-text check at the agent gate; exact-text matching stays in the
 > tool-level `DefaultApprovalPolicy.check()` path, untouched.

3. **LATE branch — agent allowlist** (replace the TODO at line ~219, after the `remote-safe`
   block, before the final `return {allowed:true}`):

```typescript
    // Stage 26: execution-time allowlist guard (defense in depth on top of the
    // planning-time enforceAllowedTools filter). They should always agree; the
    // gate is the safety net if they ever drift.
    if (input.agentId && this.agentRegistry) {
      const def = this.agentRegistry.findById(input.agentId);
      if (def?.allowedTools && !def.allowedTools.includes(tool.id)) {
        return {
          allowed: false,
          reason: `Tool "${tool.id}" is not in agent "${input.agentId}" allowedTools.`,
          refusalReason: "agent-allowlist" satisfies RefusalReason
        };
      }
    }
```

   Note `allowedTools: []` (empty) means "no tools" → any tool id refuses. `allowedTools:
   undefined` means "no per-agent restriction" → branch is skipped. Match the Stage 25
   semantics documented on `AgentDefinition.allowedTools`.

4. Where `AgentHarnessToolInput` is converted into a `PermissionGateInput` (line ~424), pass
   `agentId: input.agentId` through alongside the existing `agentRole`.

5. Add `AgentDefinitionRegistry` to the import block if not present.

---

## TESTS TO ADD (+8) — `packages/agentic-ai-infra-runtime/test/harness/refusal-wiring.test.ts`

Read `test/...` harness tests first for the gate construction + tool-contract fixtures.

`approval-required` (3):
1. Agent with `approvalPolicy.requiresApproval === true` + mutating tool + no approval →
   `allowed:false`, `refusalReason === "approval-required"`.
2. Same agent + non-mutating (read) tool → allowed (approval is coarse but still gated on the
   mutating predicate — assert the actual predicate behavior you implemented).
3. `agentId` present but registry absent (gate constructed with no registry) → branch inert,
   behaves as Stage 25.5 (allowed if tool policy allows).

`agent-allowlist` (3):
4. Agent with `allowedTools: ["other.tool"]` calling `tool.id` not in list → `allowed:false`,
   `refusalReason === "agent-allowlist"`.
5. Agent with `allowedTools` INCLUDING the tool id → allowed.
6. Agent with `allowedTools: undefined` → branch skipped, allowed (D23 no-restriction).

agreement + D23 (2):
7. **enforceAllowedTools ↔ gate agreement** — a tool filtered out at planning time by
   `enforceAllowedTools` also refuses at the gate with `agent-allowlist` (assert both layers
   reject the same id).
8. **D23 regression** — a `PermissionGateInput` with NO `agentId` produces byte-identical
   decisions to Stage 25.5 across all six original branches (pick 2-3 representative branches:
   `mode-not-allowed`, `role-floor`, the `allowed:true` happy path).

---

## SELF-REVIEW CHECKLIST

- [ ] `NEVER_RETRY` is UNCHANGED. (Grep the file; diff is empty for retry-loop.ts.)
- [ ] `approval-required` reuses the existing error/decision path — no new `ErrorCode` added.
- [ ] The `requiresApproval` field name matches `AgentApprovalPolicy` exactly (grep-confirmed).
- [ ] The "mutating tool" predicate is the SAME one `DefaultApprovalPolicy` uses — not a
      reinvented check.
- [ ] Both new branches are inert when `agentId` OR registry is absent (D23).
- [ ] `agentId` threaded: `AgentHarnessToolInput` → `PermissionGateInput` → `decide()`.
- [ ] Every `new DefaultPermissionGate(...)` call site compiles (optional arg → most unchanged).
- [ ] `satisfies RefusalReason` used on both new refusal strings (matches existing branch style).
- [ ] Branch ORDER: approval EARLY (first), allowlist LATE (where TODO was).
- [ ] `allowedTools: []` vs `undefined` semantics correct.

## WHAT NOT TO DO

- Do NOT add any code to `NEVER_RETRY`.
- Do NOT add a new `ErrorCode` (no `agent.approval-required` etc. — reuse existing).
- Do NOT remove or alter `enforceAllowedTools` — the gate is additive defense in depth.
- Do NOT make `agentId` or the registry non-optional (breaks D23 + every call site).
- Do NOT reference LangGraph / LangChain / AutoGen / CrewAI / BM25-as-library.
- Do NOT touch the orchestrator class (Phase 03's file) in this phase.

## CI + COMMIT

> RUNNER NOTE: `pnpm.cmd` is the Windows/PowerShell form. On a Linux runner (Codex cloud,
> CI container) use `pnpm run ci`. Do ONLY this phase, then STOP — do not begin the next phase
> in the same session, even if context remains.
```
pnpm.cmd run ci         # expect test 555/555 ✓
```
Changelog `changelog/stage-26/stage-26-phase-04-<date>.md` — list every `DefaultPermissionGate`
call site touched; explicitly note "NEVER_RETRY unchanged; refusal codes are RefusalReason
values, not ErrorCodes." Then:
```
git commit -m "feat(harness): wire approval-required + agent-allowlist refusals; agentId plumbing (Stage 26 P04)"
```

## DONE SIGNAL

- Final test count (expect 555).
- The exact `AgentApprovalPolicy` field name used for "requires approval".
- The mutating-tool predicate reused (where it came from).
- Confirmation `NEVER_RETRY` is byte-unchanged.
- 3-line RESULTS_SUMMARY.
