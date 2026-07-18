# Stage 25 Phase 04 — Executor Enforcement: allowedTools + budgetPolicy
## Claude Code Prompt — MahaRudra Agentic AI Infra

---

## BEFORE YOU START — READ THIS FIRST

**Platform:** Windows 11, PowerShell, Node >= 20, pnpm only
**CI command:** `pnpm run ci`
**Starting test count:** 454/454 passing (Phase 03 complete)
**Expected test count after this phase:** ~464 passing (+10)

This prompt is self-contained. Do not invent details not stated here.
Do not modify any file not listed in the "FILES TO CHANGE" section.

This phase modifies hot path executor logic. Read this prompt fully before
writing any code. Every change is bounded by the principle in D20:
`allowedTools` TIGHTENS, never broadens.

---

## CONTEXT — WHAT IS DONE (locked from Phases 01–03)

- `AgentDefinition` (Phase 01) — has `allowedTools?: readonly string[]` and `budgetPolicy?: { maxTokens: number }`
- `InMemoryAgentDefinitionRegistry` + factory (Phase 02)
- `RuntimeServiceContainer.agentRegistry` non-optional (Phase 03)
- `ExecutorOptions.agentRegistry?: AgentDefinitionRegistry` optional (Phase 03)
- `selectToolIds()` private function in `runtime/src/agents/index.ts:815` — task → ≤4 tool ids
- `roleAllowsTool()` private function in `runtime/src/harness/index.ts:222` — role × category floor; preserved unchanged
- `DEFAULT_AGENT_DEFINITIONS` has 6 inert entries — D23 backwards-compat

---

## REVIEW OF D20 (locked in Phase 01)

> `allowedTools` is a TIGHTENING filter applied on top of the existing
> `roleAllowsTool()` floor in `harness/index.ts`. Enforcement is at PLANNING
> time only in Stage 25. Execution-time enforcement deferred to Stage 26.

Implications for Phase 04:
- `allowedTools` filter is applied AFTER `selectToolIds()` returns
- The filter is INTERSECTION: the agent may only call tools that are BOTH selected by `selectToolIds()` AND in `allowedTools`
- The harness's `roleAllowsTool()` is NOT modified — it remains the security floor
- `undefined` allowedTools = no per-agent restriction (Stage 24 behavior preserved)
- `[]` allowedTools = empty result (agent selects no tools — distinct from `undefined`)

---

## SCOPE

This phase:

1. Adds two pure helper functions in `runtime/src/agents/index.ts`:
   - `enforceAllowedTools(selectedIds, definition?)`
   - `effectiveBudgetCeiling(projectBudgetTokens, definition?)`
2. Wires the helpers into `SingleAgentExecutor.execute()` (looks up definition by id `"manager"`)
3. Wires the helpers into `TokenEfficientMultiAgentExecutor.execute()` per routed role (uses `findByRole(role)[0]`)
4. Adds a test file with 10 enforcement tests

**Convention for SingleAgentExecutor.** It represents a single coordinator
running with no explicit role routing. By convention it looks up the
definition with `id: "manager"`. Users wanting per-agent policy on the
SingleAgentExecutor must override the default "manager" definition via
their config's `agents.agents` array (factory in Phase 02 lets caller
profiles win on id collision).

**Convention for TokenEfficientMultiAgentExecutor.** It routes a task to
multiple `AgentRole`s, then runs one slice per role. For each routed role,
it looks up the definition via `findByRole(role)[0]` (first match — Stage 26's
`SupervisorPolicy` will introduce smarter selection).

---

## FILES TO CHANGE

```
packages/agentic-ai-infra-runtime/src/agents/index.ts                 (modify — add helpers + wire into both executors)
packages/agentic-ai-infra-runtime/test/agents/executor-enforcement.test.ts  (new — 10 tests)
```

---

## CHANGE 1 — `packages/agentic-ai-infra-runtime/src/agents/index.ts`

### 1a. Add import (if not already there from Phase 03)

The Phase 03 changes already imported `AgentDefinitionRegistry`. Phase 04
also needs `AgentDefinition`. Add it to the type-only import block:

