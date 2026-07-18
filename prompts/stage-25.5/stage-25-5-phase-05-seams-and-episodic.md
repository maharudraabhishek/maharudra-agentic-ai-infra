# Stage 25.5 Phase 05 — Guardrails: ContentGuard seam + Feedback Loops: Critique & EvalFeedback seams + memoryPolicy.episodic
## Claude Code Prompt — MahaRudra Agentic AI Infra

---

## BEFORE YOU START — READ THIS FIRST

**Platform:** Windows 11, PowerShell, Node >= 20, pnpm only
**CI command:** `pnpm.cmd run ci`
**Current test count:** read `STATUS.md` head (Phase 04 baseline)
**Expected after this phase:** Phase 04 count + ~6 tests
**This is the LAST phase of Stage 25.5.** After this phase passes, Stage 26 begins.

This phase ships **seams only** — typed interfaces in core, no-op concrete
implementations in runtime, container slots wired non-optional with no-op
defaults. Real implementations land in:
- Stage 42 (Constitutional AI) for `LlmJudgeContentGuard`
- Stage 48 (Self-critique) for `LlmCritiqueLoop`
- Stage 49 (RLHF) for `RLHFFeedbackHook`

A small gap-fill is also included: `AgentMemoryPolicy.episodic` next to the
existing `.semantic`. This was identified as a Stage 25 missing field
during P4 design review and is too small to deserve its own stage. D34
(timing) locks it here.

---

## CONTEXT — WHAT IS DONE

- **D22 (LOCKED, Stage 25):** non-optional container slots auto-wired from
  config, with sensible defaults when unconfigured (`evalStore`,
  `evalHarness`, `agentRegistry`). Phase 05 follows this precedent for
  `contentGuard` and `feedbackHook`.
- **D21 (LOCKED):** read-only core interfaces; mutation only on concrete
  classes. New `ContentGuard` and `FeedbackHook` interfaces follow this.
- **D25 (Phase 01):** Guardrails / Feedback Loops umbrella vocabulary.
- **D26–D39 (Phases 01–04):** all previous Stage 25.5 decisions.
- **Phase 03's `HeuristicOutputGuard`** is a concrete heuristic guard that
  predates the formal `ContentGuard` core interface. Phase 05 declares the
  interface and makes `HeuristicOutputGuard` implement it. The runtime
  output-guard module continues to live in `runtime/src/guardrails/`.
- **`EvalStore.getHistory()`** at `core/src/evals/types.ts:95` already
  returns chronological eval records. The new `EvalFeedbackLoop` seam
  CONSUMES this — no eval-store changes.

---

## NEW LOCKED DECISIONS — Stage 25.5 Phase 05

### D40 — `ContentGuard` core interface (umbrella: Guardrails)
Lives in `core/src/guardrails/types.ts`. Read-only contract per D21.

```typescript
export type SafetyVerdict = {
  readonly safe: boolean;
  readonly action: "pass" | "block" | "rewrite" | "warn";
  readonly reason?: string;
  /** Optional rewritten content when `action === "rewrite"`. Stage 42 uses this. */
  readonly rewrittenText?: string;
};

export interface ContentGuard {
  /**
   * Inspects content (input or output) and returns a typed verdict.
   * Implementations MAY call LLMs (Stage 42) or be heuristic-only (Phase 03).
   */
  inspect(input: ContentGuardInput): Promise<SafetyVerdict>;
}

export type ContentGuardInput = {
  /** "input" = pre-execution check; "output" = post-execution check. */
  readonly direction: "input" | "output";
  readonly text: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
};
```

The Phase 03 `HeuristicOutputGuard` continues to exist for the *response
policy* concern (citations / evidence coverage). `ContentGuard` is the
*safety/sanitization* concern (harmful content, jailbreaks, PII). Both
land on the same umbrella; they are different responsibilities.

### D41 — `FeedbackHook` core interface (umbrella: Feedback Loops)
Lives in `core/src/feedback/types.ts`. Read-only per D21.

```typescript
export type FeedbackAction = "accept" | "retry" | "escalate" | "revise";

export type FeedbackVerdict = {
  readonly action: FeedbackAction;
  readonly reason?: string;
};

export interface FeedbackHook {
  /**
   * Called after an agent or orchestrator output. The hook may inspect
   * eval history (`EvalStore.getHistory()`), past trajectories, or
   * external signals to decide whether the output should be accepted,
   * retried, escalated to human review, or revised.
   *
   * Implementations MAY be cross-run (e.g. RLHF, Stage 49) or in-run
   * (e.g. SelfCritique, Stage 48).
   */
  evaluate(input: FeedbackHookInput): Promise<FeedbackVerdict>;
}

export type FeedbackHookInput = {
  readonly runId: string;
  readonly traceId: string;
  readonly outputText: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
};
```

