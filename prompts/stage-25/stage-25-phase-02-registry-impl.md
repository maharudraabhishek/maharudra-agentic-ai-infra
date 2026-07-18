# Stage 25 Phase 02 — Registry Impl: InMemoryAgentDefinitionRegistry
## Claude Code Prompt — MahaRudra Agentic AI Infra

---

## BEFORE YOU START — READ THIS FIRST

**Platform:** Windows 11, PowerShell, Node >= 20, pnpm only
**CI command:** `pnpm run ci`
**Starting test count:** 437/437 passing (Phase 01 complete)
**Expected test count after this phase:** ~449 passing (+12)

This prompt is self-contained. Do not invent details not stated here.
Do not modify any file not listed in the "FILES TO CHANGE" section.

Phase 01 added the types in core. This phase adds the concrete runtime
implementation. Phase 03 wires it into the container.

---

## CONTEXT — WHAT IS DONE (locked from Phase 01)

- **`AgentDefinition`** type — intersection of `AgentProfile` + 7 policy fields, defined in `core/src/agents/types.ts`
- **`AgentDefinitionRegistry`** interface — read-only, 4 methods: `list`, `findById`, `findByRole`, `count`
- **3 new error codes** in `ErrorCode` union: `agent.definition-duplicate-id`, `agent.definition-invalid-role`, `agent.tool-not-in-allowlist`
- **Legacy `AgentRegistry` and `AgentRouter`** deprecated with TSDoc, kept for backwards compat
- **`DEFAULT_AGENT_ROLES`** exists at `runtime/src/agents/index.ts:35` — 6 roles: `manager`, `architecture-reviewer`, `security-reviewer`, `implementation-planner`, `eval-reviewer`, `docs-reviewer`

---

## NEW LOCKED DECISIONS — D21 + D23 (Stage 25)

- **D21** `AgentDefinitionRegistry` interface is READ-ONLY. Mutation (`register`) is on the concrete `InMemoryAgentDefinitionRegistry` class only. Consumers depend on the interface; only the construction path depends on the class.
- **D23** Default definitions (one per `DEFAULT_AGENT_ROLES`) have NO policy fields set. By default Stage 25 adds zero new restrictions over Stage 24. Backwards-compatibility is non-negotiable.

---

## SCOPE

This phase adds:

1. `InMemoryAgentDefinitionRegistry` class implementing `AgentDefinitionRegistry`
2. `createAgentDefinitionRegistry(profiles?)` factory function
3. `DEFAULT_AGENT_DEFINITIONS` exported constant — the 6 inert defaults
4. Register-time validation: empty id, invalid role, duplicate id all throw fail-fast
5. A test file with 12 assertions

**Validation philosophy.** `register()` throws `Error` synchronously on invalid
input — same pattern as `DefaultBudgetGate.constructor` (Stage 19 precedent).
The error message includes the relevant `ErrorCode` for debuggability. The
registry is in-memory and synchronous; no `FrameworkResult` indirection.

---

## FILES TO CHANGE

```
packages/agentic-ai-infra-runtime/src/agents/registry.ts              (new)
packages/agentic-ai-infra-runtime/src/agents/index.ts                 (modify — add 1 re-export line)
packages/agentic-ai-infra-runtime/test/agents/registry.test.ts        (new)
```

---

## CHANGE 1 — `packages/agentic-ai-infra-runtime/src/agents/registry.ts` (NEW)

Create this file:

```typescript
/**
 * In-memory implementation of `AgentDefinitionRegistry` and factory for
 * building the default registry from a list of agent profiles.
 *
 * Stage 25 Phase 02 — Layer 10 (Agent Runtime).
 *
 * Design notes
 * ------------
 * - Registry is in-memory only (D6 precedent: `EvalStore` is also in-memory
 *   in core, Postgres-backed variant lands in Stage 27).
 * - Lookup is synchronous; the registry does not return `FrameworkResult`.
 *   Programmer errors at registration time throw `Error` directly — same as
 *   `DefaultBudgetGate.constructor` (Stage 19).
 * - Insertion order is preserved for `list()` and `findByRole()`. This lets
 *   Stage 26's `SupervisorPolicy` rely on deterministic ordering when no
 *   explicit selection logic applies.
 */

import type {
  AgentDefinition,
  AgentDefinitionRegistry,
  AgentProfile,
  AgentRole
} from "@maharudra/agentic-ai-infra-core";

// -------------------------------------------------------------------------
// Default role catalogue
// -------------------------------------------------------------------------

/**
 * The six default `AgentRole` values the framework ships with.
 *
 * Duplicated here intentionally — `DEFAULT_AGENT_ROLES` in `agents/index.ts`
 * is the source of truth for executor routing, but its scope is the
 * executor's planning path. The registry has its own constant so the file
 * is self-contained and so future changes to executor defaults don't
 * silently widen the registry surface.
 *
 * If you change this list, update `DEFAULT_AGENT_ROLES` in `agents/index.ts`
 * and `DEFAULT_AGENT_DEFINITIONS` below.
 */
const REGISTRY_DEFAULT_ROLES: readonly AgentRole[] = [
  "manager",
  "architecture-reviewer",
  "security-reviewer",
  "implementation-planner",
  "eval-reviewer",
  "docs-reviewer"
];

/**
 * The full set of `AgentRole` literal values, used at runtime to validate
 * registered definitions. Kept in sync with the union declared in
 * `core/src/agents/types.ts`.
 *
 * When the union there grows, append here as well. Failure to do so means
 * the registry rejects definitions for the new role with
 * `agent.definition-invalid-role`.
 */
const VALID_AGENT_ROLES: ReadonlySet<AgentRole> = new Set<AgentRole>([
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
]);

/**
 * The framework-default `AgentDefinition` list — one per role in
 * `REGISTRY_DEFAULT_ROLES`. No policy fields set, which means default
 * behavior matches Stage 24 exactly (backwards-compatible — D23).
 *
 * Used by `createAgentDefinitionRegistry()` when no user profiles are
 * provided, and as the base layer that user profiles merge on top of.
 */
export const DEFAULT_AGENT_DEFINITIONS: readonly AgentDefinition[] =
  REGISTRY_DEFAULT_ROLES.map((role) => ({ id: role, role }));

// -------------------------------------------------------------------------
// InMemoryAgentDefinitionRegistry
// -------------------------------------------------------------------------

/**
 * Synchronous in-memory implementation of `AgentDefinitionRegistry`.
 *
 * The interface exposes only read methods (D21). `register()` is a concrete
 * method on this class, used at construction time by the factory and by
 * tests. Executors and other consumers should depend on the interface, not
 * this class.
 *
 * @example
 * const registry = new InMemoryAgentDefinitionRegistry()
 *   .register({ id: "manager", role: "manager" })
 *   .register({ id: "sec-strict", role: "security-reviewer",
 *               allowedTools: ["agentic.retrieval.search"] });
 *
 * registry.count();                       // 2
 * registry.findById("sec-strict");        // AgentDefinition
 * registry.findByRole("manager");         // [AgentDefinition]
 */
export class InMemoryAgentDefinitionRegistry implements AgentDefinitionRegistry {
  /**
   * Map keyed by `id` for O(1) lookup. Insertion order is preserved by `Map`
   * iteration semantics, which `list()` and `findByRole()` rely on.
   */
  private readonly definitions = new Map<string, AgentDefinition>();

  /**
   * Registers a definition. Validates non-empty id, valid role, and
   * uniqueness. Throws on violation.
   *
   * Returns `this` so calls can be chained at construction time.
   *
   * @throws Error when `id` is empty or whitespace
   * @throws Error when `role` is not in the `AgentRole` union (code `agent.definition-invalid-role`)
   * @throws Error when `id` is already registered (code `agent.definition-duplicate-id`)
   */
  register(definition: AgentDefinition): this {
    // Non-empty id check. Empty/whitespace ids would corrupt the Map keys
    // and break lookup. Throwing at registration time prevents the bad
    // state from ever being observable.
    if (typeof definition.id !== "string" || definition.id.trim() === "") {
      throw new Error(
        "[InMemoryAgentDefinitionRegistry] Definition id must be a non-empty string " +
        `(got ${JSON.stringify(definition.id)}).`
      );
    }

    // Valid role check. AgentRole is a string-literal union in TypeScript;
    // a runtime check protects against `as` casts and JSON imports.
    if (!VALID_AGENT_ROLES.has(definition.role)) {
      throw new Error(
        `[InMemoryAgentDefinitionRegistry] Invalid role "${definition.role}" ` +
        `for definition id "${definition.id}" (code: agent.definition-invalid-role).`
      );
    }

    // Duplicate id check. The interface is "register-once"; updates require
    // a new registry. This matches the framework's wider preference for
    // immutable construction over mutation.
    if (this.definitions.has(definition.id)) {
      throw new Error(
        `[InMemoryAgentDefinitionRegistry] Duplicate definition id "${definition.id}" ` +
        `(code: agent.definition-duplicate-id).`
      );
    }

    this.definitions.set(definition.id, definition);
    return this;
  }

  /** Returns all registered definitions in insertion order. */
  list(): readonly AgentDefinition[] {
    return Array.from(this.definitions.values());
  }

  /** Looks up one definition by stable id. Returns `undefined` if absent. */
  findById(id: string): AgentDefinition | undefined {
    return this.definitions.get(id);
  }

  /** Returns all definitions whose `role` field matches, in insertion order. */
  findByRole(role: AgentRole): readonly AgentDefinition[] {
    return Array.from(this.definitions.values()).filter(
      (def) => def.role === role
    );
  }

  /** Returns the number of registered definitions. */
  count(): number {
    return this.definitions.size;
  }
}

// -------------------------------------------------------------------------
// Factory
// -------------------------------------------------------------------------

/**
 * Builds the default Stage 25 agent registry.
 *
 * Algorithm:
 *   1. Register all `DEFAULT_AGENT_DEFINITIONS` (six inert defaults).
 *   2. For each profile in `profiles`, promote it to an `AgentDefinition`
 *      (no policy fields), then register. If the profile's id collides with
 *      a default, the default is replaced — caller wins on collision.
 *
 * Replacement happens by constructing a fresh registry rather than mutating
 * the existing one. This keeps the public interface immutable from the
 * consumer's perspective.
 *
 * @param profiles Optional list of user-supplied profiles. Each profile is
 *   converted to a definition with only identity fields (no policy).
 * @returns A fully-initialized `InMemoryAgentDefinitionRegistry`. Callers
 *   that need the read-only interface should typed-narrow to
 *   `AgentDefinitionRegistry` at the call site.
 */
export function createAgentDefinitionRegistry(
  profiles?: readonly AgentProfile[]
): InMemoryAgentDefinitionRegistry {
  // Step 1: pick the set of ids the caller supplied. We use this to filter
  // out defaults that should be overridden, instead of registering both and
  // then mutating (which would require register() to support replace, which
  // it doesn't by design).
  const callerIds = new Set<string>(profiles?.map((p) => p.id) ?? []);

  const registry = new InMemoryAgentDefinitionRegistry();

  // Step 2: register defaults that the caller has NOT shadowed.
  for (const def of DEFAULT_AGENT_DEFINITIONS) {
    if (!callerIds.has(def.id)) {
      registry.register(def);
    }
  }

  // Step 3: register caller profiles, promoted to definitions with only
  // identity fields. Rich definitions (with policy fields) are out of scope
  // for Stage 25's config path — Stage 26 will introduce a config schema
  // that accepts them. For now, callers needing policy fields construct
  // the registry directly.
  if (profiles) {
    for (const profile of profiles) {
      const definition: AgentDefinition = {
        id: profile.id,
        role: profile.role,
        description: profile.description,
        maxContextTokens: profile.maxContextTokens
      };
      registry.register(definition);
    }
  }

  return registry;
}
```