```typescript
import type {
  // ... existing imports
  AgentDefinition,
  AgentDefinitionRegistry
} from "@maharudra/agentic-ai-infra-core";
```

### 1b. Add helper functions

Add the two helpers near the existing `selectToolIds` private function
(around line 815). Place them immediately AFTER `selectToolIds`:

```typescript
/**
 * Stage 25 — Applies the per-agent `allowedTools` allowlist as an
 * intersection on top of the selected tool ids.
 *
 * Semantics (D20):
 *   - `definition` undefined  → pass through unchanged
 *   - `allowedTools` undefined → pass through unchanged
 *   - `allowedTools` []        → empty result (agent has no tools)
 *   - `allowedTools` [...]     → intersect: only ids in both lists survive
 *
 * This is a TIGHTENING filter only. It can shrink `selectedIds` but never
 * grow it. The harness's `roleAllowsTool()` remains the security floor.
 *
 * Pure function. No side effects. O(n + m) via Set lookup.
 */
function enforceAllowedTools(
  selectedIds: readonly string[],
  definition?: AgentDefinition
): readonly string[] {
  if (!definition || definition.allowedTools === undefined) {
    return selectedIds;
  }

  // Convert allowlist to Set for O(1) per-id lookup. Cheap because both
  // lists are bounded: selectedIds ≤ 4, allowedTools typically ≤ 10.
  const allowed = new Set(definition.allowedTools);
  return selectedIds.filter((id) => allowed.has(id));
}

/**
 * Stage 25 — Computes the effective token budget for an agent execution.
 *
 * Returns the MIN of the project-level budget and the agent's
 * `budgetPolicy.maxTokens`. The agent ceiling never WIDENS the project
 * budget — only narrows it.
 *
 * Pure function. No side effects.
 */
function effectiveBudgetCeiling(
  projectBudgetTokens: number,
  definition?: AgentDefinition
): number {
  const agentMax = definition?.budgetPolicy?.maxTokens;
  if (agentMax === undefined) {
    return projectBudgetTokens;
  }
  return Math.min(projectBudgetTokens, agentMax);
}
```

### 1c. Wire into `SingleAgentExecutor.execute()`

Find `SingleAgentExecutor.execute()`. Locate the point where `selectToolIds()`
is called and the result is stored as `selectedToolIds`. Existing code looks
roughly like:

```typescript
    const selectedToolIds = selectToolIds(safeTask, allowedTools);
```

Add the following lines IMMEDIATELY after that:

```typescript
    // Stage 25 — look up the conventional "manager" definition for the
    // SingleAgentExecutor. The default registry always has it; users may
    // override by configuring an agent profile with id "manager".
    const managerDefinition =
      this.options.agentRegistry?.findById("manager");

    // Apply per-agent allowedTools intersection. No-op when definition has
    // no allowedTools policy (D23 backwards-compat).
    const enforcedToolIds = enforceAllowedTools(
      selectedToolIds,
      managerDefinition
    );
```

Then, in the SAME function, find the calculation that produces the
`tokenUsage` or `budget`-related value the executor reports. The exact
existing code may vary — the integration point is wherever the project
budget value is computed for the report. Replace the project-budget value
with the effective ceiling. For example, if the existing line is:

```typescript
    const budgetTokens = resolved.value.tokenEfficiency.tokenBudget.maxContextTokens;
```

Add a follow-up:

```typescript
    const effectiveBudget = effectiveBudgetCeiling(
      budgetTokens,
      managerDefinition
    );
```

…and use `effectiveBudget` wherever the existing code used `budgetTokens`
inside the run report and token usage calculations downstream in this
function. If the existing variable name differs, adapt the integration
point — the rule is: anywhere the existing executor uses the project
budget to compute output, replace with the effective ceiling for this
agent.

Finally, replace any subsequent reference to `selectedToolIds` in the
report with `enforcedToolIds`. The report's `selectedToolIds` field must
reflect the post-enforcement list:

```typescript
    // Where the report is constructed:
    selectedToolIds: enforcedToolIds,
```

