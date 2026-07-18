import {
  fail,
  type ErrorCode,
  type ErrorSeverity,
  type FrameworkResult
} from "@maharudra/agentic-ai-infra-core";

/**
 * Builds a typed runtime failure in the shared `FrameworkResult` shape.
 *
 * Runtime code uses this helper instead of throwing for expected readiness,
 * policy, storage, migration, retrieval, and output-safety failures.
 */
export function runtimeFailure<T = never>(params: {
  readonly code: ErrorCode;
  readonly message: string;
  readonly severity?: ErrorSeverity;
  readonly cause?: unknown;
}): FrameworkResult<T> {
  // Delegate to the core helper so all packages keep one result/error contract.
  return fail({
    code: params.code,
    message: params.message,
    severity: params.severity ?? "recoverable",
    cause: params.cause
  });
}

/**
 * Builds a recoverable runtime failure for operational states the user can fix.
 */
export function recoverable<T = never>(
  code: ErrorCode,
  message: string,
  cause?: unknown
): FrameworkResult<T> {
  return runtimeFailure({ code, message, cause });
}

/**
 * Builds a fatal runtime failure for trust-boundary violations.
 */
export function fatal<T = never>(
  code: ErrorCode,
  message: string,
  cause?: unknown
): FrameworkResult<T> {
  return runtimeFailure({ code, message, severity: "fatal", cause });
}