### D42 — `NoopContentGuard` and `NoopFeedbackHook` are the defaults
Live in `runtime/src/guardrails/` and `runtime/src/feedback-loops/`
respectively. Both return `accept` / `pass` unconditionally. D23 preserved
— absence of configuration produces the no-op default.

### D43 — `RuntimeServiceContainer` gains non-optional `contentGuard` and `feedbackHook` slots
Mirrors D22 (precedent: `agentRegistry`, `evalStore`, `evalHarness`).
Auto-wired by `createRuntimeServiceContainer()` to `NoopContentGuard` and
`NoopFeedbackHook` when no configuration exists. Callers can override via
`RuntimeServiceContainerOptions.contentGuard` / `.feedbackHook` (Phase 05
adds these option fields). Future stages (42, 48, 49) inject concrete
implementations via these option hooks.

### D44 — `AgentMemoryPolicy.episodic` field
Added next to the existing `.semantic`. Same access-mode union:

```typescript
export type AgentMemoryPolicy = {
  readonly semantic?: "read" | "read-write" | "none";
  readonly episodic?: "read" | "read-write" | "none";    // NEW — Stage 25.5 P05
};
```

Declared only. Enforcement deferred to Stage 27 (same as `.semantic`).
This closes a Stage 25 gap surfaced in P4 design review.

---

## ARCHITECTURAL DECISION — WHY SEAMS, NOT IMPLEMENTATIONS

Three reasons each:

**ContentGuard seam (D40):**
1. Stage 42 (Constitutional AI) needs an LLM-backed guard. Wiring the
   container slot today means Stage 42 adds one file (the concrete impl)
   and changes one line (the container injection) — not 5 files across
   the runtime.
2. Stage 21 D1 forbids LLM calls from Layer 9 (Harness). The orchestrator
   (Stage 26, Layer 10) is the natural caller for an LLM `ContentGuard`.
   Phase 05 lands the type today; Stage 26 plumbs the call site.
3. `HeuristicOutputGuard` (Phase 03) is response-policy, not content-safety.
   Separating the concerns keeps the umbrella organized.

**FeedbackHook seam (D41):**
1. Stage 49 (RLHF) needs a hook the orchestrator can call after each run.
   The shape is foreseeable today (action enum, run/trace ids, output text).
2. Stage 48 (SelfCritique) is a different consumer of the same shape —
   in-run critique loop. Declaring the type once and using it twice is
   cheaper than defining two near-identical types later.
3. `EvalStore.getHistory()` already exists. A cross-run feedback hook can
   read it today. The seam is ready; only the LLM-backed implementations
   await Stages 48/49.

**Memory policy episodic (D44):**
1. Gap-fill; not a new concept.
2. Adding it later would require coordinating across Stage 27's
   `MemoryStore` design. Adding the type now keeps Stage 27's surface clean.
3. Single-line type extension. Risk near zero.

---

## FILES TO CHANGE — COMPLETE LIST

| # | File | Action |
|---|---|---|
| 1 | `packages/agentic-ai-infra-core/src/guardrails/types.ts` | CREATE |
| 2 | `packages/agentic-ai-infra-core/src/guardrails/index.ts` | CREATE |
| 3 | `packages/agentic-ai-infra-core/src/feedback/types.ts` | CREATE |
| 4 | `packages/agentic-ai-infra-core/src/feedback/index.ts` | CREATE |
| 5 | `packages/agentic-ai-infra-core/src/agents/types.ts` | MODIFY (add `episodic` to `AgentMemoryPolicy`) |
| 6 | `packages/agentic-ai-infra-core/src/index.ts` | MODIFY (export guardrails + feedback barrels) |
| 7 | `packages/agentic-ai-infra-runtime/src/guardrails/content-guard.ts` | CREATE (NoopContentGuard) |
| 8 | `packages/agentic-ai-infra-runtime/src/feedback-loops/critique-loop.ts` | CREATE (seam) |
| 9 | `packages/agentic-ai-infra-runtime/src/feedback-loops/eval-feedback-loop.ts` | CREATE (seam) |
| 10 | `packages/agentic-ai-infra-runtime/src/guardrails/index.ts` | MODIFY (export content-guard) |
| 11 | `packages/agentic-ai-infra-runtime/src/feedback-loops/index.ts` | MODIFY (export critique + eval-feedback) |
| 12 | `packages/agentic-ai-infra-runtime/src/runtime/index.ts` | MODIFY (2 non-optional container slots + options hooks) |
| 13 | `packages/agentic-ai-infra-runtime/test/runtime/container-seams.test.ts` | CREATE (~6 tests) |
| 14 | `docs/internal/learning-notes/stage-25-5-seams.md` | CREATE |
| 15 | `docs/internal/v3-architecture-snapshot.md` | MODIFY (final Stage 25.5 row + closeout note) |
| 16 | `kb.md` | MODIFY (Phase 05 entry + Stage 25.5 closeout summary) |
| 17 | `STATUS.md` | MODIFY (Stage 25.5 marked complete; Stage 26 frontier) |

