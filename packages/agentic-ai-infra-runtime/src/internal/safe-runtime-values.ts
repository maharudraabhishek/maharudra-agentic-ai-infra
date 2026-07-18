import type {
  ErrorCode,
  FeedbackAction,
  RefusalReason,
  SafetyVerdict
} from "@maharudra/agentic-ai-infra-core";

const ERROR_CODES: readonly ErrorCode[] = [
  "config.missing-project-name", "config.invalid-slug", "config.invalid-profile",
  "config.invalid-runtime-mode", "config.invalid-runtime-combination",
  "config.remote-auth-required", "config.remote-authorization-required",
  "config.remote-rate-limit-required", "config.remote-audit-required",
  "config.invalid-port", "config.duplicate-port", "config.retrieval-storage-required",
  "config.pgvector-postgres-required", "config.multi-agent-context-required",
  "config.multi-agent-token-budget-required", "config.unsafe-remote-tool",
  "config.security-policy-weakened", "config.invalid-path", "config.invalid-token-budget",
  "config.invalid-extension-provider", "config.duplicate-id", "config.invalid-provider",
  "config.filesystem-storage-not-implemented", "runtime.remote-policy-required",
  "runtime.public-bind-denied", "runtime.unsafe-tool", "runtime.tool-not-found",
  "runtime.permission-denied", "runtime.approval-required", "runtime.tool-execution-failed",
  "runtime.start-failed", "agent.invalid-mode", "agent.role-disabled",
  "agent.context-unavailable", "storage.unavailable", "storage.not-migrated",
  "storage.pgvector-unavailable", "storage.migration-failed", "migration.approval-required",
  "migration.discovery-failed", "retrieval.not-configured", "retrieval.not-indexed",
  "retrieval.storage-unavailable", "retrieval.unsupported-input", "retrieval.mock-embedding",
  "retrieval.embedding-failed", "context.budget-exceeded", "token.budget-exceeded",
  "llm.provider-unavailable", "llm.budget-exceeded", "llm.fallback-exhausted",
  "output.unsafe", "dashboard.policy-required", "dashboard.start-failed",
  "session.create-failed", "session.not-found", "session.thread-open-failed",
  "session.tool-call-record-failed", "evals.invalid-dataset", "evals.invalid-dataset-version",
  "evals.invalid-dataset-item", "evals.dataset-not-found", "evals.dataset-path-traversal",
  "evals.suite-not-registered", "evals.empty-store", "config.invalid-evals-store-capacity",
  "config.llm-judge-requires-llm-config", "agent.definition-duplicate-id",
  "agent.definition-not-found", "agent.definition-invalid-role", "agent.invalid-route",
  "agent.tool-not-in-allowlist", "agent.weak-evidence", "agent.tool-call-exceeded",
  "agent.timeout", "agent.retry-exhausted", "agent.retry-blocked",
  "agent.no-manager-registered", "framework.internal-error"
];

const ERROR_CODE_SET: ReadonlySet<string> = new Set(ERROR_CODES);
const CONTENT_ACTION_SET: ReadonlySet<string> = new Set(["pass", "block", "rewrite", "warn"]);
const FEEDBACK_ACTION_SET: ReadonlySet<string> = new Set(["accept", "retry", "escalate", "revise"]);
const REFUSAL_REASON_SET: ReadonlySet<string> = new Set([
  "role-floor", "remote-safe", "shell-blocked", "network-blocked",
  "arbitrary-sql-blocked", "mode-not-allowed", "approval-required", "agent-allowlist"
]);

/**
 * Checks canonical framework error-code membership.
 *
 * @param value - Untrusted dependency value.
 * @returns Whether the value is a declared `ErrorCode`; unknown values fail closed.
 */
export function isCanonicalErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && ERROR_CODE_SET.has(value);
}

/**
 * Checks content-guard action membership without type assertions.
 *
 * @param value - Untrusted guard action.
 * @returns Whether the action is part of the closed `SafetyVerdict` taxonomy.
 */
export function isContentAction(value: unknown): value is SafetyVerdict["action"] {
  return typeof value === "string" && CONTENT_ACTION_SET.has(value);
}

/**
 * Checks feedback action membership without type assertions.
 *
 * @param value - Untrusted feedback action.
 * @returns Whether the action belongs to the closed feedback taxonomy.
 */
export function isFeedbackAction(value: unknown): value is FeedbackAction {
  return typeof value === "string" && FEEDBACK_ACTION_SET.has(value);
}

/**
 * Checks refusal-reason membership without type assertions.
 *
 * @param value - Untrusted refusal value.
 * @returns Whether the value belongs to the closed refusal taxonomy.
 */
export function isRefusalReason(value: unknown): value is RefusalReason {
  return typeof value === "string" && REFUSAL_REASON_SET.has(value);
}

/**
 * Validates an opaque trace identifier before logging or persistence.
 *
 * The allowlist excludes path/control syntax and bounded length rejects
 * amplification. Credential indicators include common GitHub, AWS, Stripe,
 * and OpenAI-style prefixes in addition to semantic secret labels.
 *
 * @param value - Caller-supplied trace correlation identifier.
 * @returns Whether the identifier is bounded, opaque, and non-credential-shaped.
 */
export function isSafeTraceId(value: string): boolean {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    return false;
  }

  return !/(?:secret|password|credential|private|api[-_]?key|token|^sk-|^ghp_|^AKIA|^sk_live_)/i.test(value);
}
