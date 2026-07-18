import type {
  AgenticInfraProjectConfig,
  ResolvedProjectConfig
} from "../config/types.js";
import { fail, ok, validationIssue } from "../errors/index.js";
import {
  BUILT_IN_PROFILE_NAMES,
  type BuiltInProfileName,
  type CapabilityProfile,
  type DeepPartial,
  type ProfileResolver
} from "./types.js";
import { BUILT_IN_PROFILES, DEFAULT_PROJECT_CONFIG } from "./built-in-profiles.js";

const PROFILE_BY_NAME = new Map(
  BUILT_IN_PROFILES.map((profile) => [profile.name, profile])
);

/**
 * Checks whether a value can participate in deep config merging.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deep-merges plain objects while preserving explicit override values.
 */
function mergeRecords(
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(override)) {
    // Undefined means "no override" so profile defaults can continue to apply.
    if (value === undefined) {
      continue;
    }

    const existing = merged[key];

    if (isRecord(existing) && isRecord(value)) {
      // Recurse only for plain object categories such as runtime/security.
      // Arrays and scalar values intentionally replace the base value.
      merged[key] = mergeRecords(existing, value);
      continue;
    }

    merged[key] = value;
  }

  return merged;
}

/**
 * Merges a base project config with a partial override.
 *
 * Profile resolution uses this to layer defaults, selected profiles, and the
 * user-authored project config in a deterministic order.
 */
export function mergeProjectConfig(
  base: AgenticInfraProjectConfig,
  override: DeepPartial<AgenticInfraProjectConfig>
): AgenticInfraProjectConfig {
  return mergeRecords(
    base as Record<string, unknown>,
    override as Record<string, unknown>
  ) as AgenticInfraProjectConfig;
}

/**
 * Narrows an arbitrary profile string to a known built-in profile name.
 */
export function isBuiltInProfileName(name: string): name is BuiltInProfileName {
  return (BUILT_IN_PROFILE_NAMES as readonly string[]).includes(name);
}

/**
 * Returns the built-in profile definitions for docs, UIs, and tests.
 */
export function getBuiltInProfiles(): readonly CapabilityProfile[] {
  return BUILT_IN_PROFILES;
}

/**
 * Default profile resolver for the core framework.
 *
 * It turns simple user-facing profile names into a complete resolved config
 * while keeping explicit user config as the final override layer.
 */
export class DefaultProfileResolver implements ProfileResolver {
  /**
   * Resolves selected profiles plus explicit config into a fully populated
   * `ResolvedProjectConfig`.
   */
  resolve(config: AgenticInfraProjectConfig) {
    // Minimal is the default so an empty config still resolves to the smallest
    // local-safe contract surface.
    const requestedProfiles = config.profiles?.length
      ? [...config.profiles]
      : ["minimal"];

    const unknownProfiles = requestedProfiles.filter(
      (profileName) => !isBuiltInProfileName(profileName)
    );

    if (unknownProfiles.length > 0) {
      // Unknown profiles are recoverable config errors: callers can present the
      // issue and ask users to choose one of the built-ins.
      return fail<ResolvedProjectConfig>({
        code: "config.invalid-profile",
        message: `Unknown capability profile: ${unknownProfiles.join(", ")}.`,
        severity: "recoverable",
        issues: unknownProfiles.map((profileName) =>
          validationIssue({
            path: "profiles",
            code: "config.invalid-profile",
            message: `Unknown capability profile "${profileName}".`
          })
        )
      });
    }

    let resolved = DEFAULT_PROJECT_CONFIG;

    for (const profileName of requestedProfiles) {
      const profile = PROFILE_BY_NAME.get(profileName as BuiltInProfileName);

      if (profile) {
        // Apply profile configs in caller order so later profiles can specialize
        // earlier profile defaults.
        resolved = mergeProjectConfig(resolved, profile.config);
      }
    }

    // User-authored config is last so users can specialize profile output while
    // validators still prevent weakening mandatory safety rules.
    resolved = mergeProjectConfig(resolved, config);

    return ok({
      ...resolved,
      project: resolved.project ?? { name: "" },
      profiles: requestedProfiles,
      runtime: resolved.runtime ?? DEFAULT_PROJECT_CONFIG.runtime!,
      storage: resolved.storage ?? DEFAULT_PROJECT_CONFIG.storage!,
      retrieval: resolved.retrieval ?? DEFAULT_PROJECT_CONFIG.retrieval!,
      agents: resolved.agents ?? DEFAULT_PROJECT_CONFIG.agents!,
      tokenEfficiency:
        resolved.tokenEfficiency ?? DEFAULT_PROJECT_CONFIG.tokenEfficiency!,
      dashboard: resolved.dashboard ?? DEFAULT_PROJECT_CONFIG.dashboard!,
      security: resolved.security ?? DEFAULT_PROJECT_CONFIG.security!,
      freshness: resolved.freshness ?? DEFAULT_PROJECT_CONFIG.freshness!,
      observability: resolved.observability ?? DEFAULT_PROJECT_CONFIG.observability!,
      tools: resolved.tools ?? [],
      extensions: resolved.extensions ?? []
    });
  }
}
