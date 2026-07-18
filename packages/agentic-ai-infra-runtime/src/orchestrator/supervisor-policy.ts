import { fail, ok } from "@maharudra/agentic-ai-infra-core";
import type {
  AgentDefinition,
  FrameworkResult,
  SupervisorPolicy,
  SupervisorRouteInput,
  SupervisorRoutePlan
} from "@maharudra/agentic-ai-infra-core";

/**
 * Default pure supervisor that routes every task to one manager definition.
 *
 * The canonical `manager` id wins when present. A manager-role definition is
 * the deterministic fallback for registries that use a different id. The
 * policy returns a fatal typed failure when neither lookup succeeds, preventing
 * an execution path without an accountable manager.
 *
 * @example
 * const result = new DefaultSupervisorPolicy().route({ task: safeTask, registry });
 *
 * @umbrella Guardrails
 */
export class DefaultSupervisorPolicy implements SupervisorPolicy {
  /**
   * Selects the canonical manager or the first manager-role definition.
   *
   * @param input Safe task metadata and the registry to inspect. The default
   *   policy uses the registry only; it does not examine or persist task text.
   * @returns A single-agent plan, or a fatal `agent.no-manager-registered`
   *   failure when the registry contains no manager.
   * @remarks This method is synchronous, deterministic, non-mutating, and
   *   never throws so callers retain the framework result boundary.
   */
  route(input: SupervisorRouteInput): FrameworkResult<SupervisorRoutePlan> {
    // The reserved id is the stable default. The role lookup preserves support
    // for registries that deliberately give their manager a different id.
    const byId = input.registry.findById("manager");
    const manager: AgentDefinition | undefined =
      byId ?? input.registry.findByRole("manager")[0];

    if (!manager) {
      // Do not silently select another role: execution without a manager is a
      // fatal policy configuration failure at the routing boundary.
      return fail({
        code: "agent.no-manager-registered",
        message:
          "DefaultSupervisorPolicy requires a 'manager' AgentDefinition (by id or role). None registered.",
        severity: "fatal"
      });
    }

    return ok({ agents: [manager], composition: "single" });
  }
}
