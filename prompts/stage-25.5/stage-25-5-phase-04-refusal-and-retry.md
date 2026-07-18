# Stage 25.5 Phase 04 — Guardrails: Refusal Taxonomy + Feedback Loops: Retry Loop
## Claude Code Prompt — MahaRudra Agentic AI Infra

---

## BEFORE YOU START — READ THIS FIRST

**Platform:** Windows 11, PowerShell, Node >= 20, pnpm only
**CI command:** `pnpm.cmd run ci`
**Current test count:** read `STATUS.md` head (Phase 03 baseline)
**Expected after this phase:** Phase 03 count + ~10 tests

Two umbrellas co-ship in this phase: **Guardrails** (typed refusal codes
augment the existing string `reason`) and **Feedback Loops** (the first
feedback-umbrella module — bounded `RetryLoop`). They co-ship because the
retry decision reads typed refusal codes to determine retryability.

---

## CONTEXT — WHAT IS DONE

- **D23 (LOCKED):** existing string `reason` on `PermissionDecision` stays.
  Typed `refusalReason` is ADDITIVE.
- **D30/D31/D32 (Phase 03):** AgentResponsePolicy, expanded budgetPolicy,
  guard timing. Phase 04 reuses error codes `agent.weak-evidence`,
  `agent.tool-call-exceeded`, `agent.timeout` from Phase 03.
- **`DefaultPermissionGate` branches:** `runtime/src/harness/index.ts:165–216`.
  Each `return { allowed: false, reason: ... }` branch needs a typed
  `refusalReason` added — six branches.
- **`runtime/src/llm/anthropic-llm-provider.ts` retry-with-fallback (Stage 19):**
  used as a reference, but the LLM SmartRouter's fallback chain is
  single-shot per provider, NOT retry-with-backoff. Stage 25.5's retry
  loop is the framework's FIRST retry-with-backoff primitive.

---

## NEW LOCKED DECISIONS — Stage 25.5 Phase 04

### D35 — Typed RefusalReason taxonomy (8 codes; closed enum)
```typescript
export type RefusalReason =
  | "role-floor"            // roleAllowsTool denied (existing branch)
  | "remote-safe"           // tool not remote-safe in remote modes (existing)
  | "shell-blocked"         // shell/command tool blocked (existing)
  | "network-blocked"       // network-capable tool blocked (existing)
  | "arbitrary-sql-blocked" // arbitrary SQL blocked (existing)
  | "mode-not-allowed"      // tool not in allowedModes (existing)
  | "approval-required"     // approval missing (ApprovalPolicy)
  | "agent-allowlist";      // Stage 25 `allowedTools` filter (planning-time)
```

`PermissionDecision.refusalReason?: RefusalReason` is OPTIONAL — populated
in `DefaultPermissionGate.decide()` for every `allowed: false` branch. The
free-form `reason: string` stays for human-readable text. D23 preserved.

### D36 — `AgentRetryPolicy` shape (allowlist-only retryable codes)
```typescript
export type AgentRetryPolicy = {
  /** Total attempts. Default 1 (no retry) when policy is set. */
  readonly maxAttempts?: number;
  /** Backoff between attempts in milliseconds. Default 0 (no delay). */
  readonly backoffMs?: number;
  /**
   * Error codes that ARE retryable. ALLOWLIST — codes not listed are never
   * retried. Policy denials (`runtime.permission-denied`, `runtime.approval-required`,
   * `agent.tool-not-in-allowlist`), budget refusals (`token.budget-exceeded`,
   * `agent.tool-call-exceeded`, `llm.budget-exceeded`), and security gates
   * (`agent.weak-evidence`) are NEVER retried regardless of inclusion.
   */
  readonly retryableErrorCodes?: readonly string[];
};
```

`AgentDefinition.retryPolicy?: AgentRetryPolicy` is OPTIONAL. When absent,
no retry — preserves D23.

### D37 — `RetryLoop` is a feedback-loop primitive, not in harness
`runtime/src/feedback-loops/retry-loop.ts` is a pure function (a closure):
takes an operation + policy, returns the wrapped result. It does NOT
mutate harness state. The harness remains stateless. Executors call the
retry loop; the harness underneath executes one attempt and returns.