### 1d. Wire into `TokenEfficientMultiAgentExecutor.execute()`

Find `TokenEfficientMultiAgentExecutor.execute()`. Locate the loop that
processes routed roles. Existing code typically iterates over `routedRoles`
and calls `createRoleOutput(slice, task)` per role.

For each routed role, BEFORE calling `createRoleOutput`, look up the role's
definition and apply enforcement:

```typescript
    // Inside the per-role loop, immediately before createRoleOutput is called
    // (or wherever the role's tool ids are first computed):
    const roleDefinition =
      this.options.agentRegistry?.findByRole(slice.role)[0];
```

Then, after the existing tool selection for the role produces `roleToolIds`
(or whatever the local variable is called), apply the enforcement:

```typescript
    const enforcedRoleToolIds = enforceAllowedTools(
      roleToolIds,
      roleDefinition
    );
```

Use `enforcedRoleToolIds` in the role's output report — replace any
subsequent reference to `roleToolIds` in the per-role report. The role's
budget should be computed using the effective ceiling:

```typescript
    const effectiveRoleBudget = effectiveBudgetCeiling(
      projectBudgetTokens,
      roleDefinition
    );
```

…where `projectBudgetTokens` is the existing project-level budget the role
slice computation uses. Use `effectiveRoleBudget` wherever the executor
uses the project budget for THIS role.

**Important.** If the per-role enforcement points are not obviously
locatable in the existing function body (the executor is ~400 lines), do
NOT guess. Read the surrounding context. The principle is: for each routed
role, apply both helpers exactly once, AFTER the per-role tool selection
and BEFORE the per-role report is finalized.

---

## CHANGE 2 — `packages/agentic-ai-infra-runtime/test/agents/executor-enforcement.test.ts` (NEW)

Create this file:

```typescript
import { describe, expect, it } from "vitest";
import { DefaultConfigValidator } from "@maharudra/agentic-ai-infra-core";
import type { AgenticInfraProjectConfig } from "@maharudra/agentic-ai-infra-core";
import {
  InMemoryAgentDefinitionRegistry,
  SingleAgentExecutor,
  TokenEfficientMultiAgentExecutor
} from "../../src/agents/index.js";
import { InMemoryTrajectoryRecorder } from "../../src/trajectory/index.js";

/**
 * Helper: resolved config for a single-agent profile. Adapts the local
 * config-building convention — if `resolved()` helpers exist in other
 * test files, prefer those.
 */
function resolveConfig(input: AgenticInfraProjectConfig) {
  const result = new DefaultConfigValidator().validate(input);
  if (!result.ok) {
    throw new Error(`Test config failed validation: ${result.error.message}`);
  }
  return result.value;
}

const SINGLE_AGENT_CONFIG: AgenticInfraProjectConfig = {
  project: { name: "Enforcement Test", slug: "enforcement-test" },
  profiles: ["minimal"]
};

const MULTI_AGENT_CONFIG: AgenticInfraProjectConfig = {
  project: { name: "Multi Enforcement", slug: "multi-enforcement" },
  profiles: ["full-agentic-context"]
};

describe("SingleAgentExecutor — allowedTools enforcement (Stage 25)", () => {
  it("absent agentRegistry → unchanged Stage 24 behavior", async () => {
    const executor = new SingleAgentExecutor({
      config: resolveConfig(SINGLE_AGENT_CONFIG)
    });
    const result = await executor.execute({
      task: "Search the knowledge base for vectorless examples"
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Without enforcement, the executor selects its usual ≤4 tools.
    expect(result.value.selectedToolIds.length).toBeGreaterThan(0);
  });

  it("absent allowedTools on manager definition → pass-through", async () => {
    // Registry has the default "manager" with no policy — D23 backwards-compat.
    const registry = new InMemoryAgentDefinitionRegistry().register({
      id: "manager",
      role: "manager"
    });
    const executor = new SingleAgentExecutor({
      config: resolveConfig(SINGLE_AGENT_CONFIG),
      agentRegistry: registry
    });
    const result = await executor.execute({
      task: "Search the knowledge base"
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.selectedToolIds.length).toBeGreaterThan(0);
  });

  it("empty allowedTools array → no tools selected", async () => {
    const registry = new InMemoryAgentDefinitionRegistry().register({
      id: "manager",
      role: "manager",
      allowedTools: []
    });
    const executor = new SingleAgentExecutor({
      config: resolveConfig(SINGLE_AGENT_CONFIG),
      agentRegistry: registry
    });
    const result = await executor.execute({
      task: "Search the knowledge base"
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.selectedToolIds).toEqual([]);
  });

  it("allowedTools restricts selection to listed ids only", async () => {
    const registry = new InMemoryAgentDefinitionRegistry().register({
      id: "manager",
      role: "manager",
      allowedTools: ["agentic.retrieval.search"]
    });
    const executor = new SingleAgentExecutor({
      config: resolveConfig(SINGLE_AGENT_CONFIG),
      agentRegistry: registry
    });
    const result = await executor.execute({
      task: "Search the knowledge base"
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Either the tool was selected (and remains), or it wasn't (empty).
    // The invariant: nothing OUTSIDE the allowlist appears.
    for (const id of result.value.selectedToolIds) {
      expect(id).toBe("agentic.retrieval.search");
    }
  });

  it("budgetPolicy.maxTokens caps the effective budget", async () => {
    const registry = new InMemoryAgentDefinitionRegistry().register({
      id: "manager",
      role: "manager",
      budgetPolicy: { maxTokens: 500 }
    });
    const executor = new SingleAgentExecutor({
      config: resolveConfig(SINGLE_AGENT_CONFIG),
      agentRegistry: registry
    });
    const result = await executor.execute({
      task: "Search the knowledge base"
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The executor's reported budget should not exceed the agent ceiling.
    // The exact field name in the report depends on the report shape; if
    // budget is exposed as `budget.maxContextTokens` or similar, adjust.
    // What matters: the reported budget is ≤ 500.
    expect(result.value.tokenUsage.totalTokens).toBeLessThanOrEqual(500);
  });
});

describe("TokenEfficientMultiAgentExecutor — per-role enforcement (Stage 25)", () => {
  it("absent agentRegistry → unchanged Stage 24 behavior", async () => {
    const trajectory = new InMemoryTrajectoryRecorder();
    const executor = new TokenEfficientMultiAgentExecutor({
      config: resolveConfig(MULTI_AGENT_CONFIG),
      trajectoryRecorder: trajectory
    });
    const text = "Security architecture docs eval implementation. ".repeat(40);
    const result = await executor.execute({
      task: "Review security architecture and docs",
      contextPackage: {
        id: "ctx",
        task: "transient",
        taskHash: "hash",
        taskType: "security",
        contextText: text,
        tokenEstimate: Math.ceil(text.length / 4),
        contextHash: "ctxhash"
      }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Without enforcement, multiple roles produce outputs as before.
    expect(result.value.roleOutputs.length).toBeGreaterThan(0);
  });

  it("per-role allowedTools restricts that role only", async () => {
    const registry = new InMemoryAgentDefinitionRegistry()
      .register({
        id: "security-reviewer",
        role: "security-reviewer",
        allowedTools: ["agentic.retrieval.search"]
      })
      .register({
        id: "architecture-reviewer",
        role: "architecture-reviewer"
        // No allowedTools — unrestricted
      });

    const trajectory = new InMemoryTrajectoryRecorder();
    const executor = new TokenEfficientMultiAgentExecutor({
      config: resolveConfig(MULTI_AGENT_CONFIG),
      trajectoryRecorder: trajectory,
      agentRegistry: registry
    });
    const text = "Security architecture review request. ".repeat(40);
    const result = await executor.execute({
      task: "Review security and architecture",
      contextPackage: {
        id: "ctx",
        task: "transient",
        taskHash: "hash",
        taskType: "security",
        contextText: text,
        tokenEstimate: Math.ceil(text.length / 4),
        contextHash: "ctxhash"
      }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Find the security-reviewer's output; any tool ids it lists must be in
    // the allowlist. The architecture-reviewer's output has no such bound.
    const secOutput = result.value.roleOutputs.find(
      (o) => o.role === "security-reviewer"
    );
    if (secOutput) {
      for (const id of secOutput.selectedToolIds) {
        expect(id).toBe("agentic.retrieval.search");
      }
    }
  });

  it("per-role budgetPolicy caps that role's effective budget", async () => {
    const registry = new InMemoryAgentDefinitionRegistry().register({
      id: "security-reviewer",
      role: "security-reviewer",
      budgetPolicy: { maxTokens: 300 }
    });

    const trajectory = new InMemoryTrajectoryRecorder();
    const executor = new TokenEfficientMultiAgentExecutor({
      config: resolveConfig(MULTI_AGENT_CONFIG),
      trajectoryRecorder: trajectory,
      agentRegistry: registry
    });
    const text = "Security review. ".repeat(40);
    const result = await executor.execute({
      task: "Security review",
      contextPackage: {
        id: "ctx",
        task: "transient",
        taskHash: "hash",
        taskType: "security",
        contextText: text,
        tokenEstimate: Math.ceil(text.length / 4),
        contextHash: "ctxhash"
      }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const secOutput = result.value.roleOutputs.find(
      (o) => o.role === "security-reviewer"
    );
    if (secOutput) {
      expect(secOutput.tokenUsage.totalTokens).toBeLessThanOrEqual(300);
    }
  });

  it("first findByRole match is used when multiple definitions share a role", async () => {
    const registry = new InMemoryAgentDefinitionRegistry()
      .register({
        id: "sec-strict",
        role: "security-reviewer",
        allowedTools: ["agentic.retrieval.search"]
      })
      .register({
        id: "sec-loose",
        role: "security-reviewer"
      });

    const trajectory = new InMemoryTrajectoryRecorder();
    const executor = new TokenEfficientMultiAgentExecutor({
      config: resolveConfig(MULTI_AGENT_CONFIG),
      trajectoryRecorder: trajectory,
      agentRegistry: registry
    });
    const text = "Security review. ".repeat(40);
    const result = await executor.execute({
      task: "Security review",
      contextPackage: {
        id: "ctx",
        task: "transient",
        taskHash: "hash",
        taskType: "security",
        contextText: text,
        tokenEstimate: Math.ceil(text.length / 4),
        contextHash: "ctxhash"
      }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The strict definition was registered first → first match → its
    // allowedTools applies to the security-reviewer slice.
    const secOutput = result.value.roleOutputs.find(
      (o) => o.role === "security-reviewer"
    );
    if (secOutput) {
      for (const id of secOutput.selectedToolIds) {
        expect(id).toBe("agentic.retrieval.search");
      }
    }
  });

  it("a role with no registered definition uses Stage 24 behavior", async () => {
    // Registry intentionally has nothing for docs-reviewer. If the executor
    // routes to docs-reviewer, no enforcement is applied.
    const registry = new InMemoryAgentDefinitionRegistry().register({
      id: "manager",
      role: "manager"
    });

    const trajectory = new InMemoryTrajectoryRecorder();
    const executor = new TokenEfficientMultiAgentExecutor({
      config: resolveConfig(MULTI_AGENT_CONFIG),
      trajectoryRecorder: trajectory,
      agentRegistry: registry
    });
    const text = "Documentation review. ".repeat(40);
    const result = await executor.execute({
      task: "Review documentation",
      contextPackage: {
        id: "ctx",
        task: "transient",
        taskHash: "hash",
        taskType: "documentation",
        contextText: text,
        tokenEstimate: Math.ceil(text.length / 4),
        contextHash: "ctxhash"
      }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The run completes; roles without registered definitions still produce
    // outputs (no enforcement applied).
    expect(result.value.roleOutputs.length).toBeGreaterThan(0);
  });
});
```

