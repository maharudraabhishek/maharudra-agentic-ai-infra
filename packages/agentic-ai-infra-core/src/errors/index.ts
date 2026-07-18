import type { RefusalReason } from "../security/types.js";

/** Severity category for framework errors. */
export type ErrorSeverity = "recoverable" | "fatal";

/**
 * Stable framework error codes used across config, runtime, storage, retrieval,
 * context, and output-safety boundaries.
 */
export type ErrorCode =
  | "config.missing-project-name"
  | "config.invalid-slug"
  | "config.invalid-profile"
  | "config.invalid-runtime-mode"
  | "config.invalid-runtime-combination"
  | "config.remote-auth-required"
  | "config.remote-authorization-required"
  | "config.remote-rate-limit-required"
  | "config.remote-audit-required"
  | "config.invalid-port"
  | "config.duplicate-port"
  | "config.retrieval-storage-required"
  | "config.pgvector-postgres-required"
  | "config.multi-agent-context-required"
  | "config.multi-agent-token-budget-required"
  | "config.unsafe-remote-tool"
  | "config.security-policy-weakened"
  | "config.invalid-path"
  | "config.invalid-token-budget"
  | "config.invalid-extension-provider"
  | "config.duplicate-id"
  | "config.invalid-provider"
  | "config.filesystem-storage-not-implemented"
  | "runtime.remote-policy-required"
  | "runtime.public-bind-denied"
  | "runtime.unsafe-tool"
  | "runtime.tool-not-found"
  | "runtime.permission-denied"
  | "runtime.approval-required"
  | "runtime.tool-execution-failed"
  | "runtime.start-failed"
  | "agent.invalid-mode"
  | "agent.role-disabled"
  | "agent.context-unavailable"
  | "storage.unavailable"
  | "storage.not-migrated"
  | "storage.pgvector-unavailable"
  | "storage.migration-failed"
  | "migration.approval-required"
  | "migration.discovery-failed"
  | "retrieval.not-configured"
  | "retrieval.not-indexed"
  | "retrieval.storage-unavailable"
  | "retrieval.unsupported-input"
  | "retrieval.mock-embedding"
  | "retrieval.embedding-failed"
  | "context.budget-exceeded"
  | "token.budget-exceeded"
  // LLM errors
  | "llm.provider-unavailable"   // provider HTTP call failed or timed out
  | "llm.budget-exceeded"        // estimated cost exceeds maxCostPerCallUsd
  | "llm.fallback-exhausted"     // all providers in fallback chain failed
  | "output.unsafe"
  | "dashboard.policy-required"
  | "dashboard.start-failed"
  | "session.create-failed"
  | "session.not-found"
  | "session.thread-open-failed"
  | "session.tool-call-record-failed"
  // Eval errors (Stage 24)
  | "evals.invalid-dataset"
  | "evals.invalid-dataset-version"
  | "evals.invalid-dataset-item"
  | "evals.dataset-not-found"
  | "evals.dataset-path-traversal"
  | "evals.suite-not-registered"
  | "evals.empty-store"
  | "config.invalid-evals-store-capacity"
  | "config.llm-judge-requires-llm-config"
  // Agent definition errors (Stage 25)
  | "agent.definition-duplicate-id"
  | "agent.definition-not-found"
  | "agent.definition-invalid-role"
  | "agent.invalid-route"
  | "agent.tool-not-in-allowlist"
  | "agent.weak-evidence"           // Stage 25.5 P03 — onWeakEvidence === "abstain"
  | "agent.tool-call-exceeded"      // Stage 25.5 P03 — selected tools > maxToolCalls
  | "agent.timeout"                 // Stage 25.5 P03 — AbortController wall-clock fired
  | "agent.retry-exhausted"         // Stage 25.5 P04 — all retry attempts failed
  | "agent.retry-blocked"           // Stage 25.5 P04 — error code not retryable
  | "agent.no-manager-registered"
  | "framework.internal-error";

/**
 * One validation or policy issue with a config/result path and stable code.
 */
export type ValidationIssue = {
  readonly path: string;
  readonly code: ErrorCode;
  readonly message: string;
  readonly severity: ErrorSeverity;
};

/**
 * Framework error payload returned by failed `FrameworkResult` values.
 */
export type FrameworkError = {
  readonly code: ErrorCode;
  readonly message: string;
  readonly severity: ErrorSeverity;
  readonly issues?: readonly ValidationIssue[];
  /** Closed denial reason when the failure originated at a policy boundary. */
  readonly refusalReason?: RefusalReason;
  readonly cause?: unknown;
};

/**
 * Success/failure wrapper used by framework packages.
 */
export type FrameworkResult<T> =
  | {
      readonly ok: true;
      readonly value: T;
      readonly warnings?: readonly ValidationIssue[];
    }
  | {
      readonly ok: false;
      readonly error: FrameworkError;
    };

/**
 * Creates a successful framework result.
 *
 * Warnings are carried separately so callers can proceed while still surfacing
 * recoverable policy or freshness information.
 */
export function ok<T>(
  value: T,
  warnings: readonly ValidationIssue[] = []
): FrameworkResult<T> {
  return { ok: true, value, warnings };
}

/**
 * Creates a failed framework result.
 */
export function fail<T = never>(error: FrameworkError): FrameworkResult<T> {
  return { ok: false, error };
}

/**
 * Creates a validation issue with recoverable severity by default.
 */
export function validationIssue(params: {
  path: string;
  code: ErrorCode;
  message: string;
  severity?: ErrorSeverity;
}): ValidationIssue {
  return {
    path: params.path,
    code: params.code,
    message: params.message,
    // Most validation issues are recoverable. Fatal severity is reserved for
    // security-policy weakening or unsafe runtime exposure.
    severity: params.severity ?? "recoverable"
  };
}

/**
 * Converts validation issues into a failed framework result.
 *
 * The returned error severity is fatal when any issue is fatal; otherwise the
 * caller receives a recoverable validation failure.
 */
export function validationFailure<T = never>(
  issues: readonly ValidationIssue[]
): FrameworkResult<T> {
  const severity: ErrorSeverity = issues.some(
    (issue) => issue.severity === "fatal"
  )
    ? "fatal"
    : "recoverable";

  return fail({
    code: severity === "fatal" ? "config.security-policy-weakened" : "config.invalid-provider",
    message: "Project config validation failed.",
    severity,
    issues
  });
}

/**
 * Creates a fatal security-policy failure.
 *
 * This helper is used when a config or runtime request weakens a fail-closed
 * safety boundary.
 */
export function fatalPolicyFailure<T = never>(
  message: string,
  issues: readonly ValidationIssue[]
): FrameworkResult<T> {
  return fail({
    code: "config.security-policy-weakened",
    message,
    severity: "fatal",
    issues
  });
}