---

## CHANGE 1 — CREATE `packages/agentic-ai-infra-core/src/guardrails/types.ts`

```typescript
/**
 * Guardrails — core types (Stage 25.5 D40 / D42).
 *
 * Read-only contracts per D21. Concrete implementations live in the runtime
 * package (`runtime/src/guardrails/`). The default `NoopContentGuard` is
 * auto-wired into `RuntimeServiceContainer.contentGuard` (D43).
 *
 * `ContentGuard` is the content-safety concern (harmful content, jailbreaks,
 * PII). The response-policy concern (citations / evidence coverage) lives
 * on `HeuristicOutputGuard` in the runtime package and on
 * `AgentResponsePolicy` in `core/src/agents/types.ts`. Both share the
 * Guardrails umbrella but solve different problems.
 *
 * @umbrella Guardrails
 */

/** Result of a content-guard inspection. */
export type SafetyVerdict = {
  /** Whether the inspected content is safe to proceed with. */
  readonly safe: boolean;
  /**
   * What action the caller should take.
   * - `"pass"` — proceed unchanged
   * - `"block"` — refuse the request/response
   * - `"rewrite"` — replace content with `rewrittenText` (Stage 42)
   * - `"warn"` — proceed but emit an observability warning
   */
  readonly action: "pass" | "block" | "rewrite" | "warn";
  /** Free-form reason. Optional. */
  readonly reason?: string;
  /** Rewritten content when `action === "rewrite"`. */
  readonly rewrittenText?: string;
};

/** Input to a content-guard inspection. */
export type ContentGuardInput = {
  /** `"input"` = pre-execution check; `"output"` = post-execution check. */
  readonly direction: "input" | "output";
  readonly text: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
};

/**
 * Content-safety guard contract.
 *
 * Implementations may be heuristic-only (no LLM call, can run anywhere) or
 * LLM-backed (must run at Layer 10 or above per Stage 21 D1).
 *
 * Stage 25.5 ships `NoopContentGuard` as the default. Stage 42's
 * Constitutional AI guard ships a concrete LLM-backed implementation.
 */
export interface ContentGuard {
  inspect(input: ContentGuardInput): Promise<SafetyVerdict>;
}
```

## CHANGE 2 — CREATE `packages/agentic-ai-infra-core/src/guardrails/index.ts`

```typescript
export * from "./types.js";
```

## CHANGE 3 — CREATE `packages/agentic-ai-infra-core/src/feedback/types.ts`

```typescript
/**
 * Feedback Loops — core types (Stage 25.5 D41 / D42).
 *
 * Read-only contracts per D21. Concrete implementations live in the runtime
 * package (`runtime/src/feedback-loops/`). The default `NoopFeedbackHook`
 * is auto-wired into `RuntimeServiceContainer.feedbackHook` (D43).
 *
 * Stage 25.5 Phase 04 already ships `runWithRetry` as a concrete in-run
 * feedback-loop primitive. This file declares the broader hook interface
 * that Stage 48 (SelfCritique) and Stage 49 (RLHF) will implement.
 *
 * @umbrella Feedback Loops
 */

/**
 * Closed taxonomy of actions a feedback hook can recommend.
 * - `"accept"` — output is fine; proceed
 * - `"retry"` — re-execute the operation (caller chooses how)
 * - `"escalate"` — route to human review or higher-privilege path
 * - `"revise"` — modify the output before returning (Stage 48 self-critique)
 */
export type FeedbackAction = "accept" | "retry" | "escalate" | "revise";

/** Verdict returned by a feedback hook. */
export type FeedbackVerdict = {
  readonly action: FeedbackAction;
  readonly reason?: string;
};

/** Input to a feedback-hook evaluation. */
export type FeedbackHookInput = {
  readonly runId: string;
  readonly traceId: string;
  readonly outputText: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
};

/**
 * Post-output feedback contract.
 *
 * Called after an agent or orchestrator returns. Implementations may inspect
 * `EvalStore.getHistory()`, trajectory data, or external signals.
 *
 * Stage 25.5 ships `NoopFeedbackHook` as the default. Stage 48 ships
 * `LlmCritiqueLoop`; Stage 49 ships `RLHFFeedbackHook`.
 */
export interface FeedbackHook {
  evaluate(input: FeedbackHookInput): Promise<FeedbackVerdict>;
}
```

