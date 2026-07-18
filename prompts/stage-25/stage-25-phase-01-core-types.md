# Stage 25 Phase 01 — Core Types: AgentDefinition + AgentDefinitionRegistry
## Claude Code Prompt — MahaRudra Agentic AI Infra

---

## BEFORE YOU START — READ THIS FIRST

**Platform:** Windows 11, PowerShell, Node >= 20, pnpm only
**CI command:** `pnpm run ci` (build → typecheck → test → lint)
**Current test count:** 429/429 passing — CI clean (Stage 24 complete)
**Expected test count after this phase:** ~437 passing (+8)

This prompt is self-contained. Do not invent details not stated here.
Do not modify any file not listed in the "FILES TO CHANGE" section.
Run `pnpm run ci` after completing all changes. Fix any failures before
declaring done.

This phase is **types only**. Zero runtime behavior change. The new types
are consumed in Phase 02+. Adding them in isolation lets typecheck verify
shape before any code depends on them.

---

## CONTEXT — WHAT IS DONE (locked, do not change)

- **D1–D17** locked from prior stages — see `kb.md`. Do not re-derive.
- **`AgentProfile`** in `core/src/agents/types.ts:33` — `{ id, role, description?, maxContextTokens? }`. Stays unchanged.
- **`AgentRole`** union in `core/src/agents/types.ts:9` — 13 string literals. Stays unchanged.
- **`AgentRuntimeConfig.agents?: readonly AgentProfile[]`** at `core/src/agents/types.ts:100` — the config hook for user-supplied profiles. Stays unchanged.
- **`AgentRegistry`** interface at `core/src/agents/types.ts:41` — exists but has zero implementations and zero consumers. Phase 01 deprecates it.
- **`AgentRouter`** interface at `core/src/agents/types.ts:51` — has wrong signature, zero implementations. Phase 01 deprecates it.

---

## NEW LOCKED DECISIONS — D18–D20 (Stage 25)

These are introduced by Phase 01 and become immutable for the rest of Stage 25:

- **D18** Legacy `AgentRegistry` and `AgentRouter` interfaces are deprecated via TSDoc `@deprecated` tag. Not removed (zero callers, removal is unnecessary breakage). New `AgentDefinitionRegistry` supersedes them.
- **D19** `AgentDefinition = AgentProfile & PolicyFields` via TypeScript intersection type. Not a copy of `AgentProfile` fields — intersection keeps `AgentProfile` as single source of truth for identity fields.
- **D20** `allowedTools` is a TIGHTENING filter applied on top of the existing `roleAllowsTool()` floor in `harness/index.ts`. Enforcement is at PLANNING time only in Stage 25. Execution-time enforcement deferred to Stage 26.

---

## SCOPE

This phase adds:

1. The `AgentDefinition` type (intersection of `AgentProfile` + 7 policy fields)
2. The `AgentDefinitionRegistry` read-only interface
3. Six policy types: `AgentBudgetPolicy`, `AgentEvalRules`, `AgentModelPolicy`, `AgentRetrievalPolicy`, `AgentMemoryPolicy`, `AgentApprovalPolicy`
4. Three new error codes
5. `@deprecated` TSDoc on legacy `AgentRegistry` and `AgentRouter` interfaces
6. A test file with 8 assertions

**Zero runtime files are modified.** This phase touches only `core/src/agents/types.ts`, `core/src/errors/index.ts`, and adds one test file.

---

## FILES TO CHANGE

```
packages/agentic-ai-infra-core/src/agents/types.ts                    (modify)
packages/agentic-ai-infra-core/src/errors/index.ts                    (modify)
packages/agentic-ai-infra-core/test/agent-definition.test.ts          (new)
```

The barrel `packages/agentic-ai-infra-core/src/index.ts` already re-exports
`agents/types.js` (line 8) — no change needed.

---

## CHANGE 1 — `packages/agentic-ai-infra-core/src/agents/types.ts`

### 1a. Add `@deprecated` TSDoc to existing `AgentRegistry` interface (line ~40)