### D38 — Two new error codes
`agent.retry-exhausted` — all attempts failed
`agent.retry-blocked` — error code not in allowlist (no retry attempted)

### D39 — Non-retryable codes are HARD-CODED in the retry loop
Even if a user puts `runtime.permission-denied` in `retryableErrorCodes`,
the loop refuses to retry it. The framework's safety floor cannot be
opted-out of. The hard-coded non-retryable set:
```typescript
const NEVER_RETRY = new Set([
  "runtime.permission-denied",
  "runtime.approval-required",
  "agent.tool-not-in-allowlist",
  "token.budget-exceeded",
  "agent.tool-call-exceeded",
  "llm.budget-exceeded",
  "agent.weak-evidence"
]);
```

If a code is in `NEVER_RETRY`, the retry loop returns `agent.retry-blocked`
on first failure regardless of user policy.

---

## FILES TO CHANGE — COMPLETE LIST

| # | File | Action |
|---|---|---|
| 1 | `packages/agentic-ai-infra-core/src/security/types.ts` | MODIFY (add `RefusalReason` + optional field on `PermissionDecision`) |
| 2 | `packages/agentic-ai-infra-core/src/agents/types.ts` | MODIFY (add `AgentRetryPolicy` + field on `AgentDefinition`) |
| 3 | `packages/agentic-ai-infra-core/src/errors/index.ts` | MODIFY (2 new codes) |
| 4 | `packages/agentic-ai-infra-runtime/src/harness/index.ts` | MODIFY (populate `refusalReason` in all 6 deny branches) |
| 5 | `packages/agentic-ai-infra-runtime/src/feedback-loops/retry-loop.ts` | CREATE |
| 6 | `packages/agentic-ai-infra-runtime/src/feedback-loops/index.ts` | CREATE |
| 7 | `packages/agentic-ai-infra-runtime/src/index.ts` | MODIFY (export feedback-loops barrel) |
| 8 | `packages/agentic-ai-infra-runtime/test/guardrails/refusal-taxonomy.test.ts` | CREATE (~4 tests) |
| 9 | `packages/agentic-ai-infra-runtime/test/feedback-loops/retry-loop.test.ts` | CREATE (~6 tests) |
| 10 | `docs/internal/learning-notes/stage-25-5-retry-and-refusal.md` | CREATE |
| 11 | `docs/internal/v3-architecture-snapshot.md` | MODIFY |
| 12 | `kb.md` | MODIFY |
| 13 | `STATUS.md` | MODIFY |

---

## CHANGE 1 — MODIFY `packages/agentic-ai-infra-core/src/security/types.ts`

Add `RefusalReason` and extend `PermissionDecision` ADDITIVELY:

```typescript
/**
 * Closed taxonomy of refusal reasons emitted by `PermissionGate`
 * implementations (Stage 25.5 D35).
 *
 * Distinct from the free-form `reason: string` — this is the typed code
 * suitable for metrics, retry decisions, and over/under-refusal monitoring.
 *
 * @umbrella Guardrails
 */
export type RefusalReason =
  | "role-floor"
  | "remote-safe"
  | "shell-blocked"
  | "network-blocked"
  | "arbitrary-sql-blocked"
  | "mode-not-allowed"
  | "approval-required"
  | "agent-allowlist";

/** Decision returned by a permission gate. */
export type PermissionDecision = {
  readonly allowed: boolean;
  readonly reason: string;
  readonly requiredApproval?: ApprovalPolicy;
  /**
   * Typed refusal code (Stage 25.5 D35). Populated when `allowed: false`.
   * Undefined when `allowed: true` or when the gate is a custom
   * implementation that hasn't been migrated to the taxonomy.
   *
   * @guardrail
   */
  readonly refusalReason?: RefusalReason;
};
```

Do NOT rename `reason`. Do NOT make `refusalReason` required.

---

## CHANGE 2 — MODIFY `packages/agentic-ai-infra-core/src/agents/types.ts`

Insert `AgentRetryPolicy` near the other policy types (after `AgentApprovalPolicy`):