---

## VERIFICATION

```powershell
pnpm.cmd typecheck
pnpm.cmd build
pnpm.cmd test
pnpm.cmd lint
```

All must pass. Test count should be ~464.

Common pitfalls:
- The exact name of the report's tool-id field may be `selectedToolIds` or
  `toolIds` depending on the executor — match the existing field name when
  reading the test assertions
- `tokenUsage.totalTokens` is the existing field; do not invent
  `effectiveBudget` as a report field unless it already exists
- Some existing executor tests may now run with `agentRegistry = undefined`
  and behave EXACTLY as before — this is the D23 backwards-compat
  guarantee. If any existing test fails, the helper functions are NOT
  pass-through when they should be — review `enforceAllowedTools` and
  `effectiveBudgetCeiling` for an early-return bug

---

## SELF-REVIEW CHECKLIST

- [ ] Two pure helpers added: `enforceAllowedTools`, `effectiveBudgetCeiling`
- [ ] `enforceAllowedTools(ids, undefined)` returns `ids` unchanged
- [ ] `enforceAllowedTools(ids, { ... allowedTools: undefined })` returns `ids` unchanged
- [ ] `enforceAllowedTools(ids, { ... allowedTools: [] })` returns `[]`
- [ ] `enforceAllowedTools` uses Set for O(1) lookup
- [ ] `effectiveBudgetCeiling(N, undefined)` returns `N`
- [ ] `effectiveBudgetCeiling(N, { ... budgetPolicy: undefined })` returns `N`
- [ ] `effectiveBudgetCeiling(N, { ... budgetPolicy: { maxTokens: M } })` returns `Math.min(N, M)`
- [ ] `SingleAgentExecutor.execute()` looks up `agentRegistry?.findById("manager")`
- [ ] `SingleAgentExecutor.execute()` applies both helpers; report uses enforced values
- [ ] `TokenEfficientMultiAgentExecutor.execute()` looks up `agentRegistry?.findByRole(role)[0]` per role
- [ ] `TokenEfficientMultiAgentExecutor.execute()` applies enforcement per role
- [ ] Existing executor tests in `agent-harness-phase5.test.ts` still pass without modification
- [ ] New test file has 10 tests (5 SingleAgent, 5 MultiAgent)
- [ ] `pnpm.cmd typecheck` passes
- [ ] `pnpm.cmd build` passes
- [ ] `pnpm.cmd test` reports ~464 passing
- [ ] `pnpm.cmd lint` passes

