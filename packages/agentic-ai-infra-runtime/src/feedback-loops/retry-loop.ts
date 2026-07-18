/**
 * Retry Loop — Stage 25.5 Phase 04
 *
 * The framework's first retry-with-backoff feedback-loop primitive. The
 * LLM SmartRouter's fallback chain (Stage 19) is single-shot per provider;
 * this loop retries the SAME operation with backoff between attempts.
 *
 * D39: hard-coded non-retryable set. Even if a user's `retryableErrorCodes`
 * lists a policy or budget code, the loop refuses to retry it. The
 * framework's safety floor is never opt-out.
 *
 * @umbrella Feedback Loops — in-run retry
 */
import type {
  AgentRetryPolicy,
  ErrorCode,
  FrameworkError,
  FrameworkResult
} from "@maharudra/agentic-ai-infra-core";
import { fail } from "@maharudra/agentic-ai-infra-core";

/**
 * Hard-coded codes that MUST NOT be retried regardless of user policy
 * (Stage 25.5 D39). Policy denials, budget refusals, and security gates.
 *
 * This set is intentionally not overridable — the framework's safety floor
 * cannot be opted out of by any `AgentRetryPolicy` configuration.
 */
const NEVER_RETRY: ReadonlySet<ErrorCode> = new Set([
  "runtime.permission-denied",
  "runtime.approval-required",
  "agent.tool-not-in-allowlist",
  "token.budget-exceeded",
  "agent.tool-call-exceeded",
  "llm.budget-exceeded",
  "agent.weak-evidence"
] as const);

/**
 * Wraps an async operation in a bounded retry loop with optional backoff.
 *
 * Returns on the first `ok` result. On every `fail` result the error code is
 * checked against `NEVER_RETRY` (hard stop) then against the user's
 * `retryableErrorCodes` allowlist before scheduling the next attempt.
 *
 * @param op - The operation to run. Receives the current attempt number (1-based).
 *   MUST be idempotent — repeated execution must be safe. The framework does
 *   NOT verify idempotency; callers are responsible.
 * @param policy - Retry policy. When undefined or `maxAttempts <= 1`, the
 *   operation runs exactly once and the result is returned as-is.
 * @returns The first `ok` result, or a typed `agent.retry-exhausted` /
 *   `agent.retry-blocked` failure.
 */
export async function runWithRetry<T>(
  op: (attempt: number) => Promise<FrameworkResult<T>>,
  policy: AgentRetryPolicy | undefined
): Promise<FrameworkResult<T>> {
  const maxAttempts = Math.max(1, policy?.maxAttempts ?? 1);
  const backoffMs = Math.max(0, policy?.backoffMs ?? 0);
  const retryable = new Set(policy?.retryableErrorCodes ?? []);

  let lastError: FrameworkError | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await op(attempt);

    if (result.ok) {
      return result;
    }

    lastError = result.error;

    // D39: hard-coded non-retryable codes block retry regardless of allowlist.
    if (NEVER_RETRY.has(result.error.code)) {
      return fail({
        code: "agent.retry-blocked",
        message: `Error "${result.error.code}" is in the non-retryable set; not retrying.`,
        severity: "recoverable",
        ...(result.error.refusalReason
          ? { refusalReason: result.error.refusalReason }
          : {})
      });
    }

    // Allowlist gate: only retry codes the user explicitly opted into.
    if (!retryable.has(result.error.code)) {
      return fail({
        code: "agent.retry-blocked",
        message: `Error "${result.error.code}" not in retryableErrorCodes; not retrying.`,
        severity: "recoverable",
        ...(result.error.refusalReason
          ? { refusalReason: result.error.refusalReason }
          : {})
      });
    }

    // Out of attempts — fall through to retry-exhausted.
    if (attempt >= maxAttempts) {
      break;
    }

    if (backoffMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  return fail({
    code: "agent.retry-exhausted",
    message: lastError
      ? `Retry exhausted after ${maxAttempts} attempt(s); last error code: ${lastError.code}.`
      : `Retry exhausted after ${maxAttempts} attempt(s).`,
    severity: "recoverable",
    ...(lastError?.refusalReason
      ? { refusalReason: lastError.refusalReason }
      : {})
  });
}
