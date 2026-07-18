# Stage 26 — Phase 03 — AgentOrchestrator class (single-agent composition only)

ONE phase, ONE session. Build the orchestrator class but ONLY the `composition: "single"`
path end-to-end. Multi-agent + retry + per-orchestrator response guard are Phase 05.

---

## BEFORE YOU START — read these from source

1. `packages/agentic-ai-infra-runtime/src/agents/index.ts`:
   - `SingleAgentExecutor` — constructor `constructor(private readonly options: ExecutorOptions)`
     (line ~370); `async execute(input: SingleAgentExecutorInput): Promise<FrameworkResult<SingleAgentRunReport>>`
     (line ~407).
   - `ExecutorOptions` (line ~127) — `{ config, trajectoryRecorder?, tokenRecorder?,
     sessionManager?, sessionId?, observability?, evalStore?, agentRegistry? }`.
   - `SingleAgentExecutorInput` — `{ task, includeContext?, contextPackage?, tools? }`.
   - `classifyTask(task: string): SafeTaskMetadata` — the helper that produces safe metadata.
     Confirm its exact name/signature; the orchestrator uses it to fill `report.task`.
2. `packages/agentic-ai-infra-core/src/orchestrator/types.ts` (Phase 01) — `SupervisorPolicy`,
   `SupervisorRoutePlan`.
3. `packages/agentic-ai-infra-runtime/src/orchestrator/types.ts` (Phase 02) —
   `OrchestratorReport`, `OrchestratorSubRun`.
4. `packages/agentic-ai-infra-core/src/guardrails/types.ts` — `ContentGuard.inspect(input):
   Promise<SafetyVerdict>`; `ContentGuardInput { direction, text, metadata? }`.
5. `packages/agentic-ai-infra-core/src/feedback/types.ts` — `FeedbackHook.evaluate(input):
   Promise<FeedbackVerdict>`; `FeedbackHookInput { runId, traceId, outputText, metadata? }`.
   **Both seam methods are ASYNC — so `AgentOrchestrator.run()` MUST be async.**
6. `packages/agentic-ai-infra-runtime/src/guardrails/content-guard.ts` — `NoopContentGuard`.
7. `packages/agentic-ai-infra-runtime/src/feedback-loops/critique-loop.ts` — `NoopCritiqueLoop`.
8. `packages/agentic-ai-infra-core/src/errors/index.ts` — `ok` / `fail` / `FrameworkResult`.
   The orchestrator returns `Promise<FrameworkResult<OrchestratorReport>>`.
9. How `runId` / `traceId` are generated in the executors today — grep `randomUUID` or the
   id-generation util in `runtime/src/agents/index.ts`. Reuse the SAME generator; do not
   introduce a new one.

---

## LOCKED DECISIONS THIS PHASE HONORS

- **SRP**: `AgentOrchestrator` only **composes**. It owns no state beyond the current run's
  report. `SupervisorPolicy`, `SingleAgentExecutor`, `ContentGuard`, `FeedbackHook` are all
  **constructor-injected dependencies** (dependency inversion).
- **Q1 (resolved)**: `SupervisorPolicy` is supplied at **construction only**, not per-call.
  Follows the `ExecutorOptions` pattern.
- **Q3 (resolved)**: orchestrator generates a fresh `runId`; `traceId` is propagated from the
  call input when provided, else generated. Same pattern as executors.
- **Stage 21 D1**: the orchestrator LIVES at Layer 10 composition and IS permitted to hold a
  SmartRouter reference for later phases — but in THIS phase it makes no LLM/router call. The
  single path is: route → run single executor → inspect (noop) → evaluate (noop) → report.
- **D23**: additive only. 537 baseline tests pass byte-for-byte.

---

## FILES TO CHANGE

### NEW — `packages/agentic-ai-infra-runtime/src/orchestrator/agent-orchestrator.ts`

Constructor takes an options object (mirror `ExecutorOptions` ergonomics — single object, not
positional params):