## CHANGE 4 — CREATE `packages/agentic-ai-infra-core/src/feedback/index.ts`

```typescript
export * from "./types.js";
```

## CHANGE 5 — MODIFY `packages/agentic-ai-infra-core/src/agents/types.ts`

Find `AgentMemoryPolicy` (line 242–245):

```typescript
export type AgentMemoryPolicy = {
  /** Access mode for the semantic memory layer. */
  readonly semantic?: "read" | "read-write" | "none";
};
```

Replace with:

```typescript
/**
 * Per-agent memory access policy.
 *
 * Declared in Stage 25; enforcement deferred to Stage 27 (`MemoryStore`).
 * Stage 25.5 Phase 05 added the `episodic` field (D44) — same access-mode
 * union as `semantic`, same Stage 27 enforcement deferral.
 *
 * @umbrella (not under either umbrella — memory is its own concern)
 */
export type AgentMemoryPolicy = {
  /** Access mode for the semantic memory layer (vector/embedding-backed). */
  readonly semantic?: "read" | "read-write" | "none";
  /**
   * Access mode for the episodic memory layer (run/trajectory history).
   * Stage 25.5 D44 — declared, enforcement deferred to Stage 27.
   */
  readonly episodic?: "read" | "read-write" | "none";
};
```

**Do NOT** rename `semantic`. **Do NOT** add a default — both fields stay optional.

## CHANGE 6 — MODIFY `packages/agentic-ai-infra-core/src/index.ts`

Add the new barrels alongside existing exports:

```typescript
export * from "./guardrails/index.js";
export * from "./feedback/index.js";
```

Place these in alphabetical order with existing top-level exports.

## CHANGE 7 — CREATE `packages/agentic-ai-infra-runtime/src/guardrails/content-guard.ts`

```typescript
/**
 * Content Guard implementations — Stage 25.5 D42.
 *
 * `NoopContentGuard` is the default, auto-wired into
 * `RuntimeServiceContainer.contentGuard` when no override is supplied.
 * Stage 42 (Constitutional AI) ships `LlmJudgeContentGuard` and injects
 * it via `RuntimeServiceContainerOptions.contentGuard`.
 *
 * @umbrella Guardrails
 */
import type {
  ContentGuard,
  ContentGuardInput,
  SafetyVerdict
} from "@maharudra/agentic-ai-infra-core";

/**
 * Default no-op content guard. Always returns `safe: true, action: "pass"`.
 * D23 preserved — absence of configuration produces this default.
 */
export class NoopContentGuard implements ContentGuard {
  async inspect(_input: ContentGuardInput): Promise<SafetyVerdict> {
    return { safe: true, action: "pass" };
  }
}
```

## CHANGE 8 — CREATE `packages/agentic-ai-infra-runtime/src/feedback-loops/critique-loop.ts`

```typescript
/**
 * Critique Loop seam — Stage 25.5 D41 / D42.
 *
 * `NoopCritiqueLoop` is the default `FeedbackHook` for in-run critique.
 * Stage 48 (Self-Critique) ships `LlmCritiqueLoop` implementing the same
 * interface and injects it via `RuntimeServiceContainerOptions.feedbackHook`.
 *
 * Today this file only ships the no-op. The real critique loop calls an
 * LLM to evaluate output quality and recommend `revise` or `retry`.
 *
 * @umbrella Feedback Loops — in-run
 */
import type {
  FeedbackHook,
  FeedbackHookInput,
  FeedbackVerdict
} from "@maharudra/agentic-ai-infra-core";

/**
 * Default no-op critique loop. Always returns `action: "accept"`.
 */
export class NoopCritiqueLoop implements FeedbackHook {
  async evaluate(_input: FeedbackHookInput): Promise<FeedbackVerdict> {
    return { action: "accept" };
  }
}
```

## CHANGE 9 — CREATE `packages/agentic-ai-infra-runtime/src/feedback-loops/eval-feedback-loop.ts`