```typescript
/**
 * Per-agent retry policy (Stage 25.5 D36).
 *
 * Reserved error codes are NEVER retried regardless of `retryableErrorCodes`
 * inclusion — the framework's safety floor is not opt-out (D39). See
 * `runtime/src/feedback-loops/retry-loop.ts` for the hard-coded set.
 *
 * @umbrella Feedback Loops — in-run retry
 *
 * @example
 * const def: AgentDefinition = {
 *   id: "retrieval-resilient",
 *   role: "retrieval",
 *   retryPolicy: {
 *     maxAttempts: 3,
 *     backoffMs: 100,
 *     retryableErrorCodes: ["retrieval.embedding-failed", "llm.provider-unavailable"]
 *   }
 * };
 */
export type AgentRetryPolicy = {
  readonly maxAttempts?: number;
  readonly backoffMs?: number;
  readonly retryableErrorCodes?: readonly string[];
};
```

Add `retryPolicy?: AgentRetryPolicy` to `AgentDefinition`:

```typescript
export type AgentDefinition = AgentProfile & {
  // ... existing fields, including responsePolicy from Phase 03 ...
  readonly responsePolicy?: AgentResponsePolicy;
  readonly retryPolicy?: AgentRetryPolicy;          // NEW — Stage 25.5 P04
  // ... rest unchanged ...
};
```

---

## CHANGE 3 — MODIFY `packages/agentic-ai-infra-core/src/errors/index.ts`

Add two codes immediately after Phase 03's three (which were added near `agent.tool-not-in-allowlist`):

```typescript
  | "agent.tool-not-in-allowlist"   // existing
  | "agent.weak-evidence"            // Phase 03
  | "agent.tool-call-exceeded"       // Phase 03
  | "agent.timeout"                  // Phase 03
  | "agent.retry-exhausted"          // NEW — Stage 25.5 P04
  | "agent.retry-blocked"            // NEW — Stage 25.5 P04
```

---

## CHANGE 4 — MODIFY `packages/agentic-ai-infra-runtime/src/harness/index.ts`

In `DefaultPermissionGate.decide()` (around line 165–216), populate the
typed `refusalReason` field on every `allowed: false` branch:

```typescript
if (!tool.runtimePolicy.allowedModes?.includes(runtimeMode)) {
  return {
    allowed: false,
    reason: `Tool "${tool.id}" is not allowed in ${runtimeMode}.`,
    refusalReason: "mode-not-allowed"      // NEW
  };
}

if (tool.runtimePolicy.networkAccess) {
  return {
    allowed: false,
    reason: "Network-capable tools are disabled for deterministic runtime execution.",
    refusalReason: "network-blocked"        // NEW
  };
}

if (tool.runtimePolicy.shellAccess || tool.category === "command") {
  return {
    allowed: false,
    reason: "Shell and command tools are not available in this runtime.",
    refusalReason: "shell-blocked"          // NEW
  };
}

if (tool.runtimePolicy.arbitrarySqlAccess) {
  return {
    allowed: false,
    reason: "Arbitrary SQL tools are not available in this runtime.",
    refusalReason: "arbitrary-sql-blocked"  // NEW
  };
}

if (input.agentRole && !roleAllowsTool(input.agentRole, tool)) {
  return {
    allowed: false,
    reason: `Agent role "${input.agentRole}" cannot use tool "${tool.id}".`,
    refusalReason: "role-floor"             // NEW
  };
}

if (runtimeMode === "remote-http-mcp" || runtimeMode === "api-service") {
  if (!new DefaultRemoteSafeToolFilter().isRemoteSafe(tool)) {
    return {
      allowed: false,
      reason: `Tool "${tool.id}" is not remote-safe.`,
      refusalReason: "remote-safe"          // NEW
    };
  }
}
```

The `approval-required` and `agent-allowlist` codes are emitted from
DIFFERENT branches (the harness's approval check and the executors'
`enforceAllowedTools`). Leave a TODO comment in those locations referring
to D35 — Stage 26 will plumb the typed reason there. Phase 04 only wires
the six `DefaultPermissionGate` branches; the additional two codes are
defined and ready for Stage 26.

Add the import:
```typescript
import type { RefusalReason } from "@maharudra/agentic-ai-infra-core";
```