---

## CHANGE 2 — `packages/agentic-ai-infra-runtime/src/agents/index.ts`

Add the registry re-export at the **end** of the file (after the existing
`createDefaultAgentProfiles` function or its final closing brace). Do NOT
modify any existing code in this file. Just append:

```typescript
// -------------------------------------------------------------------------
// Stage 25 — Agent definition registry (Phase 02)
// -------------------------------------------------------------------------

export {
  DEFAULT_AGENT_DEFINITIONS,
  InMemoryAgentDefinitionRegistry,
  createAgentDefinitionRegistry
} from "./registry.js";
```

The barrel `runtime/src/index.ts` already re-exports `agents/index.js`. No
further export wiring needed.

---

## CHANGE 3 — `packages/agentic-ai-infra-runtime/test/agents/registry.test.ts` (NEW)

Create this file with the parent directory if it doesn't exist:

```typescript
import { describe, expect, it } from "vitest";
import type {
  AgentDefinition,
  AgentProfile,
  AgentRole
} from "@maharudra/agentic-ai-infra-core";
import {
  DEFAULT_AGENT_DEFINITIONS,
  InMemoryAgentDefinitionRegistry,
  createAgentDefinitionRegistry
} from "../../src/agents/registry.js";

describe("InMemoryAgentDefinitionRegistry — registration validation", () => {
  it("throws when id is empty", () => {
    const registry = new InMemoryAgentDefinitionRegistry();
    expect(() =>
      registry.register({ id: "", role: "manager" })
    ).toThrow(/non-empty string/);
  });

  it("throws when id is whitespace only", () => {
    const registry = new InMemoryAgentDefinitionRegistry();
    expect(() =>
      registry.register({ id: "   ", role: "manager" })
    ).toThrow(/non-empty string/);
  });

  it("throws when role is not a valid AgentRole", () => {
    const registry = new InMemoryAgentDefinitionRegistry();
    // Cast through unknown because TS would otherwise refuse to type-check
    // a bogus role literal. Runtime guard catches what compile-time may miss.
    const bogus = { id: "x", role: "ceo" as unknown as AgentRole };
    expect(() => registry.register(bogus)).toThrow(
      /agent\.definition-invalid-role/
    );
  });

  it("throws on duplicate id", () => {
    const registry = new InMemoryAgentDefinitionRegistry();
    registry.register({ id: "dup", role: "manager" });
    expect(() =>
      registry.register({ id: "dup", role: "security-reviewer" })
    ).toThrow(/agent\.definition-duplicate-id/);
  });

  it("returns this for chaining", () => {
    const registry = new InMemoryAgentDefinitionRegistry();
    const returned = registry
      .register({ id: "a", role: "manager" })
      .register({ id: "b", role: "security-reviewer" });
    expect(returned).toBe(registry);
    expect(registry.count()).toBe(2);
  });
});

describe("InMemoryAgentDefinitionRegistry — lookup", () => {
  it("list() returns definitions in insertion order", () => {
    const registry = new InMemoryAgentDefinitionRegistry()
      .register({ id: "first", role: "manager" })
      .register({ id: "second", role: "security-reviewer" })
      .register({ id: "third", role: "docs-reviewer" });

    const ids = registry.list().map((d) => d.id);
    expect(ids).toEqual(["first", "second", "third"]);
  });

  it("findById returns the registered definition", () => {
    const def: AgentDefinition = {
      id: "specific",
      role: "security-reviewer",
      allowedTools: ["agentic.retrieval.search"],
      budgetPolicy: { maxTokens: 1500 }
    };
    const registry = new InMemoryAgentDefinitionRegistry().register(def);
    const found = registry.findById("specific");
    expect(found).toEqual(def);
  });

  it("findById returns undefined for unknown id", () => {
    const registry = new InMemoryAgentDefinitionRegistry().register({
      id: "exists",
      role: "manager"
    });
    expect(registry.findById("missing")).toBeUndefined();
  });

  it("findByRole returns all matching definitions in insertion order", () => {
    const registry = new InMemoryAgentDefinitionRegistry()
      .register({ id: "sec-a", role: "security-reviewer" })
      .register({ id: "mgr", role: "manager" })
      .register({ id: "sec-b", role: "security-reviewer" });

    const ids = registry.findByRole("security-reviewer").map((d) => d.id);
    expect(ids).toEqual(["sec-a", "sec-b"]);
  });

  it("findByRole returns empty array when no match", () => {
    const registry = new InMemoryAgentDefinitionRegistry().register({
      id: "x",
      role: "manager"
    });
    expect(registry.findByRole("security-reviewer")).toEqual([]);
  });

  it("count reflects the registered total", () => {
    const registry = new InMemoryAgentDefinitionRegistry();
    expect(registry.count()).toBe(0);
    registry.register({ id: "a", role: "manager" });
    expect(registry.count()).toBe(1);
    registry.register({ id: "b", role: "security-reviewer" });
    expect(registry.count()).toBe(2);
  });
});

describe("createAgentDefinitionRegistry — factory", () => {
  it("registers the six default definitions when no profiles supplied", () => {
    const registry = createAgentDefinitionRegistry();
    expect(registry.count()).toBe(6);
    expect(registry.findById("manager")).toBeDefined();
    expect(registry.findById("architecture-reviewer")).toBeDefined();
    expect(registry.findById("security-reviewer")).toBeDefined();
    expect(registry.findById("implementation-planner")).toBeDefined();
    expect(registry.findById("eval-reviewer")).toBeDefined();
    expect(registry.findById("docs-reviewer")).toBeDefined();
  });

  it("default definitions carry no policy fields (backwards-compat — D23)", () => {
    const registry = createAgentDefinitionRegistry();
    for (const def of registry.list()) {
      expect(def.allowedTools).toBeUndefined();
      expect(def.budgetPolicy).toBeUndefined();
      expect(def.evalRules).toBeUndefined();
      expect(def.modelPolicy).toBeUndefined();
      expect(def.retrievalPolicy).toBeUndefined();
      expect(def.memoryPolicy).toBeUndefined();
      expect(def.approvalPolicy).toBeUndefined();
    }
  });

  it("caller profile overrides default with same id", () => {
    const callerProfile: AgentProfile = {
      id: "manager",
      role: "manager",
      description: "Custom manager",
      maxContextTokens: 12000
    };
    const registry = createAgentDefinitionRegistry([callerProfile]);
    expect(registry.count()).toBe(6);
    const found = registry.findById("manager");
    expect(found?.description).toBe("Custom manager");
    expect(found?.maxContextTokens).toBe(12000);
  });

  it("new caller profile adds beyond the six defaults", () => {
    const extra: AgentProfile = {
      id: "custom-pentester",
      role: "security-reviewer"
    };
    const registry = createAgentDefinitionRegistry([extra]);
    expect(registry.count()).toBe(7);
    expect(registry.findById("custom-pentester")).toBeDefined();
    const securityRole = registry.findByRole("security-reviewer");
    // Two matches: the default + the caller's extra.
    expect(securityRole.map((d) => d.id)).toEqual([
      "security-reviewer",
      "custom-pentester"
    ]);
  });
});

describe("DEFAULT_AGENT_DEFINITIONS", () => {
  it("contains exactly 6 entries, one per default role", () => {
    expect(DEFAULT_AGENT_DEFINITIONS).toHaveLength(6);
    const roles = DEFAULT_AGENT_DEFINITIONS.map((d) => d.role);
    expect(roles).toEqual([
      "manager",
      "architecture-reviewer",
      "security-reviewer",
      "implementation-planner",
      "eval-reviewer",
      "docs-reviewer"
    ]);
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

All must pass. Test count should be 437 + 12 = 449. If `pnpm test` reports
a count outside the range 447–451, recheck the test file (a missing test
or a duplicate test could shift the count).

Common pitfalls:
- Forgetting to re-build core after Phase 01 → import errors. Run
  `pnpm.cmd --filter @maharudra/agentic-ai-infra-core run build` first if
  unsure.
- TypeScript "Type 'AgentDefinition' is not assignable" errors usually
  mean the intersection from Phase 01 isn't propagating; check that
  Phase 01's `core/src/agents/types.ts` changes are saved and built.
- The test file imports from `../../src/agents/registry.js` (note the `.js`
  extension — this is the ESM build convention used throughout the repo).

---

## SELF-REVIEW CHECKLIST

- [ ] `runtime/src/agents/registry.ts` created with `InMemoryAgentDefinitionRegistry`, `createAgentDefinitionRegistry`, `DEFAULT_AGENT_DEFINITIONS`
- [ ] Class implements `AgentDefinitionRegistry` interface (4 methods)
- [ ] `register()` validates: non-empty id, valid role (runtime guard), duplicate id
- [ ] `register()` throws synchronously — no `FrameworkResult` indirection
- [ ] `register()` returns `this` for chaining
- [ ] `DEFAULT_AGENT_DEFINITIONS` has 6 entries, one per `DEFAULT_AGENT_ROLES` role, with NO policy fields
- [ ] `createAgentDefinitionRegistry()` does not throw when called with no args
- [ ] Caller profiles override defaults by id (caller wins)
- [ ] `runtime/src/agents/index.ts` re-exports the three symbols added in Phase 02
- [ ] Test file has 12 tests organized into 4 `describe` blocks
- [ ] `pnpm.cmd typecheck` passes
- [ ] `pnpm.cmd build` passes
- [ ] `pnpm.cmd test` reports ~449 passing
- [ ] `pnpm.cmd lint` passes
- [ ] No file outside the FILES TO CHANGE list was modified

---

## WHAT NOT TO DO

- ❌ Do NOT make `register()` async or return a Promise — registry is in-memory
- ❌ Do NOT make `register()` return `FrameworkResult<this>` — throw on invalid input, like `DefaultBudgetGate.constructor`
- ❌ Do NOT add `register()` to the `AgentDefinitionRegistry` interface (D21 — interface is read-only)
- ❌ Do NOT add an `unregister()` or `clear()` method — registries are constructed once
- ❌ Do NOT make defaults restrictive (D23 — backwards compat is non-negotiable; defaults have NO policy fields)
- ❌ Do NOT wire the registry into `RuntimeServiceContainer` in this phase — that's Phase 03
- ❌ Do NOT modify any executor — that's Phase 04
- ❌ Do NOT add an MCP tool that exposes the registry — Stage 26 introduces orchestrator-aware tools
- ❌ Do NOT add a `serialize()` or `toJSON()` method — definitions are not persisted in Stage 25 (Stage 27 may add this when Postgres-backing the eval store; out of scope here)
- ❌ Do NOT add capability validation against the live tool registry — Stage 26 introduces this, would couple registry to `PolicyEnforcingToolRegistry`
- ❌ Do NOT modify `DEFAULT_AGENT_ROLES` in `agents/index.ts` — that constant remains the executor's source of truth; this phase's `DEFAULT_AGENT_DEFINITIONS` is the registry's parallel

---

## DONE SIGNAL

When the phase is complete, output exactly this block (filling in actual numbers):

```
Stage 25 Phase 02 complete. Test count: [N]/[N] passing.
CI: build ✓ typecheck ✓ test ✓ lint ✓.
Files changed:
  packages/agentic-ai-infra-runtime/src/agents/registry.ts (new — InMemoryAgentDefinitionRegistry + factory + DEFAULT_AGENT_DEFINITIONS)
  packages/agentic-ai-infra-runtime/src/agents/index.ts (modified — added 3 re-exports)
  packages/agentic-ai-infra-runtime/test/agents/registry.test.ts (new — 12 tests across 4 describe blocks)
Next: Phase 03 — wire agentRegistry into RuntimeServiceContainer.
```

Do not add commentary after this block. Stop and wait for the operator to
move to Phase 03.
