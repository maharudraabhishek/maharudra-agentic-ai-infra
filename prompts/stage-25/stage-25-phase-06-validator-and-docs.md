# Stage 25 Phase 06 — Validator + Docs (Final Phase)
## Claude Code Prompt — MahaRudra Agentic AI Infra

---

## BEFORE YOU START — READ THIS FIRST

**Platform:** Windows 11, PowerShell, Node >= 20, pnpm only
**CI command:** `pnpm run ci`
**Starting test count:** 472/472 passing (Phase 05 complete)
**Expected test count after this phase:** ~475 passing (+3)

This prompt is self-contained. Do not invent details not stated here.
Do not modify any file not listed in the "FILES TO CHANGE" section.

This is the FINAL phase of Stage 25. After this phase, Stage 25 is done
and the next stage can begin.

---

## CONTEXT — WHAT IS DONE (locked from Phases 01–05)

- All types and runtime impl in place from Phases 01–05
- `validateDuplicateIds()` helper exists in `core/src/config/validator.ts:274` — reused here
- `DefaultConfigValidator.validate()` already calls `validateDuplicateIds` for tools, extensions, etc.
- `STATUS.md`, `kb.md`, `docs/internal/v3-architecture-snapshot.md` follow the format established in Stages 23–24
- Stage 25 design docs `p2_5-p6-complete-design.md`, `agentic-system-design-gpt.md` already describe Stage 25 at the planning level; we now publish the as-built docs

---

## SCOPE

This phase:

1. Adds duplicate-id validation for `config.agents.agents` in `DefaultConfigValidator`
2. Creates the public reference doc `docs/04-core-framework/agent-definition-and-registry.md`
3. Creates the internal learning note `docs/internal/learning-notes/stage-25-agent-definition.md`
4. Updates `docs/internal/v3-architecture-snapshot.md` — Stage 25 row(s)
5. Updates `STATUS.md` — Stage 25 phase entries
6. Updates `kb.md` — Stage 25 session entry with D18–D24
7. Adds 3 tests in `core/test/config-validator.test.ts`

---

## FILES TO CHANGE

```
packages/agentic-ai-infra-core/src/config/validator.ts              (modify — duplicate-id check)
packages/agentic-ai-infra-core/test/config-validator.test.ts        (modify — 3 new tests)
docs/04-core-framework/agent-definition-and-registry.md             (new — public reference)
docs/internal/learning-notes/stage-25-agent-definition.md           (new — internal learning note)
docs/internal/v3-architecture-snapshot.md                           (modify — Stage 25 rows)
STATUS.md                                                            (modify — phase summary)
kb.md                                                                (modify — session entry)
```

---

## CHANGE 1 — `packages/agentic-ai-infra-core/src/config/validator.ts`

Find the body of `DefaultConfigValidator.validate()`. Locate the existing
block that calls `validateDuplicateIds(...)` for extensions (around line
692). Add a new call BEFORE that block, validating agent profile ids.

The existing block:

```typescript
    validateDuplicateIds(
      resolved.extensions.map((extension) => extension.id),
      issues,
      "extensions"
    );
```

Add immediately BEFORE it:

```typescript
    // Stage 25 — agent profile id duplication is detected early so
    // `createAgentDefinitionRegistry()` does not throw at runtime. The
    // registry's register-time check is a defense in depth; this is the
    // user-facing validation surface.
    if (resolved.agents.agents !== undefined) {
      validateDuplicateIds(
        resolved.agents.agents.map((profile) => profile.id),
        issues,
        "agents.agents"
      );
    }
```

`resolved.agents` is non-optional after resolution (it's part of the
resolved profile config), but `agents.agents` (the profile list) is
optional — hence the `!== undefined` guard. The `validateDuplicateIds`
helper itself accumulates `ValidationIssue` entries into the shared
`issues` array; it does not return anything.

---

## CHANGE 2 — `packages/agentic-ai-infra-core/test/config-validator.test.ts`

Find an existing `describe` block in the test file (most likely
"DefaultConfigValidator" or similar). Append three new tests inside it,
OR add a new describe block at the end:

```typescript
describe("DefaultConfigValidator — agent profile duplicate-id check (Stage 25)", () => {
  it("accepts config with no agent profiles", () => {
    const result = new DefaultConfigValidator().validate({
      project: { name: "T", slug: "t" },
      profiles: ["minimal"]
    });
    expect(result.ok).toBe(true);
  });

  it("accepts config with distinct agent profile ids", () => {
    const result = new DefaultConfigValidator().validate({
      project: { name: "T", slug: "t" },
      profiles: ["minimal"],
      agents: {
        mode: "single-agent",
        agents: [
          { id: "mgr", role: "manager" },
          { id: "sec", role: "security-reviewer" }
        ]
      }
    });
    expect(result.ok).toBe(true);
  });

  it("reports config.duplicate-id when agent profile ids collide", () => {
    const result = new DefaultConfigValidator().validate({
      project: { name: "T", slug: "t" },
      profiles: ["minimal"],
      agents: {
        mode: "single-agent",
        agents: [
          { id: "shared", role: "manager" },
          { id: "shared", role: "security-reviewer" }
        ]
      }
    });
    // The validator accumulates the issue but the validate() method
    // returns ok with issues for non-fatal validation problems. If your
    // validator returns `fail()` for any duplicate-id, this assertion
    // needs adjustment — match the existing pattern other duplicate-id
    // tests use (e.g. for tools, extensions).
    if (result.ok) {
      // Some validators expose issues via .value.validationIssues or
      // similar — adapt to local convention.
      throw new Error(
        "Expected duplicate-id validation to surface; check validator output shape."
      );
    } else {
      expect(result.error.code).toBe("config.duplicate-id");
    }
  });
});
```

**Adapt the third test's assertion to your validator's existing behavior.**
If `validateDuplicateIds` accumulates issues without failing, look at the
issues array. If it fails the validate() call, use `expect(result.ok).toBe(false)`.
The existing tool/extension duplicate-id tests in this file are the
template — match their pattern exactly.

---

## CHANGE 3 — `docs/04-core-framework/agent-definition-and-registry.md` (NEW)

Create this file:

```markdown
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
| `approvalPolicy`   | declared | declared | ✅ enforced |

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

const container = createRuntimeServiceContainer(config, {
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
- Execution-time per-agent enforcement (the harness checking the agent's
  allowedTools at every tool call) is not implemented; planning-time
  enforcement plus the existing role × category floor are the bounds today.

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
```

---

## CHANGE 4 — `docs/internal/learning-notes/stage-25-agent-definition.md` (NEW)

Create this file:

```markdown
# Stage 25 — AgentDefinition + AgentDefinitionRegistry

## What we built

P4 Layer 10 foundation: declarative per-agent configuration with planning-time
enforcement of `allowedTools` and `budgetPolicy`, and a single-agent eval
push driven by `evalRules`.

Six phases:

1. Core types — `AgentDefinition`, `AgentDefinitionRegistry`, 6 policy types, 3 error codes, deprecated legacy interfaces
2. Registry impl — `InMemoryAgentDefinitionRegistry`, factory, 6 default definitions
3. Container wiring — `agentRegistry` non-optional on container, optional override
4. Executor enforcement — `enforceAllowedTools`, `effectiveBudgetCeiling`, wired into both executors
5. Single-agent evals — `runSingleAgentEvals`, push from `SingleAgentExecutor`
6. Validator + docs — duplicate-id check, public reference, this learning note

## New locked decisions

| # | Decision | Rationale |
|---|---|---|
| D18 | Legacy `AgentRegistry` and `AgentRouter` interfaces deprecated, not removed | Zero callers but removal is unnecessary breakage |
| D19 | `AgentDefinition = AgentProfile & PolicyFields` (intersection) | Single source of truth for identity fields |
| D20 | `allowedTools` is a TIGHTENING filter on top of `roleAllowsTool()`; planning-time only in Stage 25 | Defense in depth; execution-time enforcement is Stage 26 |
| D21 | `AgentDefinitionRegistry` interface read-only; mutation on concrete class | Correct DI pattern |
| D22 | `agentRegistry` non-optional on `RuntimeServiceContainer` | D16 evalStore/evalHarness precedent |
| D23 | Default definitions have NO policy fields set | Backwards-compatibility is non-negotiable |
| D24 | `runSingleAgentEvals()` is a separate function; push only when `evalRules` set | Avoid junk records, separate from multi-agent eval D17 |

## What we deferred

| Concern | Deferred to | Why |
|---|---|---|
| `AgentOrchestrator`, `SupervisorPolicy`, `HandoffPolicy`, `ResultMerger` | Stage 26 | Need `AgentDefinition` complete first |
| Execution-time per-agent enforcement in harness | Stage 26 | Requires `agentId` plumbing through `AgentHarnessToolInput` |
| `modelPolicy`, `retrievalPolicy` enforcement | Stage 26 | Needs orchestrator + per-agent `SmartRouter` call |
| `memoryPolicy`, `approvalPolicy` enforcement | Stage 27+ | Memory subsystem not yet designed |
| `PostgresEvalStore` (migration 006) | Stage 27 | Eval store remains in-memory for now |
| Tool capability validation against live tool registry | Stage 26 | Would couple registry to `PolicyEnforcingToolRegistry` |
| Rich config schema for `AgentDefinition[]` | Stage 26 | Users construct custom registries for now |
| MCP tools exposing the registry (`agentic.agents.describe`, etc.) | Stage 26 | Half-built without orchestrator companion tools |

## Architectural choices we considered and rejected

**Reject: Extend the legacy `AgentRegistry` interface with new methods.**
The interface returns `AgentProfile`, which is too thin for orchestration.
Adding `findDefinitionById()` would create a hybrid that violates
single-responsibility. Cleaner: new interface, deprecate the legacy.

**Reject: Put `AgentDefinition[]` directly in `AgenticInfraProjectConfig`.**
Config is serializable; runtime definitions can include functions in
future. Keep config slim (profiles only) and promote to definitions at
runtime.

**Reject: Make `allowedTools` replace `roleAllowsTool()`.**
The role × category floor is a safety net (e.g. security-reviewer can
never use write tools). Replacing it with definition-driven per-agent
allowlists would make misconfigurations more dangerous. Layer, don't
replace.

**Reject: Add execution-time per-agent enforcement in Stage 25.**
Requires plumbing `agentId` through `AgentHarnessToolInput`, which couples
harness execution to registry lookup. That's an orchestration concern,
proper to Stage 26 where the orchestrator decides which agent owns each
tool call.

**Reject: Make `register()` part of the `AgentDefinitionRegistry` interface.**
Consumers should not be able to mutate the registry through the interface.
Mutation belongs on the concrete class, used only at construction.
(`EvalHarnessContract` chose differently in Stage 24 — locked legacy, but
we do the right thing for new code.)

**Reject: Make default definitions restrictive.**
Stage 24 had no per-agent restrictions. Making Stage 25 defaults
restrictive would break every existing project on upgrade. Defaults must
be inert (no policy fields) so Stage 25 is byte-for-byte compatible until
users opt in.

## Test count progression

| Phase | Tests | Δ |
|---|---|---|
| Start (Stage 24 complete) | 429 | — |
| After 25-01 | ~437 | +8 |
| After 25-02 | ~449 | +12 |
| After 25-03 | ~454 | +5 |
| After 25-04 | ~464 | +10 |
| After 25-05 | ~472 | +8 |
| After 25-06 | ~475 | +3 |

## Risks observed during build

- `RuntimeServiceContainer.agentRegistry` non-optional addition required
  updating 2 example files. No production callers needed updates.
- The placeholder policy types (`AgentModelPolicy` etc.) are tempting to
  not export. They must be exported so Stage 26 can extend them in place
  without breaking the public surface.
- TypeScript's structural typing means `AgentDefinition` is assignable to
  `AgentProfile` because of the intersection. This is intentional and
  documented but can surprise readers who expect a "wider" type to require
  explicit narrowing.

## What Stage 26 should pick up

1. `AgentOrchestrator` — composes registered definitions into a multi-agent
   workflow (handoffs, supervisor pattern, planner→executor→reviewer)
2. `SupervisorPolicy` — chooses among multiple definitions matching a role
3. Execution-time enforcement — plumb `agentId` through `AgentHarnessToolInput`
4. `modelPolicy` enforcement — per-agent `SmartRouter` calls
5. `retrievalPolicy` enforcement — per-agent context shaping
6. MCP tool surface for orchestration — `agentic.agents.describe`,
   `agentic.agents.handoff`, etc.
```

---

## CHANGE 5 — `docs/internal/v3-architecture-snapshot.md`

Find the existing snapshot. Look for the Layer 10 section (or whichever
section currently mentions agent runtime). Update the table or list to
reflect Stage 25 additions.

Add a new line in the Layer 10 row (or equivalent) showing:

```
Layer 10 — Agent Runtime, Harness & Orchestration  AgentDefinition + Registry  ✅ Stage 25
```

The exact format depends on existing formatting in that file. Match the
pattern used by other layers and other recently-added stages (24, 23).

Append a new section at the end documenting the surface added in Stage 25:

```markdown
## Stage 25 — AgentDefinition + AgentDefinitionRegistry

Added Layer 10 surface:

- `AgentDefinition` type (core) — intersection of `AgentProfile` + 7 policy fields
- `AgentDefinitionRegistry` interface (core) — read-only lookup
- `InMemoryAgentDefinitionRegistry` class (runtime) — concrete impl with `register()`
- `createAgentDefinitionRegistry(profiles?)` factory (runtime)
- `DEFAULT_AGENT_DEFINITIONS` constant — 6 inert defaults
- `runSingleAgentEvals(report, definition?)` function (runtime/evals)
- `RuntimeServiceContainer.agentRegistry: AgentDefinitionRegistry` — non-optional
- `RuntimeStartOptions.agentRegistry?` — optional override
- `ExecutorOptions.agentRegistry?` — optional, defaults to no enforcement
- `enforceAllowedTools` and `effectiveBudgetCeiling` helpers in `agents/index.ts`
- Validator surface: duplicate-id check on `config.agents.agents`

Enforced at planning time:
- `allowedTools` — intersection filter on `selectToolIds()` output
- `budgetPolicy.maxTokens` — `min(projectBudget, agentBudget)` ceiling

Declared but not yet enforced:
- `modelPolicy`, `retrievalPolicy` — Stage 26
- `memoryPolicy`, `approvalPolicy` — Stage 27+
```

---

## CHANGE 6 — `STATUS.md`

Find the existing STATUS.md. Add a new section for Stage 25 below the
Stage 24 section. Mirror the format of Stage 24's entry.

```markdown
## Stage 25 — AgentDefinition + AgentDefinitionRegistry (P4 Layer 10 Foundation)

**Status:** ✅ Complete

**Phases:**

- 25-01 core-types — `AgentDefinition`, `AgentDefinitionRegistry`, 6 policy types, 3 error codes
- 25-02 registry-impl — `InMemoryAgentDefinitionRegistry`, factory, defaults
- 25-03 container-wiring — `agentRegistry` non-optional on container, `ExecutorOptions.agentRegistry?` optional
- 25-04 executor-enforcement — `enforceAllowedTools`, `effectiveBudgetCeiling`, wired into both executors
- 25-05 single-agent-evals — `runSingleAgentEvals`, push from `SingleAgentExecutor`
- 25-06 validator-and-docs — duplicate-id check, public reference, snapshot/STATUS/kb

**Test count:** 429 → ~475 (+46)

**New locked decisions:** D18–D24 (see kb.md)

**Next:** Stage 26 — `AgentOrchestrator`, `SupervisorPolicy`, execution-time per-agent enforcement, `modelPolicy`/`retrievalPolicy` enforcement.
```

---

## CHANGE 7 — `kb.md`

Find the existing kb.md. Append a Stage 25 session entry at the end of the
sessions list, following the format used in prior sessions.

```markdown
## Session: Stage 25 — AgentDefinition + AgentDefinitionRegistry (2026-MM-DD)

**Scope:** P4 Layer 10 foundation — per-agent declarative configuration with planning-time enforcement.

**Phases:**

- 25-01 core-types (+8 tests)
- 25-02 registry-impl (+12 tests)
- 25-03 container-wiring (+5 tests)
- 25-04 executor-enforcement (+10 tests)
- 25-05 single-agent-evals (+8 tests)
- 25-06 validator-and-docs (+3 tests)

**Total:** ~475/475 tests passing, CI green.

**Locked decisions:**

- **D18** Legacy `AgentRegistry` and `AgentRouter` interfaces deprecated, kept for backwards compat; superseded by `AgentDefinitionRegistry`.
- **D19** `AgentDefinition = AgentProfile & PolicyFields` via TypeScript intersection.
- **D20** `allowedTools` is a TIGHTENING filter on top of `roleAllowsTool()`; planning-time only in Stage 25.
- **D21** `AgentDefinitionRegistry` interface is read-only; mutation on concrete `InMemoryAgentDefinitionRegistry` class.
- **D22** `agentRegistry: AgentDefinitionRegistry` is non-optional on `RuntimeServiceContainer` (D16 precedent).
- **D23** Default definitions carry NO policy fields — backwards-compatibility is non-negotiable.
- **D24** `runSingleAgentEvals()` is separate from `runAgentRuntimeEvals()`; single-agent push only when `evalRules` is set.

**Deferred to Stage 26+:** `AgentOrchestrator`, `SupervisorPolicy`, `HandoffPolicy`, `ResultMerger`, execution-time enforcement, `modelPolicy`/`retrievalPolicy` enforcement, rich config schema for definitions, MCP tools exposing the registry.

**Files added:**
- `core/src/agents/types.ts` (extended)
- `core/src/errors/index.ts` (3 new codes)
- `runtime/src/agents/registry.ts` (new)
- `runtime/src/evals/single-agent-evals.ts` (new)
- `docs/04-core-framework/agent-definition-and-registry.md` (new)
- `docs/internal/learning-notes/stage-25-agent-definition.md` (new)

**Verification command:**
```powershell
pnpm.cmd run ci
```
Returns `build ✓ typecheck ✓ test ✓ lint ✓` with ~475/475 passing.
```