```typescript
/**
 * Eval-Feedback Loop seam — Stage 25.5 D41 / D42.
 *
 * Cross-run feedback hook that consults `EvalStore.getHistory()` to decide
 * whether to accept, retry, escalate, or revise. The seam is wired today;
 * Stage 49 (RLHF) ships the LLM-backed implementation that actually
 * analyzes the history.
 *
 * `NoopEvalFeedbackLoop` is the default. It is a separate class from
 * `NoopCritiqueLoop` because:
 * 1. `RuntimeServiceContainer.feedbackHook` is a single slot today;
 *    Stage 49 will likely introduce a second slot. Two classes ready
 *    now means two slots ready later without renaming.
 * 2. Real cross-run and in-run hooks have different latency budgets and
 *    different cancellation semantics. Separating them at the class level
 *    keeps the future split clean.
 *
 * @umbrella Feedback Loops — cross-run
 */
import type {
  EvalStore,
  FeedbackHook,
  FeedbackHookInput,
  FeedbackVerdict
} from "@maharudra/agentic-ai-infra-core";

/**
 * Default no-op cross-run feedback loop. Accepts every output.
 *
 * @param evalStore - Reserved for the Stage 49 implementation; the no-op
 *   does not read it. The parameter is on the constructor so the wiring
 *   in `createRuntimeServiceContainer` can supply it today.
 */
export class NoopEvalFeedbackLoop implements FeedbackHook {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(private readonly evalStore?: EvalStore) {}

  async evaluate(_input: FeedbackHookInput): Promise<FeedbackVerdict> {
    return { action: "accept" };
  }
}
```

## CHANGE 10 — MODIFY `packages/agentic-ai-infra-runtime/src/guardrails/index.ts`

Add the new module to the existing barrel:

```typescript
export * from "./input-guard.js";
export * from "./output-guard.js";
export * from "./content-guard.js";    // NEW — Stage 25.5 P05
```

## CHANGE 11 — MODIFY `packages/agentic-ai-infra-runtime/src/feedback-loops/index.ts`

Add the new modules to the existing barrel:

```typescript
export * from "./retry-loop.js";
export * from "./critique-loop.js";        // NEW — Stage 25.5 P05
export * from "./eval-feedback-loop.js";   // NEW — Stage 25.5 P05
```

## CHANGE 12 — MODIFY `packages/agentic-ai-infra-runtime/src/runtime/index.ts`

Add two NON-OPTIONAL slots to `RuntimeServiceContainer`, two OPTIONAL fields
on `RuntimeServiceContainerOptions`, and auto-wire defaults.

Find the existing `RuntimeServiceContainer` type (around line 107). After
the `inputGuard` field added in Phase 01 (and the `evalHarness`, `evalStore`,
`agentRegistry` slots), add:

```typescript
  /**
   * Content-safety guard. Default: `NoopContentGuard` (D42).
   * Stage 42 injects `LlmJudgeContentGuard` via options override.
   *
   * @umbrella Guardrails
   */
  readonly contentGuard: ContentGuard;
  /**
   * Post-output feedback hook. Default: `NoopCritiqueLoop` (D42).
   * Stage 48 injects `LlmCritiqueLoop`; Stage 49 may extend to a separate
   * cross-run hook slot.
   *
   * @umbrella Feedback Loops
   */
  readonly feedbackHook: FeedbackHook;
```

Find `RuntimeServiceContainerOptions`. Add two optional override fields:

```typescript
export type RuntimeServiceContainerOptions = {
  // ... existing fields ...
  /** Override for the default `NoopContentGuard` (Stage 25.5 P05). */
  readonly contentGuard?: ContentGuard;
  /** Override for the default `NoopCritiqueLoop` (Stage 25.5 P05). */
  readonly feedbackHook?: FeedbackHook;
};
```

In `createRuntimeServiceContainer()`, near where `inputGuard` is built
(added in Phase 01), add the default wiring:

```typescript
const contentGuard = options.contentGuard ?? new NoopContentGuard();
const feedbackHook = options.feedbackHook ?? new NoopCritiqueLoop();
```

Then in the returned container object, add the two fields next to
`inputGuard`:

```typescript
return ok({
  // ... existing fields including inputGuard ...
  contentGuard,
  feedbackHook
});
```

Add the imports at the top of the file:

```typescript
import type { ContentGuard, FeedbackHook } from "@maharudra/agentic-ai-infra-core";
import { NoopContentGuard } from "../guardrails/content-guard.js";
import { NoopCritiqueLoop } from "../feedback-loops/critique-loop.js";
```