Do NOT change the `allowed: true` branch — `refusalReason` is undefined
when the decision is `allowed: true`.

---

## CHANGE 5 — CREATE `packages/agentic-ai-infra-runtime/src/feedback-loops/retry-loop.ts`

```typescript
/**
 * Retry Loop — Stage 25.5 Phase 04
 *
 * The framework's first retry-with-backoff feedback-loop primitive. The
 * LLM SmartRouter's fallback chain (Stage 19) is single-shot per provider;
 * this loop is per-attempt-with-backoff on the SAME operation.
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
 * Wraps an async operation in a bounded retry loop.
 *
 * @param op - The operation to run. Receives the current attempt number (1-based).
 *   MUST be idempotent — repeated execution must be safe. The framework does
 *   NOT verify idempotency; callers are responsible.
 * @param policy - Retry policy. When undefined or `maxAttempts <= 1`, the
 *   operation runs exactly once.
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

    // D39: hard-coded non-retryable codes block retry regardless of allowlist
    if (NEVER_RETRY.has(result.error.code)) {
      return fail({
        code: "agent.retry-blocked",
        message: `Error "${result.error.code}" is in the non-retryable set; not retrying.`,
        severity: "recoverable"
      });
    }

    // Allowlist gate: only retry codes the user explicitly opted into
    if (!retryable.has(result.error.code)) {
      return fail({
        code: "agent.retry-blocked",
        message: `Error "${result.error.code}" not in retryableErrorCodes; not retrying.`,
        severity: "recoverable"
      });
    }

    // Out of attempts — return retry-exhausted
    if (attempt >= maxAttempts) {
      break;
    }

    if (backoffMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  return fail({
    code: "agent.retry-exhausted",
    message: lastError
      ? `Retry exhausted after ${maxAttempts} attempts; last error: ${lastError.code} — ${lastError.message}`
      : `Retry exhausted after ${maxAttempts} attempts.`,
    severity: "recoverable"
  });
}
```

---

## CHANGE 6 — CREATE `packages/agentic-ai-infra-runtime/src/feedback-loops/index.ts`

```typescript
/**
 * Feedback Loops barrel — Stage 25.5 D25 umbrella.
 *
 * Phase 04 ships `retry-loop.ts`. Phase 05 adds `critique-loop.ts` (seam only)
 * and `eval-feedback-loop.ts` (seam only). Real implementations of in-run
 * critique (Stage 48) and cross-run RLHF (Stage 49) plug into these seams.
 */
export * from "./retry-loop.js";
```

---

## CHANGE 7 — MODIFY `packages/agentic-ai-infra-runtime/src/index.ts`

```typescript
export * from "./feedback-loops/index.js";
```

Place next to the `guardrails/index.js` export added in Phase 01.

---

## CHANGE 8 — CREATE `packages/agentic-ai-infra-runtime/test/guardrails/refusal-taxonomy.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import type { RuntimeMode, ToolContract } from "@maharudra/agentic-ai-infra-core";
import { DefaultPermissionGate } from "../../src/harness/index.js";

const baseTool = (overrides: Partial<ToolContract> = {}): ToolContract => ({
  id: "t-1",
  name: "T",
  description: "test",
  category: "read",
  riskLevel: "low",
  outputPolicy: { remoteSafe: true },
  runtimePolicy: { allowedModes: ["local-stdio-mcp"] },
  ...overrides
});

