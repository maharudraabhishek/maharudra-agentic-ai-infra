import type { ToolContract, ToolContractRegistry } from "./types.js";

/**
 * Immutable in-memory tool registry used by core tests and runtime composition.
 *
 * This registry is policy-agnostic by design. It stores and returns tool contracts
 * without evaluating runtime mode, risk level, or security policy. Runtime-layer
 * callers must wrap it with a policy-enforcing decorator (PolicyEnforcingToolRegistry
 * in the runtime package) to enforce registration-time constraints such as
 * remote-safety, critical risk level, and shell-access restrictions. Keeping policy
 * out of core preserves the dependency-inversion rule: core must not import runtime.
 */
export class InMemoryToolContractRegistry implements ToolContractRegistry {
  private readonly toolsById = new Map<string, ToolContract>();

  /**
   * Builds a registry from the supplied contracts.
   */
  constructor(tools: readonly ToolContract[] = []) {
    for (const tool of tools) {
      // Last contract with the same id wins, matching map semantics and keeping
      // construction deterministic for generated tool lists.
      this.toolsById.set(tool.id, tool);
    }
  }

  /**
   * Lists registered contracts in insertion order.
   */
  list(): readonly ToolContract[] {
    return [...this.toolsById.values()];
  }

  /**
   * Finds one contract by id.
   */
  findById(id: string): ToolContract | undefined {
    return this.toolsById.get(id);
  }

  /**
   * Returns a new registry containing the existing tools and the supplied tool.
   */
  register(tool: ToolContract): ToolContractRegistry {
    return new InMemoryToolContractRegistry([...this.list(), tool]);
  }
}
