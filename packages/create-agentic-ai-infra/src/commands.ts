import { createHelpText, parseCliArgs } from "./args.js";
import { validateGeneratedConfig } from "./config-factory.js";
import { formatDoctorReport, runDoctor } from "./doctor.js";
import { createWritePlan } from "./planner.js";
import { renderTemplates } from "./templates.js";
import type { CliResult, InitOptions, NormalizedInitOptions } from "./types.js";
import { normalizeInitOptions } from "./validation.js";
import { executeWritePlan, formatWritePlan } from "./writer.js";

/**
 * Process-style command output used by tests and the executable wrapper.
 */
export type CommandOutput = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

/**
 * Formats typed CLI issues into stderr text.
 *
 * Keeping this formatting centralized makes all commands return errors in the
 * same shape while preserving machine-friendly issue codes in tests.
 */
function issuesToText(result: CliResult<unknown>): string {
  if (result.ok) {
    return "";
  }

  return result.issues
    .map((issue) => {
      const suggestion = issue.suggestion ? ` Suggestion: ${issue.suggestion}` : "";
      return `${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}${suggestion}`;
    })
    .join("\n");
}

/**
 * Normalizes raw init options and validates the generated config contract.
 *
 * This is the shared preflight used by `init` and `validate`, which keeps both
 * commands aligned on the same safety checks before any write plan is created.
 */
async function normalizeAndValidate(
  options: InitOptions,
  cwd?: string
): Promise<CliResult<NormalizedInitOptions>> {
  const normalized = normalizeInitOptions(options, cwd);

  // Return normalization failures directly so users see the first boundary
  // that rejected their input, such as target path or unsupported package tool.
  if (!normalized.ok) {
    return normalized;
  }

  const configValidation = validateGeneratedConfig(normalized.value);

  // Config validation catches cross-field issues after defaults and derived
  // values are known.
  if (!configValidation.ok) {
    return {
      ok: false,
      issues: configValidation.issues
    };
  }

  return normalized;
}

/**
 * Runs the `init` command.
 *
 * The command always builds a write plan first. `executeWritePlan` respects
 * dry-run mode, so command orchestration does not need a separate write path.
 */
export async function runInitCommand(
  options: InitOptions,
  cwd?: string
): Promise<CommandOutput> {
  const normalized = await normalizeAndValidate(options, cwd);

  if (!normalized.ok) {
    return { exitCode: 1, stdout: "", stderr: issuesToText(normalized) };
  }

  const files = renderTemplates(normalized.value);
  const plan = await createWritePlan({ files, options: normalized.value, cwd });

  // Planning can fail before filesystem writes when paths are unsafe or the
  // target root is outside the current workspace.
  if (!plan.ok) {
    return { exitCode: 1, stdout: "", stderr: issuesToText(plan) };
  }

  await executeWritePlan(plan.value);

  return {
    // A blocked item is reported as a failed command even though no dangerous
    // write occurred; this makes sensitive-path protection visible in scripts.
    exitCode: plan.value.items.some((item) => item.action === "blocked") ? 1 : 0,
    stdout: formatWritePlan(plan.value),
    stderr: ""
  };
}

/**
 * Runs the `validate` command.
 *
 * Validation renders templates and creates a dry-run write plan so template
 * paths, unresolved placeholders, and generated config are checked together.
 */
export async function runValidateCommand(
  options: InitOptions,
  cwd?: string
): Promise<CommandOutput> {
  const normalized = await normalizeAndValidate(options, cwd);

  if (!normalized.ok) {
    return { exitCode: 1, stdout: "", stderr: issuesToText(normalized) };
  }

  const files = renderTemplates(normalized.value);
  const plan = await createWritePlan({
    files,
    options: { ...normalized.value, dryRun: true },
    cwd
  });

  if (!plan.ok) {
    return { exitCode: 1, stdout: "", stderr: issuesToText(plan) };
  }

  return {
    exitCode: 0,
    stdout: `Config and generated structure are valid for ${normalized.value.projectName}.\n${formatWritePlan(plan.value)}`,
    stderr: ""
  };
}

/**
 * Runs the `doctor` command.
 *
 * Doctor reports environment readiness but does not write files, start Docker,
 * run migrations, or mutate generated project state.
 */
export async function runDoctorCommand(
  options: InitOptions,
  cwd?: string
): Promise<CommandOutput> {
  const normalized = normalizeInitOptions(options, cwd);

  if (!normalized.ok) {
    return { exitCode: 1, stdout: "", stderr: issuesToText(normalized) };
  }

  const report = await runDoctor(normalized.value, cwd);
  const hasError = report.checks.some((check) => check.status === "error");

  return {
    exitCode: hasError ? 1 : 0,
    stdout: formatDoctorReport(report),
    stderr: ""
  };
}

/**
 * Routes parsed CLI arguments to the matching command implementation.
 *
 * The return value mirrors process output so tests can execute the CLI without
 * spawning a separate Node process.
 */
export async function runCli(args: readonly string[], cwd?: string): Promise<CommandOutput> {
  const parsed = parseCliArgs(args);

  if (parsed.help) {
    return { exitCode: 0, stdout: createHelpText(), stderr: "" };
  }

  switch (parsed.command) {
    case "init":
      return await runInitCommand(parsed.options, cwd);
    case "validate":
      return await runValidateCommand(parsed.options, cwd);
    case "doctor":
      return await runDoctorCommand(parsed.options, cwd);
    case "help":
      return { exitCode: 0, stdout: createHelpText(), stderr: "" };
  }
}