Replace the existing 7-line `AgentRegistry` block:

```typescript
/** Registry interface for available agent profiles. */
export interface AgentRegistry {
  /** Lists every configured agent profile. */
  list(): readonly AgentProfile[];
  /** Finds profiles that match a role. */
  findByRole(role: AgentRole): readonly AgentProfile[];
  /** Finds one profile by stable id. */
  findById(id: string): AgentProfile | undefined;
}
```

…with this exact replacement:

```typescript
/**
 * Legacy registry interface for available agent profiles.
 *
 * @deprecated Stage 25 supersedes this with {@link AgentDefinitionRegistry},
 *   which exposes the richer `AgentDefinition` shape (policy fields included).
 *   This interface has no implementations in the framework. It is kept to
 *   avoid breaking any downstream code that may have typed against it.
 *
 *   New code should depend on `AgentDefinitionRegistry`. Existing consumers
 *   (none in this repo) should migrate when they need policy fields.
 */
export interface AgentRegistry {
  /** Lists every configured agent profile. */
  list(): readonly AgentProfile[];
  /** Finds profiles that match a role. */
  findByRole(role: AgentRole): readonly AgentProfile[];
  /** Finds one profile by stable id. */
  findById(id: string): AgentProfile | undefined;
}
```

### 1b. Add `@deprecated` TSDoc to existing `AgentRouter` interface (line ~50)

Replace the existing block:

```typescript
/** Router interface for selecting the best agent for a task. */
export interface AgentRouter {
  /** Selects one agent from the available profiles for a task. */
  route(task: string, agents: readonly AgentProfile[]): AgentProfile;
}
```

…with:

```typescript
/**
 * Legacy router interface for selecting an agent for a task.
 *
 * @deprecated Never implemented; the framework's actual router is
 *   `DeterministicAgentRouter` in runtime, which has a different signature
 *   (`route(task: SafeTaskMetadata) => readonly AgentRole[]`). Kept to avoid
 *   breaking any downstream consumer. Stage 26 will introduce a proper
 *   orchestration-aware router; do not extend this interface.
 */
export interface AgentRouter {
  /** Selects one agent from the available profiles for a task. */
  route(task: string, agents: readonly AgentProfile[]): AgentProfile;
}
```

### 1c. Add new types at the END of the file (after the existing `MultiAgentRunReport` type)

Append these blocks in this exact order:

```typescript
/**
 * Per-agent token budget policy.
 *
 * When set on an `AgentDefinition`, the executor enforces this ceiling on
 * top of the project-level token budget. The agent-specific ceiling never
 * widens the project budget — only narrows it.
 *
 * `maxTokens` covers the total of input + output for one agent execution
 * within a multi-agent run, or one full single-agent execution.
 *
 * @example
 * const def: AgentDefinition = {
 *   id: "security-strict",
 *   role: "security-reviewer",
 *   budgetPolicy: { maxTokens: 2000 }
 * };
 */
export type AgentBudgetPolicy = {
  /** Hard ceiling on input + output tokens. Must be a positive integer. */
  readonly maxTokens: number;
};

/**
 * Per-agent eval rules used by `runSingleAgentEvals()` (added Stage 25 Phase 05).
 *
 * When an `AgentDefinition` carries `evalRules` AND the executor has an
 * `EvalStore` wired, `SingleAgentExecutor.execute()` pushes one
 * `EvalRunRecord` after a successful run.
 *
 * All three fields are optional. Each absent field skips the corresponding
 * check (eval result status = "skipped"). Empty arrays are treated as
 * present but vacuous (e.g. `forbiddenTools: []` skips the forbidden-tool
 * check).
 */
export type AgentEvalRules = {
  /**
   * Tool ids that must appear in the agent's selected tool set.
   * Empty array or undefined skips the check.
   */
  readonly requiredTools?: readonly string[];
  /**
   * Tool ids that must NOT appear in the agent's selected tool set.
   * Empty array or undefined skips the check.
   */
  readonly forbiddenTools?: readonly string[];
  /**
   * Hard ceiling on total tokens used. Distinct from `AgentBudgetPolicy.maxTokens`:
   * budget is enforced at planning time (changes behavior), eval `hardBudget`
   * is observed at eval time (records a pass/fail result without changing
   * behavior).
   */
  readonly hardBudget?: number;
};

/**
 * Per-agent model routing policy.
 *
 * @remarks Declared in Stage 25 to lock the shape. Enforcement deferred to
 *   Stage 26, when `AgentOrchestrator` routes per-agent LLM calls through
 *   `SmartRouter` honoring this policy.
 *
 *   In Stage 25 the field is accepted on `AgentDefinition` but the executor
 *   does not call it — the deterministic executors do not invoke LLMs.
 */
export type AgentModelPolicy = {
  /** Preferred LLM provider id from `LlmConfig.providers[*].id`. */
  readonly preferredProviderId?: string;
};

/**
 * Per-agent retrieval strategy policy.
 *
 * @remarks Declared in Stage 25 to lock the shape. Enforcement deferred to
 *   Stage 26 when the orchestrator builds per-agent context packets.
 *
 *   `strategy` is a free-form string today; Stage 26 will narrow it to a
 *   union of supported strategies (e.g. "full-text-only", "semantic-only",
 *   "hybrid").
 */
export type AgentRetrievalPolicy = {
  /** Strategy hint for retrieval; honored by Stage 26 orchestrator. */
  readonly strategy?: string;
};

/**
 * Per-agent memory access policy.
 *
 * @remarks Declared in Stage 25 to lock the shape. Enforcement deferred to
 *   Stage 27 when the memory subsystem is introduced.
 */
export type AgentMemoryPolicy = {
  /** Access mode for the semantic memory layer. */
  readonly semantic?: "read" | "read-write" | "none";
};

/**
 * Per-agent approval policy.
 *
 * @remarks Declared in Stage 25 to lock the shape. Enforcement deferred to
 *   Stage 27 when the controlled-write workflow is built end-to-end.
 *
 *   Today the framework's approval gate is at the tool level (via
 *   `ToolContract.runtimePolicy.requiresApproval`). Stage 27 extends it to
 *   agent-level approval gating.
 */
export type AgentApprovalPolicy = {
  /** When true, the agent's mutating operations require explicit approval. */
  readonly requiresApproval?: boolean;
};

/**
 * Full runtime configuration for one agent.
 *
 * Built at container construction time by `createAgentDefinitionRegistry()`
 * (Phase 02) from `AgentRuntimeConfig.agents` plus the framework's default
 * roles. Definitions are runtime-only — they are NOT part of the user-facing
 * `AgenticInfraProjectConfig` shape.
 *
 * Structurally an intersection of `AgentProfile` (identity) and seven policy
 * fields. Stage 25 enforces three of them at planning time:
 * `allowedTools`, `budgetPolicy`, `evalRules`. The remaining four
 * (`modelPolicy`, `retrievalPolicy`, `memoryPolicy`, `approvalPolicy`) are
 * declared but reserved for Stages 26/27.
 *
 * @example
 * // A security reviewer restricted to read-only retrieval tools, with a
 * // tight token budget and forbidden write/admin tools.
 * const def: AgentDefinition = {
 *   id: "security-strict",
 *   role: "security-reviewer",
 *   allowedTools: ["agentic.retrieval.search", "agentic.context.build"],
 *   budgetPolicy: { maxTokens: 2000 },
 *   evalRules: { forbiddenTools: ["agentic.write.propose"] }
 * };
 */
export type AgentDefinition = AgentProfile & {
  /**
   * Allowlist of tool ids the agent may select at planning time.
   *
   * Stage 25 semantics:
   *   - `undefined` → no per-agent restriction (existing role × category
   *     floor in `roleAllowsTool()` still applies)
   *   - `[]`        → empty allowlist — agent selects no tools
   *   - `[...]`     → intersect selected tools with this list
   *
   * Layered AFTER `roleAllowsTool()` in the harness, so an `allowedTools`
   * entry listing a write tool is still blocked by the role × category
   * floor. Defense in depth.
   */
  readonly allowedTools?: readonly string[];
  /** Per-agent token budget. See {@link AgentBudgetPolicy}. */
  readonly budgetPolicy?: AgentBudgetPolicy;
  /** Eval rules. See {@link AgentEvalRules}. */
  readonly evalRules?: AgentEvalRules;
  /** Model policy. Declared, enforcement deferred to Stage 26. */
  readonly modelPolicy?: AgentModelPolicy;
  /** Retrieval policy. Declared, enforcement deferred to Stage 26. */
  readonly retrievalPolicy?: AgentRetrievalPolicy;
  /** Memory policy. Declared, enforcement deferred to Stage 27. */
  readonly memoryPolicy?: AgentMemoryPolicy;
  /** Approval policy. Declared, enforcement deferred to Stage 27. */
  readonly approvalPolicy?: AgentApprovalPolicy;
};

/**
 * Read-only registry interface for `AgentDefinition` lookup.
 *
 * Consumers (executors, dashboard, future orchestrator) depend on this
 * interface. Mutation (`register`) lives only on the concrete
 * `InMemoryAgentDefinitionRegistry` class in runtime.
 *
 * Supersedes the legacy {@link AgentRegistry} interface, which returns
 * `AgentProfile` rather than `AgentDefinition` and has no implementations.
 *
 * `findByRole()` returns a LIST (not a single definition) because Stage 26
 * supports multiple specialists per role (e.g. two `security-reviewer`
 * agents with different scopes). The first match is a Stage 25 convention;
 * Stage 26's `SupervisorPolicy` picks among matches.
 */
export interface AgentDefinitionRegistry {
  /** Returns all registered definitions in insertion order. */
  list(): readonly AgentDefinition[];
  /** Looks up one definition by stable id. */
  findById(id: string): AgentDefinition | undefined;
  /** Returns all definitions matching a role, in insertion order. */
  findByRole(role: AgentRole): readonly AgentDefinition[];
  /** Returns the count of registered definitions. */
  count(): number;
}
```

