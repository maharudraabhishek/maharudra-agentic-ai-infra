import { describe, it, expect, vi } from "vitest";
import type { AgentRetryPolicy } from "@maharudra/agentic-ai-infra-core";
import { ok, fail } from "@maharudra/agentic-ai-infra-core";
import { runWithRetry } from "../../src/feedback-loops/retry-loop.js";

describe("Stage 25.5 Phase 04 — RetryLoop", () => {
  it("no policy: runs once and returns success", async () => {
    const op = vi.fn().mockResolvedValueOnce(ok("done"));
    const r = await runWithRetry(op, undefined);
    expect(r.ok).toBe(true);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("policy with maxAttempts=1: runs once even on retryable failure", async () => {
    const op = vi.fn().mockResolvedValueOnce(
      fail({ code: "llm.provider-unavailable", message: "x", severity: "recoverable" })
    );
    const policy: AgentRetryPolicy = {
      maxAttempts: 1,
      retryableErrorCodes: ["llm.provider-unavailable"]
    };
    const r = await runWithRetry(op, policy);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("agent.retry-exhausted");
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("retries up to maxAttempts on allowlisted error, succeeds mid-loop", async () => {
    const op = vi.fn()
      .mockResolvedValueOnce(fail({ code: "llm.provider-unavailable", message: "x", severity: "recoverable" }))
      .mockResolvedValueOnce(fail({ code: "llm.provider-unavailable", message: "x", severity: "recoverable" }))
      .mockResolvedValueOnce(ok("done"));
    const policy: AgentRetryPolicy = {
      maxAttempts: 3,
      retryableErrorCodes: ["llm.provider-unavailable"]
    };
    const r = await runWithRetry(op, policy);
    expect(r.ok).toBe(true);
    expect(op).toHaveBeenCalledTimes(3);
  });

  it("returns agent.retry-exhausted after maxAttempts failures", async () => {
    const op = vi.fn().mockResolvedValue(
      fail({ code: "llm.provider-unavailable", message: "x", severity: "recoverable" })
    );
    const policy: AgentRetryPolicy = {
      maxAttempts: 3,
      retryableErrorCodes: ["llm.provider-unavailable"]
    };
    const r = await runWithRetry(op, policy);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("agent.retry-exhausted");
    expect(op).toHaveBeenCalledTimes(3);
  });

  it("does not copy the final dependency message into retry exhaustion", async () => {
    const op = vi.fn().mockResolvedValue(
      fail({
        code: "llm.provider-unavailable",
        message: "C:\\private\\provider-secret",
        severity: "recoverable"
      })
    );
    const r = await runWithRetry(op, {
      maxAttempts: 2,
      retryableErrorCodes: ["llm.provider-unavailable"]
    });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("agent.retry-exhausted");
      expect(r.error.message).toContain("llm.provider-unavailable");
      expect(r.error.message).not.toContain("private");
      expect(r.error.message).not.toContain("provider-secret");
    }
  });

  it("returns agent.retry-blocked when error code is in NEVER_RETRY (D39)", async () => {
    const op = vi.fn().mockResolvedValue(
      fail({ code: "runtime.permission-denied", message: "x", severity: "recoverable" })
    );
    // Even if user adds permission-denied to retryableErrorCodes, framework refuses
    const policy: AgentRetryPolicy = {
      maxAttempts: 5,
      retryableErrorCodes: ["runtime.permission-denied"]
    };
    const r = await runWithRetry(op, policy);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("agent.retry-blocked");
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("preserves a typed refusal when retry is blocked", async () => {
    const r = await runWithRetry(
      async () => fail({
        code: "runtime.permission-denied",
        message: "Denied by policy.",
        severity: "recoverable",
        refusalReason: "agent-allowlist"
      }),
      { maxAttempts: 3, retryableErrorCodes: ["runtime.permission-denied"] }
    );

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("agent.retry-blocked");
      expect(r.error.refusalReason).toBe("agent-allowlist");
    }
  });

  it("returns agent.retry-blocked when code not in user allowlist", async () => {
    const op = vi.fn().mockResolvedValue(
      fail({ code: "retrieval.embedding-failed", message: "x", severity: "recoverable" })
    );
    const policy: AgentRetryPolicy = {
      maxAttempts: 3,
      retryableErrorCodes: ["llm.provider-unavailable"]
    };
    const r = await runWithRetry(op, policy);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("agent.retry-blocked");
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("honors backoffMs between attempts", async () => {
    const op = vi.fn()
      .mockResolvedValueOnce(fail({ code: "llm.provider-unavailable", message: "x", severity: "recoverable" }))
      .mockResolvedValueOnce(ok("done"));
    const policy: AgentRetryPolicy = {
      maxAttempts: 2,
      backoffMs: 30,
      retryableErrorCodes: ["llm.provider-unavailable"]
    };
    const start = Date.now();
    const r = await runWithRetry(op, policy);
    const elapsed = Date.now() - start;
    expect(r.ok).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(25);
  });
});
