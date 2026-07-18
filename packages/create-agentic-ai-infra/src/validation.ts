import path from "node:path";
import {
  CLI_PROFILE_NAMES,
  CLI_RETRIEVAL_PROVIDER_TYPES,
  CLI_RUNTIME_MODES,
  type BuiltInProfileName,
  type RetrievalProviderType,
  type RuntimeMode
} from "./types.js";
import { cliFail, cliOk, errorIssue } from "./result.js";
import type {
  InitOptions,
  NormalizedInitOptions,
  PackageManager
} from "./types.js";

const PROJECT_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-zA-Z]:[\\/]/;

/**
 * Converts a display name into a package-safe project slug.
 *
 * The slug is conservative because it is reused in generated package names,
 * database names, and file paths.
 */
export function slugifyProjectName(projectName: string): string {
  return projectName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

/**
 * Validates that the project display name is not empty after trimming.
 */
export function validateProjectName(projectName: string): boolean {
  return projectName.trim().length > 0;
}

/**
 * Validates the generated or user-supplied project slug.
 *
 * Slugs must be lowercase, avoid leading or trailing dashes, and avoid empty
 * path/package segments.
 */
export function validateProjectSlug(slug: string): boolean {
  return PROJECT_SLUG_PATTERN.test(slug);
}

/**
 * Narrows an arbitrary string to a built-in profile name.
 */
export function isBuiltInProfile(value: string): value is BuiltInProfileName {
  return (CLI_PROFILE_NAMES as readonly string[]).includes(value);
}

/**
 * Expands runtime mode flags and removes duplicates.
 *
 * The special `all` value is accepted at the CLI boundary and replaced with
 * concrete runtime modes before config generation.
 */
export function parseRuntimeModes(values: readonly string[]): readonly RuntimeMode[] {
  const expanded = values.flatMap((value) =>
    value === "all" ? [...CLI_RUNTIME_MODES] : [value]
  );
  const unique = [...new Set(expanded)];

  // Unsupported values are dropped here and can be surfaced by the later
  // zero-supported-mode validation if the user selected only invalid names.
  return unique.filter((value): value is RuntimeMode =>
    (CLI_RUNTIME_MODES as readonly string[]).includes(value)
  );
}

/**
 * Expands retrieval strategy flags and removes duplicates.
 *
 * The `hybrid-all` convenience value maps to every supported generated
 * retrieval strategy so callers do not need to list them manually.
 */
export function parseRetrievalStrategies(
  values: readonly string[]
): readonly RetrievalProviderType[] {
  const expanded = values.flatMap((value) =>
    value === "hybrid-all"
      ? ["full-text", "pgvector", "document-tree", "page-index", "symbol-code", "graph", "hybrid"]
      : [value]
  );
  const unique = [...new Set(expanded)];

  // Unsupported values are dropped so config generation only receives known
  // provider types.
  return unique.filter((value): value is RetrievalProviderType =>
    (CLI_RETRIEVAL_PROVIDER_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Checks whether a template path is safe to write relative to a target root.
 *
 * The function rejects absolute paths, UNC-style paths, Windows absolute paths,
 * empty paths, and traversal segments before the planner resolves the path.
 */
export function validateTemplateRelativePath(relativePath: string): boolean {
  const normalized = relativePath.replaceAll("\\", "/");

  return (
    normalized.length > 0 &&
    !normalized.startsWith("/") &&
    !normalized.startsWith("//") &&
    !WINDOWS_ABSOLUTE_PATH_PATTERN.test(relativePath) &&
    !normalized.split("/").includes("..")
  );
}

/**
 * Resolves the requested target root and ensures it stays inside the cwd.
 *
 * Generated scaffolds may target the current workspace or a child directory.
 * Parent directories are rejected so the CLI cannot write outside the user's
 * active project by mistake.
 */
export function resolveTargetRoot(inputTarget: string, cwd: string): string {
  if (!inputTarget.trim()) {
    throw new Error("Target path cannot be empty.");
  }

  const resolved = path.resolve(cwd, inputTarget);
  const cwdWithSeparator = `${path.resolve(cwd)}${path.sep}`;

  // The equality check allows `--target .`; the prefix check allows children.
  if (resolved !== path.resolve(cwd) && !resolved.startsWith(cwdWithSeparator)) {
    throw new Error("Target path must be the current directory or a child directory.");
  }

  return resolved;
}

/**
 * Applies defaults and validates raw init options.
 *
 * Normalization converts loosely parsed CLI values into the stable option shape
 * used by config generation, template rendering, doctor checks, and write-plan
 * creation.
 */
export function normalizeInitOptions(
  options: InitOptions,
  cwd = process.cwd()
) {
  const target = options.target ?? ".";
  let resolvedTarget: string;

  try {
    resolvedTarget = resolveTargetRoot(target, cwd);
  } catch (error) {
    return cliFail<NormalizedInitOptions>([
      errorIssue(
        "invalid-target",
        error instanceof Error ? error.message : "Invalid target path.",
        "Use --target . or a child directory of the current workspace."
      )
    ]);
  }

  const projectName = options.projectName?.trim() || path.basename(resolvedTarget);
  const slug = options.slug?.trim() || slugifyProjectName(projectName);
  const profile = options.profile ?? "vectorless-local";
  const agentMode = options.agentMode ?? "single-agent";
  const runtimeModes = parseRuntimeModes(
    (options.runtime?.length ? options.runtime : ["local-stdio-mcp"]) as readonly string[]
  );
  const retrievalStrategies = parseRetrievalStrategies(
    (options.retrieval?.length ? options.retrieval : []) as readonly string[]
  );
  const packageManager: PackageManager = options.packageManager ?? "pnpm";
  const issues = [];

  if (!validateProjectName(projectName)) {
    // Project names are displayed in generated docs, so empty names should be
    // rejected before any template content is rendered.
    issues.push(
      errorIssue("invalid-project-name", "Project name cannot be empty.", "Pass --project-name with a readable project name.")
    );
  }

  if (!validateProjectSlug(slug)) {
    // The slug is reused in package and database names, so a strict pattern
    // avoids awkward generated identifiers.
    issues.push(
      errorIssue("invalid-slug", `Invalid project slug "${slug}".`, "Use lowercase letters, numbers, and single dashes.")
    );
  }

  if (!isBuiltInProfile(profile)) {
    // Unknown profiles are rejected here because config generation depends on
    // profile names that the core package understands.
    issues.push(
      errorIssue("invalid-profile", `Unsupported profile "${profile}".`, `Use one of: ${CLI_PROFILE_NAMES.join(", ")}.`)
    );
  }

  if (runtimeModes.length === 0) {
    // At least one runtime mode is required because the generated structure is
    // organized around runtime entrypoints.
    issues.push(
      errorIssue("invalid-runtime", "No supported runtime modes were selected.", `Use one of: ${CLI_RUNTIME_MODES.join(", ")} or all.`)
    );
  }

  if (packageManager !== "pnpm") {
    // The repository and generated contracts use pnpm workspaces, so accepting
    // other package managers would create inaccurate generated docs.
    issues.push(
      errorIssue("unsupported-package-manager", "Only pnpm is supported.", "Use pnpm for framework and generated project commands.")
    );
  }

  if (issues.length > 0) {
    return cliFail<NormalizedInitOptions>(issues);
  }

  return cliOk<NormalizedInitOptions>({
    projectName,
    slug,
    profile,
    agentMode,
    runtimeModes,
    retrievalStrategies,
    target,
    dashboard: options.dashboard ?? false,
    dashboardPort: options.dashboardPort ?? 8788,
    withDocker: options.withDocker ?? false,
    dockerPort: options.dockerPort ?? 5433,
    dryRun: options.dryRun ?? false,
    force: options.force ?? false,
    packageManager
  });
}