---

## CHANGE 2 — `packages/agentic-ai-infra-core/src/errors/index.ts`

Add three new error codes to the `ErrorCode` union. Insert them in the
`// Eval errors (Stage 24)` block area, BEFORE the final
`"framework.internal-error"` entry. Place after the existing
`"config.llm-judge-requires-llm-config"` line:

```typescript
  // Eval errors (Stage 24)
  | "evals.invalid-dataset"
  | "evals.invalid-dataset-version"
  | "evals.invalid-dataset-item"
  | "evals.dataset-not-found"
  | "evals.dataset-path-traversal"
  | "evals.suite-not-registered"
  | "evals.empty-store"
  | "config.invalid-evals-store-capacity"
  | "config.llm-judge-requires-llm-config"
  // Agent definition errors (Stage 25)
  | "agent.definition-duplicate-id"
  | "agent.definition-invalid-role"
  | "agent.tool-not-in-allowlist"
  | "framework.internal-error";
```

Insertion order is important — these MUST be before `"framework.internal-error"`
because that entry is the sentinel terminator of the union.

---

## CHANGE 3 — `packages/agentic-ai-infra-core/test/agent-definition.test.ts` (NEW)

Create this file:

```typescript
import { describe, expect, it } from "vitest";
import type {
  AgentBudgetPolicy,
  AgentDefinition,
  AgentDefinitionRegistry,
  AgentEvalRules,
  AgentProfile,
  AgentRole,
  ErrorCode
} from "../src/index.js";

describe("AgentDefinition (Stage 25)", () => {
  it("is structurally assignable to AgentProfile", () => {
    // A definition with only the required identity fields must be a valid
    // AgentProfile too. This verifies the intersection-type design.
    const def: AgentDefinition = {
      id: "test-agent",
      role: "manager"
    };
    const profile: AgentProfile = def;
    expect(profile.id).toBe("test-agent");
    expect(profile.role).toBe("manager");
  });

  it("accepts only id and role as required fields", () => {
    // All policy fields are optional. The minimal valid definition is two
    // fields. The compiler verifies this at typecheck time; this test
    // documents the invariant.
    const minimal: AgentDefinition = { id: "x", role: "manager" };
    expect(minimal.allowedTools).toBeUndefined();
    expect(minimal.budgetPolicy).toBeUndefined();
    expect(minimal.evalRules).toBeUndefined();
  });

  it("distinguishes empty allowedTools from undefined", () => {
    // Documented in TSDoc: [] means "no tools allowed", undefined means
    // "no per-agent restriction". Phase 04 enforces this distinction.
    const noPolicy: AgentDefinition = { id: "a", role: "manager" };
    const emptyAllowlist: AgentDefinition = {
      id: "b",
      role: "manager",
      allowedTools: []
    };
    expect(noPolicy.allowedTools).toBeUndefined();
    expect(emptyAllowlist.allowedTools).toBeDefined();
    expect(emptyAllowlist.allowedTools?.length).toBe(0);
  });

  it("budgetPolicy requires maxTokens when set", () => {
    // Type-level test: omitting maxTokens when budgetPolicy is set is a
    // TypeScript error. We can't test that directly at runtime, but we can
    // verify that the field is reachable when present.
    const budget: AgentBudgetPolicy = { maxTokens: 1000 };
    const def: AgentDefinition = {
      id: "with-budget",
      role: "manager",
      budgetPolicy: budget
    };
    expect(def.budgetPolicy?.maxTokens).toBe(1000);
  });

  it("evalRules fields are all optional", () => {
    const empty: AgentEvalRules = {};
    const def: AgentDefinition = {
      id: "with-evals",
      role: "manager",
      evalRules: empty
    };
    expect(def.evalRules).toBeDefined();
    expect(def.evalRules?.requiredTools).toBeUndefined();
    expect(def.evalRules?.forbiddenTools).toBeUndefined();
    expect(def.evalRules?.hardBudget).toBeUndefined();
  });

  it("supports all 13 AgentRole values on a definition", () => {
    const roles: readonly AgentRole[] = [
      "manager",
      "architecture-reviewer",
      "security-reviewer",
      "implementation-planner",
      "eval-reviewer",
      "docs-reviewer",
      "planner",
      "implementer",
      "reviewer",
      "security",
      "retrieval",
      "dashboard",
      "custom"
    ];

    for (const role of roles) {
      const def: AgentDefinition = { id: `id-${role}`, role };
      expect(def.role).toBe(role);
    }
  });
});

describe("AgentDefinitionRegistry interface (Stage 25)", () => {
  it("can be implemented with the four required methods", () => {
    // Compile-time test: a minimal mock implementation must satisfy the
    // interface shape. If the interface grows a method without a default,
    // this test breaks the build and signals the contract change.
    const mock: AgentDefinitionRegistry = {
      list: () => [],
      findById: () => undefined,
      findByRole: () => [],
      count: () => 0
    };
    expect(mock.list()).toEqual([]);
    expect(mock.findById("x")).toBeUndefined();
    expect(mock.findByRole("manager")).toEqual([]);
    expect(mock.count()).toBe(0);
  });
});

describe("Stage 25 error codes", () => {
  it("declares the three new error codes in the ErrorCode union", () => {
    // Type-only test: assignments must compile. This is the typecheck-time
    // guarantee that the codes are present in the union and spelled
    // exactly as documented.
    const codes: readonly ErrorCode[] = [
      "agent.definition-duplicate-id",
      "agent.definition-invalid-role",
      "agent.tool-not-in-allowlist"
    ];
    expect(codes).toHaveLength(3);
    expect(codes[0]).toBe("agent.definition-duplicate-id");
    expect(codes[1]).toBe("agent.definition-invalid-role");
    expect(codes[2]).toBe("agent.tool-not-in-allowlist");
  });
});
```