describe("Stage 25.5 Phase 04 — Refusal Taxonomy", () => {
  it("mode-not-allowed populates refusalReason", () => {
    const gate = new DefaultPermissionGate();
    const decision = gate.decide({
      runtimeMode: "remote-http-mcp" as RuntimeMode,
      tool: baseTool({ runtimePolicy: { allowedModes: ["local-stdio-mcp"] } }),
      requestedCapability: "read"
    });
    expect(decision.allowed).toBe(false);
    expect(decision.refusalReason).toBe("mode-not-allowed");
  });

  it("shell-blocked populates refusalReason", () => {
    const gate = new DefaultPermissionGate();
    const decision = gate.decide({
      runtimeMode: "local-stdio-mcp" as RuntimeMode,
      tool: baseTool({
        category: "command",
        runtimePolicy: { allowedModes: ["local-stdio-mcp"], shellAccess: true }
      }),
      requestedCapability: "exec"
    });
    expect(decision.allowed).toBe(false);
    expect(decision.refusalReason).toBe("shell-blocked");
  });

  it("role-floor populates refusalReason", () => {
    const gate = new DefaultPermissionGate();
    const decision = gate.decide({
      runtimeMode: "local-stdio-mcp" as RuntimeMode,
      tool: baseTool({ category: "write", runtimePolicy: { allowedModes: ["local-stdio-mcp"] } }),
      requestedCapability: "write",
      agentRole: "security-reviewer"
    });
    expect(decision.allowed).toBe(false);
    expect(decision.refusalReason).toBe("role-floor");
  });

  it("allowed: true decisions have no refusalReason", () => {
    const gate = new DefaultPermissionGate();
    const decision = gate.decide({
      runtimeMode: "local-stdio-mcp" as RuntimeMode,
      tool: baseTool(),
      requestedCapability: "read"
    });
    expect(decision.allowed).toBe(true);
    expect(decision.refusalReason).toBeUndefined();
  });
});
```

---

## CHANGE 9 — CREATE `packages/agentic-ai-infra-runtime/test/feedback-loops/retry-loop.test.ts`

```typescript
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

  it("returns agent.retry-blocked when code not in user allowlist", async () => {
    const op = vi.fn().mockResolvedValue(
      fail({ code: "retrieval.embedding-failed", message: "x", severity: "recoverable" })
    );
    const policy: AgentRetryPolicy = {
      maxAttempts: 3,
      retryableErrorCodes: ["llm.provider-unavailable"]  // different code
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
    expect(elapsed).toBeGreaterThanOrEqual(25);  // allow 5ms timer slack
  });
});
```

Target: 4 refusal tests + 7 retry tests = ~11 (the 7th retry test is the
backoff timing — keep all 7 if your CI tolerates the small wall-clock).

---

## CHANGE 10 — CREATE `docs/internal/learning-notes/stage-25-5-retry-and-refusal.md`

```markdown
# Stage 25.5 Phase 04 — Retry Loop + Refusal Taxonomy

## Refusal Taxonomy (Guardrails umbrella)

`PermissionDecision` gains an optional `refusalReason: RefusalReason` field
alongside the existing free-form `reason: string`. The free-form string
stays for human-readable text. The typed code is what metrics, retry
decisions, and over/under-refusal monitoring consume.

Closed enum of 8 codes; never widened without a D-number lock.

## Retry Loop (Feedback Loops umbrella)

First retry-with-backoff primitive in the framework. The LLM SmartRouter's
fallback chain is single-shot per provider; this loop retries the SAME
operation with backoff.

`AgentRetryPolicy.retryableErrorCodes` is an ALLOWLIST. Codes not listed
are never retried. Additionally, a hard-coded `NEVER_RETRY` set blocks
retry on policy denials, budget refusals, and security gates regardless
of user policy (D39 — safety floor is not opt-out).

## Why allowlist, not denylist

Defaults matter. If `retryableErrorCodes` were a denylist, omitting a code
would retry it — meaning the framework's default behavior would be
"retry everything." That's wrong for an agentic framework where retries
have cost (tokens, latency, side-effects). Allowlist makes the default
"retry nothing" and forces the user to enumerate retryable failures.

## What's NOT in this phase