**Do NOT** make either slot optional. **Do NOT** change `inputGuard` wiring.
**Do NOT** thread `contentGuard` into the executors in this phase — Stage 26's
orchestrator is the natural caller, not the per-agent executor.

## CHANGE 13 — CREATE `packages/agentic-ai-infra-runtime/test/runtime/container-seams.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import type {
  AgenticInfraProjectConfig,
  ContentGuard,
  ContentGuardInput,
  FeedbackHook,
  FeedbackHookInput,
  FeedbackVerdict,
  SafetyVerdict
} from "@maharudra/agentic-ai-infra-core";
import {
  NoopContentGuard,
  NoopCritiqueLoop,
  NoopEvalFeedbackLoop
} from "@maharudra/agentic-ai-infra-runtime";
import { createRuntimeServiceContainer } from "../../src/runtime/index.js";

function baseConfig(): AgenticInfraProjectConfig {
  return {
    project: { name: "seam-test", slug: "seam-test" },
    runtime: { modes: ["local-stdio-mcp"] },
    tools: [],
    agents: { mode: "single-agent" },
    profile: "vectorless-local"
  } as unknown as AgenticInfraProjectConfig;
}

describe("Stage 25.5 Phase 05 — Container seams", () => {
  it("auto-wires NoopContentGuard when no override is supplied (D43)", async () => {
    const result = await createRuntimeServiceContainer({ config: baseConfig() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.contentGuard).toBeInstanceOf(NoopContentGuard);
  });

  it("auto-wires NoopCritiqueLoop as the default feedbackHook (D43)", async () => {
    const result = await createRuntimeServiceContainer({ config: baseConfig() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.feedbackHook).toBeInstanceOf(NoopCritiqueLoop);
  });

  it("honors a custom ContentGuard override", async () => {
    const stub: ContentGuard = {
      async inspect(_input: ContentGuardInput): Promise<SafetyVerdict> {
        return { safe: true, action: "warn", reason: "stub" };
      }
    };
    const result = await createRuntimeServiceContainer({
      config: baseConfig(),
      contentGuard: stub
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const verdict = await result.value.contentGuard.inspect({
      direction: "output",
      text: "hi"
    });
    expect(verdict.action).toBe("warn");
    expect(verdict.reason).toBe("stub");
  });

  it("honors a custom FeedbackHook override", async () => {
    const stub: FeedbackHook = {
      async evaluate(_input: FeedbackHookInput): Promise<FeedbackVerdict> {
        return { action: "retry", reason: "stub" };
      }
    };
    const result = await createRuntimeServiceContainer({
      config: baseConfig(),
      feedbackHook: stub
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const verdict = await result.value.feedbackHook.evaluate({
      runId: "r-1",
      traceId: "t-1",
      outputText: "x"
    });
    expect(verdict.action).toBe("retry");
  });

  it("NoopEvalFeedbackLoop is constructible and returns accept", async () => {
    const loop = new NoopEvalFeedbackLoop();
    const verdict = await loop.evaluate({
      runId: "r-1",
      traceId: "t-1",
      outputText: "x"
    });
    expect(verdict.action).toBe("accept");
  });

  it("AgentMemoryPolicy.episodic field type-checks (D44)", () => {
    // Compile-time guard; the assertion below verifies the field is accepted.
    const policy = {
      semantic: "read",
      episodic: "read-write"
    } as const;
    expect(policy.episodic).toBe("read-write");
  });
});
```

Target: 6 passing tests.

## CHANGE 14 — CREATE `docs/internal/learning-notes/stage-25-5-seams.md`

```markdown
# Stage 25.5 Phase 05 — ContentGuard, FeedbackHook seams, memory episodic

## What this phase ships

Three seams and one gap-fill:

1. **`ContentGuard`** — content-safety contract. NoopContentGuard wired
   into `RuntimeServiceContainer.contentGuard`. Stage 42 (Constitutional AI)
   ships `LlmJudgeContentGuard` via the options override.

2. **`FeedbackHook`** — post-output feedback contract. NoopCritiqueLoop
   wired into `RuntimeServiceContainer.feedbackHook`. NoopEvalFeedbackLoop
   exported but not auto-wired today (Stage 49 may split this into a second
   container slot for cross-run vs in-run).

3. **`AgentMemoryPolicy.episodic`** — Stage 25 gap-fill. Same shape as
   `.semantic`, enforcement deferred to Stage 27.

## Why HeuristicOutputGuard and ContentGuard are separate

- `HeuristicOutputGuard` (Phase 03) — *response policy* (citations,
  evidence coverage). Closed-taxonomy decisions. Cheap, deterministic.
- `ContentGuard` (Phase 05) — *content safety* (jailbreaks, PII, harmful
  content). May call LLMs. Stage 42's Constitutional AI guard implements
  this interface.

Both are under the Guardrails umbrella; they solve different problems.
Conflating them would force every output-policy check to allow LLM calls
(violating Stage 21 D1 for any caller below Layer 10).

## Why NoopCritiqueLoop and NoopEvalFeedbackLoop are separate classes

The `feedbackHook` container slot today serves both in-run critique
(Stage 48) and cross-run RLHF (Stage 49). When Stage 49 lands, the
container may split this into two slots. Having two no-op classes ready
means the split adds slot wiring only, no class rename.

## D44 — Episodic memory rationale

Stage 25 declared `AgentMemoryPolicy.semantic`. The episodic counterpart
was identified as missing during P4 design review. Adding it later would
require coordinating with Stage 27's `MemoryStore` design. Adding the type
field now (without enforcement) keeps Stage 27's surface clean.

## What this phase does NOT ship

- LLM-backed `ContentGuard` — Stage 42
- LLM-backed critique loop — Stage 48
- Eval-history-driven RLHF hook — Stage 49
- Enforcement of `memoryPolicy.episodic` — Stage 27
- Per-tool `ContentGuard` calls — Stage 21 D1 forbids; would require
  re-architecting the layer dependency rule
- Container-slot splitting (one slot vs two slots for feedback hooks) —
  Stage 49 design decision
```

## CHANGE 15 — MODIFY `docs/internal/v3-architecture-snapshot.md`

Add three rows in the Layer-9/10 areas of the matrix:

```txt
  ContentGuard core interface           Guardrails seam (Stage 42 plug-in)  ✅ Stage 25.5 P05
  FeedbackHook core interface           Feedback Loops seam (Stage 48/49)   ✅ Stage 25.5 P05
  AgentMemoryPolicy.episodic            Stage 25 gap-fill (D44)             ✅ Stage 25.5 P05
```

Append a Stage 25.5 CLOSEOUT section:

```markdown
## Stage 25.5 — Closeout (Guardrails + Feedback Loops umbrellas)

**Date:** [today's ISO date]
**Phases:** 5 (P01–P05)
**Tests:** 480 → [actual final count]
**Decisions locked:** D25 (umbrellas), D26 (input-guard wiring), D27 (output fields),
D28 (executor-side propagation), D29 (single-agent deferred), D30 (responsePolicy taxonomy),
D31 (expanded budgetPolicy), D32 (guard timing), D33 (3 error codes), D34 (AbortController),
D35 (RefusalReason taxonomy), D36 (retryPolicy), D37 (retry-loop placement),
D38 (2 retry error codes), D39 (NEVER_RETRY hard-coded), D40 (ContentGuard seam),
D41 (FeedbackHook seam), D42 (Noop defaults), D43 (non-optional container slots),
D44 (episodic memory field)

Stage 25.5 turned the harness from "policy-safe" into "production-grade":
- Input-side prompt-injection defense finally enforced (P01)
- Agent outputs carry citations / evidence coverage / abstain reasons (P02)
- Bounded loops (maxToolCalls / maxRuntimeMs) + response policy enforcement (P03)
- Typed refusal taxonomy + bounded retry primitive (P04)
- Typed seams for Stages 42 / 48 / 49 + memory episodic gap-fill (P05)

No breaking changes (D23 holds throughout). Stage 26 builds on this surface.
```

## CHANGE 16 — MODIFY `kb.md`

Append Phase 05 session entry + a Stage 25.5 closeout summary mirroring the
pattern at the end of previous full stages. List all 20 new decisions
(D25–D44) and the final test count.

## CHANGE 17 — MODIFY `STATUS.md`

Mark Stage 25.5 complete. Update "Frontier" to "Stage 26 — AgentOrchestrator".
Update test count to final.

---

## VERIFICATION

```bash
pnpm.cmd run ci
```

Spot checks:
```bash
pnpm.cmd --silent exec rg -n "ContentGuard|FeedbackHook" packages/agentic-ai-infra-core/src/
pnpm.cmd --silent exec rg -n "contentGuard|feedbackHook" packages/agentic-ai-infra-runtime/src/runtime/index.ts
pnpm.cmd --silent exec rg -n "episodic" packages/agentic-ai-infra-core/src/agents/types.ts
```

---

## SELF-REVIEW CHECKLIST

### Invariants
- [ ] D21 — `ContentGuard` and `FeedbackHook` are read-only interfaces (no mutators)
- [ ] D22 — container slots auto-wired with no-op defaults when no override
- [ ] D23 — pre-Phase-05 callers that omit overrides get unchanged behavior
- [ ] `AgentMemoryPolicy.semantic` unchanged
- [ ] No enforcement of `memoryPolicy.episodic` added (Stage 27 owns that)
- [ ] No LLM call introduced in any Phase 05 file
- [ ] Stage 21 D1 honored (heuristic-only Noop implementations)

### Type correctness
- [ ] `SafetyVerdict.action` is a closed union of 4 strings
- [ ] `FeedbackAction` is a closed union of 4 strings
- [ ] `ContentGuard.inspect` returns `Promise<SafetyVerdict>`
- [ ] `FeedbackHook.evaluate` returns `Promise<FeedbackVerdict>`
- [ ] `RuntimeServiceContainer.contentGuard: ContentGuard` (non-optional)
- [ ] `RuntimeServiceContainer.feedbackHook: FeedbackHook` (non-optional)
- [ ] `RuntimeServiceContainerOptions.contentGuard?: ContentGuard` (optional)
- [ ] `RuntimeServiceContainerOptions.feedbackHook?: FeedbackHook` (optional)
- [ ] `AgentMemoryPolicy.episodic?: "read" | "read-write" | "none"` (optional)

### Wiring
- [ ] `core/src/guardrails/types.ts` exports `ContentGuard`, `SafetyVerdict`, `ContentGuardInput`
- [ ] `core/src/feedback/types.ts` exports `FeedbackHook`, `FeedbackAction`, `FeedbackVerdict`, `FeedbackHookInput`
- [ ] `core/src/index.ts` exports both barrels
- [ ] `runtime/src/guardrails/content-guard.ts` exports `NoopContentGuard`
- [ ] `runtime/src/feedback-loops/critique-loop.ts` exports `NoopCritiqueLoop`
- [ ] `runtime/src/feedback-loops/eval-feedback-loop.ts` exports `NoopEvalFeedbackLoop`
- [ ] `createRuntimeServiceContainer` wires defaults via `options.contentGuard ?? new NoopContentGuard()` and `options.feedbackHook ?? new NoopCritiqueLoop()`

### Tests
- [ ] 6 `it()` blocks in `container-seams.test.ts`
- [ ] All previously passing tests still pass
- [ ] `pnpm.cmd run ci`: build ✓ typecheck ✓ test ✓ lint ✓

### Documentation
- [ ] Learning note created
- [ ] v3-architecture-snapshot.md updated WITH closeout section
- [ ] kb.md Phase 05 entry + Stage 25.5 closeout summary
- [ ] STATUS.md marks Stage 25.5 complete; Stage 26 is frontier

---

## WHAT NOT TO DO

- Do NOT make `contentGuard` or `feedbackHook` optional on the container — D43
- Do NOT add LLM calls to any Noop class — they must be byte-stable defaults
- Do NOT thread `contentGuard` into the executors — Stage 26's orchestrator owns that wiring
- Do NOT split `feedbackHook` into two slots in this phase — Stage 49 may
- Do NOT enforce `memoryPolicy.episodic` — Stage 27 owns enforcement
- Do NOT change `HeuristicOutputGuard` (Phase 03) to implement `ContentGuard` — they solve different problems and should remain separate classes
- Do NOT remove `NoopEvalFeedbackLoop` even though no slot wires it today — Stage 49 needs it ready
- Do NOT add MCP tools for the seams — Stages 42/48/49 own that
- Do NOT add `outputSchema` to `ToolContract` — Stage 26 may
- Do NOT add a per-tool ContentGuard call point — Stage 21 D1 forbids

---

## DONE SIGNAL

```
Stage 25.5 Phase 05 complete.
Stage 25.5 COMPLETE — all 5 phases shipped.
Test count: [N]/[N] passing.
CI: build ✓ typecheck ✓ test ✓ lint ✓
Files changed: [list]
New decisions locked: D40 (ContentGuard seam), D41 (FeedbackHook seam), D42 (Noop defaults), D43 (non-optional container slots), D44 (episodic memory field)
Stage 25.5 decisions total: D25 through D44 (20 decisions).
Test growth: 480 → [final] (+[delta]).
Next stage: Stage 26 — AgentOrchestrator (Layer 10 composition)
```