---

## WHAT NOT TO DO

- ❌ Do NOT modify `roleAllowsTool()` in `harness/index.ts` — the role × category floor stays exactly as it was
- ❌ Do NOT modify `selectToolIds()` itself — apply the new filter AFTER it returns
- ❌ Do NOT plumb `agentId` through `AgentHarnessToolInput` — that's Stage 26
- ❌ Do NOT throw or return `fail()` when `allowedTools` produces an empty result — empty is a valid agent state
- ❌ Do NOT make `effectiveBudgetCeiling` widen the project budget — `Math.min` only; no `Math.max`
- ❌ Do NOT add fields to the run report beyond what the existing report shape contains
- ❌ Do NOT add a new MCP tool to expose agent enforcement state
- ❌ Do NOT add execution-time per-agent checks in the harness — Stage 26
- ❌ Do NOT modify any test in `agent-harness-phase5.test.ts` — they assert Stage 24 behavior which Stage 25 must preserve
- ❌ Do NOT modify any executor code path that runs when `agentRegistry` is undefined — the path must be byte-for-byte identical to Stage 24

---

## DONE SIGNAL

```
Stage 25 Phase 04 complete. Test count: [N]/[N] passing.
CI: build ✓ typecheck ✓ test ✓ lint ✓.
Files changed:
  packages/agentic-ai-infra-runtime/src/agents/index.ts (modified — added enforceAllowedTools + effectiveBudgetCeiling helpers; wired into SingleAgentExecutor and TokenEfficientMultiAgentExecutor)
  packages/agentic-ai-infra-runtime/test/agents/executor-enforcement.test.ts (new — 10 tests across 2 describe blocks)
Next: Phase 05 — single-agent evals push via AgentDefinition.evalRules.
```

Do not add commentary after this block.
