import type {
  AgentDefinition,
  AgentDefinitionRegistry,
  SafeTaskMetadata
} from "../agents/types.js";
import type { FrameworkResult } from "../errors/index.js";

/**
 * Safe, read-only inputs used to choose the agents for one orchestration run.
 *
 * Policies receive a task hash/classification instead of raw task text and a
 * read-only registry so routing stays deterministic, non-mutating, and safe
 * to use before any execution begins. A policy returns a failed
 * `FrameworkResult` when these inputs cannot produce a valid route.
 *
 * @example
 * const input: SupervisorRouteInput = {
 *   task: { taskHash: "sha256:…", taskType: "implementation" },
 *   registry
 * };
 *
 * @umbrella Guardrails
 */
export type SupervisorRouteInput = {
  /** Safe, non-reversible task metadata; raw task text is intentionally excluded. */
  readonly task: SafeTaskMetadata;
  /** Read-only source of definitions that a policy may inspect but never mutate. */
  readonly registry: AgentDefinitionRegistry;
};

/**
 * Declares how an orchestrator combines the outputs from a non-empty route.
 *
 * The value is a planning hint only: it does not run agents or change the
 * registry. Implementations must return a route whose agent list is
 * compatible with the declared composition.
 *
 * @example
 * const composition: SupervisorComposition = "single";
 */
export type SupervisorComposition = "single" | "sequential" | "parallel";

/**
 * Immutable routing result that identifies the agents to run and their output
 * composition strategy.
 *
 * A successful policy result must contain at least one registered definition.
 * Invalid or unavailable routes are represented by the surrounding
 * `FrameworkResult` failure rather than an empty plan.
 *
 * @example
 * const plan: SupervisorRoutePlan = {
 *   agents: [managerDefinition],
 *   composition: "single"
 * };
 */
export type SupervisorRoutePlan = {
  /** Agents to run, in execution order. Never empty on a successful result. */
  readonly agents: readonly AgentDefinition[];
  /** Composition hint consumed by the orchestrator implementation. */
  readonly composition: SupervisorComposition;
};

/**
 * Pure policy contract for choosing a safe agent route from a registry.
 *
 * Implementations inspect only `SupervisorRouteInput` and return a typed
 * success or failure. They must not call a model, access the network or
 * filesystem, mutate the registry, or throw for an invalid route.
 *
 * @example
 * const result = policy.route({ task: safeTask, registry });
 * if (result.ok) {
 *   const plan = result.value;
 * }
 *
 * @umbrella Guardrails
 */
export interface SupervisorPolicy {
  /**
   * Selects an immutable execution plan for safe task metadata.
   *
   * @param input Safe task metadata and the read-only definitions to inspect.
   * @returns A non-empty route on success, or a typed failure when no valid
   *   route can be selected.
   * @remarks Implementations must be deterministic and fail through
   *   `FrameworkResult`; throwing would bypass the framework's policy boundary.
   */
  route(input: SupervisorRouteInput): FrameworkResult<SupervisorRoutePlan>;
}
