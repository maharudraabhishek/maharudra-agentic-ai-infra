import type { CliIssue, CliResult } from "./types.js";

/**
 * Creates a successful CLI result with an optional issue list.
 *
 * Warnings can travel with successful results, which lets commands surface
 * non-blocking safety information without failing the operation.
 */
export function cliOk<T>(
  value: T,
  issues: readonly CliIssue[] = []
): CliResult<T> {
  return { ok: true, value, issues };
}

/**
 * Creates a failed CLI result.
 *
 * Failures always carry typed issues so command output and tests can rely on
 * stable error codes instead of parsing free-form text.
 */
export function cliFail<T = never>(issues: readonly CliIssue[]): CliResult<T> {
  return { ok: false, issues };
}

/**
 * Creates an error-severity issue.
 */
export function errorIssue(
  code: string,
  message: string,
  suggestion?: string
): CliIssue {
  return { severity: "error", code, message, suggestion };
}

/**
 * Creates a warning-severity issue.
 */
export function warningIssue(
  code: string,
  message: string,
  suggestion?: string
): CliIssue {
  return { severity: "warning", code, message, suggestion };
}