```typescript
import {
  ok,
  fail,
  type AgentDefinitionRegistry,
  type ContentGuard,
  type ContextPackage,
  type FeedbackHook,
  type FrameworkResult,
  type SupervisorPolicy,
  type ToolContract
} from "@maharudra/agentic-ai-infra-core";
import { SingleAgentExecutor, classifyTask, type ExecutorOptions } from "../agents/index.js";
import { NoopContentGuard } from "../guardrails/content-guard.js";
import { NoopCritiqueLoop } from "../feedback-loops/critique-loop.js";
import type { OrchestratorReport, OrchestratorSubRun } from "./types.js";

/** Construction options for the orchestrator. Mirrors ExecutorOptions ergonomics. */
export type AgentOrchestratorOptions = {
  /** Routing policy. Supplied at construction (Q1). */
  readonly supervisorPolicy: SupervisorPolicy;
  /** The single-agent executor the orchestrator wraps. */
  readonly singleAgentExecutor: SingleAgentExecutor;
  /** Content guard. Defaults to NoopContentGuard (D42). */
  readonly contentGuard?: ContentGuard;
  /** Feedback hook. Defaults to NoopCritiqueLoop (D42). */
  readonly feedbackHook?: FeedbackHook;
};

/** Input to a single orchestrator run. */
export type OrchestratorRunInput = {
  readonly task: string;
  readonly traceId?: string;
  readonly contextPackage?: ContextPackage;
  readonly tools?: readonly ToolContract[];
};

export class AgentOrchestrator {
  private readonly supervisorPolicy: SupervisorPolicy;
  private readonly singleAgentExecutor: SingleAgentExecutor;
  private readonly contentGuard: ContentGuard;
  private readonly feedbackHook: FeedbackHook;

  constructor(options: AgentOrchestratorOptions) {
    this.supervisorPolicy = options.supervisorPolicy;
    this.singleAgentExecutor = options.singleAgentExecutor;
    this.contentGuard = options.contentGuard ?? new NoopContentGuard();
    this.feedbackHook = options.feedbackHook ?? new NoopCritiqueLoop();
  }

  async run(input: OrchestratorRunInput): Promise<FrameworkResult<OrchestratorReport>> {
    const task = classifyTask(input.task);
    const runId = /* reuse executor id generator */;
    const traceId = input.traceId ?? /* same generator */;

    // 1. Route. route() returns FrameworkResult — propagate failure, never throw.
    const plan = this.supervisorPolicy.route({ task, registry: /* see note */ });
    if (!plan.ok) {
      return fail(plan.error);
    }

    // PHASE 03 SCOPE: only the single-composition path is real this phase.
    // A non-single plan is unreachable with DefaultSupervisorPolicy (it only
    // emits "single"), but stay total: warn and run agents[0] rather than fail.
    const manager = plan.value.agents[0];
    const composeWarnings: string[] =
      plan.value.composition === "single"
        ? []
        : ["multi-agent composition deferred to Stage 26 Phase 05; ran first agent only"];

    // 2. Run the single executor.
    const sub = await this.singleAgentExecutor.execute({
      task: input.task,
      includeContext: input.contextPackage !== undefined,
      contextPackage: input.contextPackage,
      tools: input.tools
    });
    if (!sub.ok) {
      return fail(sub.error);
    }

    const subRun: OrchestratorSubRun = {
      agentId: manager.id,
      role: manager.role,
      attemptCount: 1,
      executorReport: { kind: "single", report: sub.value }
    };

    const synthesis = sub.value.result.summary;

    // 3. Content guard (no-op default). ASYNC.
    const contentVerdict = await this.contentGuard.inspect({
      direction: "output",
      text: synthesis
    });

    // 4. Feedback hook (no-op default). ASYNC.
    const feedback = await this.feedbackHook.evaluate({
      runId,
      traceId,
      outputText: synthesis
    });

    const report: OrchestratorReport = {
      kind: "orchestrator",
      runId,
      traceId,
      task,
      plannedAgents: [manager.role],
      subRuns: [subRun],
      synthesis,
      tokenUsage: sub.value.tokenUsage,
      contentVerdict,
      feedback,
      warnings: composeWarnings.length > 0 ? composeWarnings : undefined
    };

    return ok(report);
  }
}
```

### RESOLVE THESE OPEN POINTS BY READING SOURCE (do not guess):

A. **id generator** — find the exact util the executors use for `runId`/`traceId` (grep
   `randomUUID`, `crypto`, or a `newId`/`generateId` helper in `runtime/src`). Reuse it. Do
   NOT add a new dependency.

B. **registry for `route()`** — `SupervisorPolicy.route()` needs an `AgentDefinitionRegistry`.
   The orchestrator does not currently hold one. Two clean options — **pick the one that
   matches the executor pattern and document the choice in the changelog**:
   - (B-i) inject `agentRegistry: AgentDefinitionRegistry` into `AgentOrchestratorOptions`
     (preferred — explicit dependency, mirrors `ExecutorOptions.agentRegistry`).
   - (B-ii) read it off the executor — REJECT; the executor does not expose it publicly.
   Go with **B-i**: add `readonly agentRegistry: AgentDefinitionRegistry` to
   `AgentOrchestratorOptions` and pass it to `route()`.