- LLM-driven retry decisions ("decide whether to retry based on error semantics") — Stage 48
- Cross-run feedback (eval-driven policy tuning) — Phase 05's EvalFeedbackLoop seam, Stage 49 implementation
- Signal-threaded retry cancellation — Stage 26 / 27
- Idempotency enforcement — caller responsibility, framework does not verify
```

---

## CHANGE 11–13 — v3-architecture-snapshot.md / kb.md / STATUS.md

Same pattern as previous phases. Add rows for:
- `PermissionDecision.refusalReason` (Guardrails)
- `runWithRetry` + `AgentRetryPolicy` (Feedback Loops)

List D35–D39 in the kb entry.

---

## VERIFICATION

```bash
pnpm.cmd run ci
```

Spot checks:
```bash
pnpm.cmd --silent exec rg -n "RefusalReason" packages/agentic-ai-infra-core/src/security/types.ts
pnpm.cmd --silent exec rg -n "refusalReason" packages/agentic-ai-infra-runtime/src/harness/index.ts
pnpm.cmd --silent exec rg -n "NEVER_RETRY" packages/agentic-ai-infra-runtime/src/feedback-loops/retry-loop.ts
pnpm.cmd --silent exec rg -n "agent.retry-exhausted|agent.retry-blocked" packages/agentic-ai-infra-core/src/errors/index.ts
```

---

## SELF-REVIEW CHECKLIST

### Invariants
- [ ] D23 — `PermissionDecision.reason` field shape unchanged; `refusalReason` purely additive
- [ ] `allowed: true` branches do NOT set `refusalReason`
- [ ] D39 — `NEVER_RETRY` is exhaustive over the 7 codes; verify each spelling matches `errors/index.ts`
- [ ] Retry loop does NOT mutate harness state
- [ ] `AgentRetryPolicy` is optional on `AgentDefinition`

### Type correctness
- [ ] `RefusalReason` is a closed union of 8 strings
- [ ] `refusalReason?: RefusalReason` on `PermissionDecision` (optional)
- [ ] `AgentRetryPolicy` has 3 optional fields
- [ ] 2 new error codes added (`agent.retry-exhausted`, `agent.retry-blocked`)

### Wiring
- [ ] All 6 `DefaultPermissionGate` deny branches populate `refusalReason`
- [ ] `runWithRetry` is exported from `runtime/src/feedback-loops/index.ts`
- [ ] `runtime/src/index.ts` exports the feedback-loops barrel
- [ ] `runWithRetry` returns `agent.retry-blocked` for `NEVER_RETRY` codes regardless of policy
- [ ] `runWithRetry` returns `agent.retry-blocked` for codes not in allowlist
- [ ] `runWithRetry` returns `agent.retry-exhausted` after maxAttempts failures
- [ ] `backoffMs` is honored between attempts (loop uses `setTimeout`)

### Tests
- [ ] 4 tests in `refusal-taxonomy.test.ts`
- [ ] 7 tests in `retry-loop.test.ts`
- [ ] Total new: 11
- [ ] All previously passing tests still pass
- [ ] `pnpm.cmd run ci`: build ✓ typecheck ✓ test ✓ lint ✓

### Documentation
- [ ] Learning note created
- [ ] v3-architecture-snapshot.md updated
- [ ] kb.md Phase 04 entry
- [ ] STATUS.md updated

---

## WHAT NOT TO DO

- Do NOT remove or rename `PermissionDecision.reason` — D23
- Do NOT add `refusalReason` to the success path
- Do NOT make `refusalReason` required
- Do NOT make the retry loop part of `AgentHarness` — D37 (it's a feedback-loop primitive, not harness state)
- Do NOT add user override for `NEVER_RETRY` — D39 is non-negotiable
- Do NOT add LLM-based retry-decision logic — Stage 48
- Do NOT retry on `agent.weak-evidence` even though Phase 03 introduced it — it's a policy refusal, in NEVER_RETRY
- Do NOT add a Postgres-backed retry log — Stage 27 may
- Do NOT change `selectToolIds` or `enforceAllowedTools` (Stage 25 surface)
- Do NOT add the typed `refusalReason` to `enforceAllowedTools` rejections this phase — Stage 26 plumbs that
- Do NOT thread `AbortSignal` through retry — that's signal-bounded execution, not retry
- Do NOT change `DefaultApprovalPolicy` — only the gate's 6 branches gain typed reasons

---

## DONE SIGNAL

```
Stage 25.5 Phase 04 complete.
Test count: [N]/[N] passing.
CI: build ✓ typecheck ✓ test ✓ lint ✓
Files changed: [list]
New decisions locked: D35 (RefusalReason taxonomy), D36 (AgentRetryPolicy), D37 (retry-loop not in harness), D38 (2 error codes), D39 (NEVER_RETRY hard-coded)
Next phase: 25.5-05 — Guardrails: OutputGuard seam + Feedback Loops: CritiqueLoop + EvalFeedback seams + memoryPolicy.episodic
```