Fill in the date with today's date in `YYYY-MM-DD` format.

---

## VERIFICATION

```powershell
pnpm.cmd typecheck
pnpm.cmd build
pnpm.cmd test
pnpm.cmd lint
```

All must pass. Test count should be ~475.

Common pitfalls:
- `resolved.agents.agents` may be `undefined` — guard the validator call with `!== undefined`
- The public doc must not reference internal stage numbers in its prose (e.g. don't say "Stage 25 adds...") — that's for the learning note only. The public doc states what the framework does, not when it was added. Exception: the table on enforcement timeline is acceptable since it shows future stages too.
- STATUS.md, kb.md formatting must match existing entries — don't introduce new heading levels or emoji

---

## SELF-REVIEW CHECKLIST

- [ ] `validateDuplicateIds` call added for `agents.agents` in validator body
- [ ] Guard: `if (resolved.agents.agents !== undefined)` before the call
- [ ] 3 new validator tests added
- [ ] Public doc created with all 9 sections (Concepts, Default registry, Wiring, Enforcement semantics, Validation, Limits, Public API surface)
- [ ] Public doc avoids "Stage N" wording in prose (except in the timeline table)
- [ ] Learning note created with all sections (What we built, Decisions, Deferred, Considered and rejected, Tests, Risks, What Stage 26 picks up)
- [ ] v3-architecture-snapshot.md updated with Stage 25 section + Layer 10 row update
- [ ] STATUS.md updated with Stage 25 section
- [ ] kb.md updated with Stage 25 session entry + D18–D24 listed
- [ ] `pnpm.cmd typecheck` passes
- [ ] `pnpm.cmd build` passes
- [ ] `pnpm.cmd test` reports ~475 passing
- [ ] `pnpm.cmd lint` passes
- [ ] No file outside the FILES TO CHANGE list was modified

---

## WHAT NOT TO DO

- ❌ Do NOT add a new error code for agent-profile-duplicate — reuse `config.duplicate-id` (existing pattern)
- ❌ Do NOT validate `allowedTools` or `budgetPolicy` in `DefaultConfigValidator` — config has `AgentProfile`, not `AgentDefinition`; registry validates at register time
- ❌ Do NOT add per-stage emoji to STATUS.md headers — match existing format
- ❌ Do NOT use "Stage N" prose in the public doc — public users don't care about stage numbers
- ❌ Do NOT add a CHANGELOG.md entry — the repo doesn't have one; STATUS.md is the project changelog
- ❌ Do NOT include the date in the document filename — it's in the file body
- ❌ Do NOT modify `docs/internal/v3-architecture-snapshot.md` structure significantly — match the additive pattern Stage 24 used
- ❌ Do NOT remove any prior session entry from kb.md — append only

---

## DONE SIGNAL

```
Stage 25 Phase 06 complete. Stage 25 COMPLETE.
Test count: [N]/[N] passing.
CI: build ✓ typecheck ✓ test ✓ lint ✓.

Files changed in Phase 06:
  packages/agentic-ai-infra-core/src/config/validator.ts (modified — duplicate-id check for agents.agents)
  packages/agentic-ai-infra-core/test/config-validator.test.ts (modified — 3 new tests)
  docs/04-core-framework/agent-definition-and-registry.md (new — public reference)
  docs/internal/learning-notes/stage-25-agent-definition.md (new — internal learning note)
  docs/internal/v3-architecture-snapshot.md (modified — Stage 25 section + Layer 10 row)
  STATUS.md (modified — Stage 25 section)
  kb.md (modified — Stage 25 session entry with D18–D24)

Stage 25 cumulative test delta: ~46 new tests over 6 phases.
Locked decisions added by Stage 25: D18, D19, D20, D21, D22, D23, D24.

Next: Stage 26 — AgentOrchestrator + SupervisorPolicy + execution-time enforcement.
```

Do not add commentary after this block.