C. **the multi-composition guard** — the placeholder `fail({code: "agent.no-manager-registered"})`
   above is WRONG. For Phase 03, a `DefaultSupervisorPolicy` only ever returns `"single"`, so
   this branch is unreachable in practice. Still, do not fail with a misleading code. Instead:
   add a warning and treat any non-single plan by running ONLY `agents[0]` as a single sub-run,
   AND push a `warnings` entry `"multi-agent composition deferred to Stage 26 Phase 05; ran
   first agent only"`. This keeps the orchestrator total (never throws, never fails on a valid
   plan) and is forward-compatible — Phase 05 replaces this branch with real composition.

### MODIFY — `packages/agentic-ai-infra-runtime/src/orchestrator/index.ts`

```typescript
export * from "./types.js";
export * from "./supervisor-policy.js";
export * from "./agent-orchestrator.js";
```

---

## TESTS TO ADD (+10) — `packages/agentic-ai-infra-runtime/test/orchestrator/agent-orchestrator.test.ts`

Read `test/agents/executor-enforcement.test.ts` first to copy the exact way executors and
registries are constructed in tests (config, container, mock context package). Build a real
`SingleAgentExecutor` + a real `DefaultSupervisorPolicy` + a registry containing a `"manager"`.

Cover:
1. **End-to-end single happy path** — `run({task})` → `ok`, `report.kind === "orchestrator"`,
   `subRuns.length === 1`, `subRuns[0].executorReport.kind === "single"`, `plannedAgents ===
   ["manager"]`.
2. **synthesis equals the executor summary** — `report.synthesis === subRuns[0].report.result.summary`.
3. **attemptCount is 1** (no retry in this phase).
4. **contentVerdict is pass-through** — `{safe:true, action:"pass"}` from `NoopContentGuard`.
5. **feedback is pass-through** — `{action:"accept"}` from `NoopCritiqueLoop`.
6. **route failure propagates** — registry with NO manager → `run()` returns `ok:false` with
   `error.code === "agent.no-manager-registered"` (orchestrator forwards the supervisor's fail).
7. **executor failure propagates** — inject a stub executor returning `fail(...)` →
   orchestrator returns that same failure unchanged.
8. **traceId propagation** — passing `traceId` in input → `report.traceId` equals it; omitting
   it → a non-empty generated id.
9. **custom contentGuard is called** — inject a spy `ContentGuard` whose `inspect` returns
   `{safe:false, action:"warn", reason:"x"}` → `report.contentVerdict` reflects it.
10. **custom feedbackHook is called** — inject a spy returning `{action:"escalate"}` →
    `report.feedback.action === "escalate"`.

For 7/9/10 use minimal inline stub objects implementing the interface, not full mocks.

---

## SELF-REVIEW CHECKLIST

- [ ] `run()` is `async` and returns `Promise<FrameworkResult<OrchestratorReport>>`.
- [ ] No `throw` — route failure and executor failure both `return fail(...)` (propagated).
- [ ] `contentGuard.inspect` and `feedbackHook.evaluate` are `await`-ed.
- [ ] id generator is the SAME util the executors use (grep-verified, no new dependency).
- [ ] `agentRegistry` is injected via options and passed to `route()` (decision B-i).
- [ ] The non-single branch does NOT fail with a misleading code — it warns and runs agents[0].
- [ ] `report.task` comes from `classifyTask(input.task)`, never the raw task string.
- [ ] Orchestrator holds no mutable instance state beyond injected deps.
- [ ] `.js` extensions; `import type` vs value-import convention matches the repo.

## WHAT NOT TO DO

- Do NOT implement multi-agent composition, retry, or the per-orchestrator response guard —
  Phase 05.
- Do NOT wire the container slot — Phase 06.
- Do NOT call SmartRouter, an LLM, the network, or fs in this phase.
- Do NOT push to `EvalStore` yet (Q4 is a Phase 05/06 decision; keep this phase pure).
- Do NOT reference LangGraph / LangChain / AutoGen / CrewAI / BM25-as-library.
- Do NOT add fields to `AgentDefinition`, executor reports, or `ExecutorOptions`.

## CI + COMMIT

> RUNNER NOTE: `pnpm.cmd` is the Windows/PowerShell form. On a Linux runner (Codex cloud,
> CI container) use `pnpm run ci`. Do ONLY this phase, then STOP — do not begin the next phase
> in the same session, even if context remains.
```
pnpm.cmd run ci         # expect test 547/547 ✓
```
Changelog `changelog/stage-26/stage-26-phase-03-<date>.md` — record decision B-i and the
non-single-warns-and-runs-first behavior. Then:
```
git commit -m "feat(orchestrator): AgentOrchestrator single-agent composition (Stage 26 P03)"
```

## DONE SIGNAL

- Final test count (expect 547).
- Which id generator was reused (file + symbol).
- Confirmation B-i chosen; confirmation non-single path warns rather than fails.
- 3-line RESULTS_SUMMARY.