---

## VERIFICATION

After applying all changes, run:

```powershell
pnpm.cmd typecheck
pnpm.cmd build
pnpm.cmd test
pnpm.cmd lint
```

All must pass. Test count should be 429 + 8 = 437. If any of these fail,
read the error carefully and fix in this phase — do NOT move to Phase 02
until CI is fully green.

Common pitfalls:
- Missing `@maharudra/agentic-ai-infra-core` build outputs after type changes
  → run `pnpm.cmd --filter @maharudra/agentic-ai-infra-core run build` first
- `ErrorCode` union order matters — `"framework.internal-error"` must be last
- The new types must be appended after `MultiAgentRunReport`, not in the
  middle of the existing types

---

## SELF-REVIEW CHECKLIST

Before declaring this phase done, verify each item:

- [ ] `AgentDefinition` type added; uses `AgentProfile & { ... }` intersection, not field duplication
- [ ] `AgentDefinitionRegistry` interface added with exactly 4 methods: `list`, `findById`, `findByRole`, `count`
- [ ] `register` method is NOT on the interface (read-only by D21)
- [ ] All 6 policy types added: `AgentBudgetPolicy`, `AgentEvalRules`, `AgentModelPolicy`, `AgentRetrievalPolicy`, `AgentMemoryPolicy`, `AgentApprovalPolicy`
- [ ] Three error codes added BEFORE `"framework.internal-error"`: `agent.definition-duplicate-id`, `agent.definition-invalid-role`, `agent.tool-not-in-allowlist`
- [ ] `@deprecated` TSDoc added to `AgentRegistry` interface (not removed)
- [ ] `@deprecated` TSDoc added to `AgentRouter` interface (not removed)
- [ ] Test file `core/test/agent-definition.test.ts` created with 8 tests
- [ ] `pnpm.cmd typecheck` passes
- [ ] `pnpm.cmd build` passes
- [ ] `pnpm.cmd test` reports 437/437 (or close — within ±2)
- [ ] `pnpm.cmd lint` passes
- [ ] No file outside the FILES TO CHANGE list was modified

