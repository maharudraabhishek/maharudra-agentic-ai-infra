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