---

## WHAT NOT TO DO

- ❌ Do NOT remove the legacy `AgentRegistry` or `AgentRouter` interfaces — keep them, just deprecate
- ❌ Do NOT add `register()` to the `AgentDefinitionRegistry` interface — it's read-only by D21
- ❌ Do NOT add `AgentDefinition[]` to `AgentRuntimeConfig` or `AgenticInfraProjectConfig` — registry is runtime-only by D19
- ❌ Do NOT implement `InMemoryAgentDefinitionRegistry` in this phase — that's Phase 02
- ❌ Do NOT touch any runtime file — Phase 01 is types only
- ❌ Do NOT add MCP tool contracts for the registry — Stage 26 will introduce orchestrator-aware tools
- ❌ Do NOT modify `selectToolIds()` or any executor — Phase 04
- ❌ Do NOT add a new ChunkingStrategy, KnowledgeSourceType, or other unrelated union
- ❌ Do NOT extend the legacy `AgentRegistry` interface with new methods — supersede via the new interface instead
- ❌ Do NOT make `count()` return `Promise<number>` — registry is synchronous (in-memory)

---

## DONE SIGNAL

When the phase is complete, output exactly this block (filling in the actual
numbers):

```
Stage 25 Phase 01 complete. Test count: [N]/[N] passing.
CI: build ✓ typecheck ✓ test ✓ lint ✓.
Files changed:
  packages/agentic-ai-infra-core/src/agents/types.ts (modified — deprecated 2 interfaces, added AgentDefinition + 6 policy types + AgentDefinitionRegistry)
  packages/agentic-ai-infra-core/src/errors/index.ts (modified — 3 new error codes)
  packages/agentic-ai-infra-core/test/agent-definition.test.ts (new — 8 tests)
Next: Phase 02 — InMemoryAgentDefinitionRegistry + createAgentDefinitionRegistry factory.
```

Do not add commentary after this block. Stop and wait for the operator to
move to Phase 02.
