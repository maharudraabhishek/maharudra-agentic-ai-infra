# Stage 26 — Phase 05 — Multi-agent composition + retry + per-orchestrator response guard

ONE phase, ONE session. Extend `AgentOrchestrator` from single-only (Phase 03) to full
composition: route a multi-agent plan, run each via `runWithRetry`, merge, then run the
per-orchestrator output guard.

---

## BEFORE YOU START — read these from source

1. `packages/agentic-ai-infra-runtime/src/orchestrator/agent-orchestrator.ts` (Phase 03) —
   the class you are extending. Re-read the single path and the "non-single warns and runs
   first agent" placeholder branch — you REPLACE that placeholder.
2. `packages/agentic-ai-infra-runtime/src/agents/index.ts`:
   - `TokenEfficientMultiAgentExecutor` — constructor + `async execute(input:
     MultiAgentExecutorInput): Promise<FrameworkResult<RuntimeMultiAgentRunReport>>`
     (line ~725). Confirm `MultiAgentExecutorInput` shape `{ task, contextPackage?, tools? }`.
   - `RuntimeMultiAgentRunReport` — has `synthesis`, `roleOutputs`, `tokenUsage`, `routedRoles`.
3. `packages/agentic-ai-infra-runtime/src/feedback-loops/retry-loop.ts`:
   - `runWithRetry<T>(op: (attempt: number) => Promise<FrameworkResult<T>>, policy?:
     AgentRetryPolicy): Promise<FrameworkResult<T>>`. The `op` receives the attempt number.
     **The function returns a plain `FrameworkResult<T>` — there is NO `RetryOutcome`.** To
     report `attemptCount`, capture the highest `attempt` the `op` callback was invoked with
     (close over a counter), since `runWithRetry` does not return attempt count.
 4. `packages/agentic-ai-infra-runtime/src/guardrails/output-guard.ts`:
    - `evaluateResponsePolicy(output: DeterministicAgentOutput, contextPackage:
      ContextPackage | undefined, policy: AgentResponsePolicy | undefined):
      ResponsePolicyDecision`. PURE, sync, no LLM. This is the per-orchestrator guard call.
    - `ResponsePolicyDecision` `{ pass, action, reason?, evidenceCoverage?, citationCount }`.
    - CONFIRMED `DeterministicAgentOutput` required fields: `role`, `summary`, `findings`,
      `sourceCount` (all else optional). The merged-output object is buildable with no `as any`.
5. `packages/agentic-ai-infra-core/src/agents/types.ts`:
   - `AgentResponsePolicy` + `AgentGuardTiming` (`"per-orchestrator"` default | `"per-agent"`).
   - `AgentRetryPolicy` — `{ maxAttempts?, backoffMs?, retryableErrorCodes? }` (confirm fields).
   - `DeterministicAgentOutput` — the shape `evaluateResponsePolicy` consumes.
6. `packages/agentic-ai-infra-runtime/src/orchestrator/types.ts` — `OrchestratorSubRun`
   (has `attemptCount`), `OrchestratorReport` (has optional `response?: ResponsePolicyDecision`).

---

## LOCKED DECISIONS THIS PHASE HONORS

- **D32**: per-orchestrator guard timing is the DEFAULT — the orchestrator calls
  `evaluateResponsePolicy` ONCE on the merged final output. `per-agent` timing is already
  handled inside the multi-agent executor (Stage 25.5 P03 populates `RuntimeRoleOutput.response`);
  the orchestrator does NOT re-run per-agent.
- **Q2 (resolved)**: parallel composition uses **`Promise.allSettled`** (consistent with the
  Stage 21 RetrievalRouter parallelism), NOT `Promise.all`. Individual sub-run failures are
  recorded in `subRuns`/`warnings`, not thrown.
- **No `RetryOutcome`** — `attemptCount` is derived by counting `op` invocations.
- **D39 / NEVER_RETRY unchanged** — `runWithRetry` already enforces the safety floor. The
  orchestrator just calls it; it adds nothing to the set.
- **D23**: 555 baseline tests pass byte-for-byte; the single path from Phase 03 is unchanged.

---

## FILES TO CHANGE

### MODIFY — `packages/agentic-ai-infra-runtime/src/orchestrator/agent-orchestrator.ts`

1. Add the multi-agent executor as an injected dependency:

```typescript
export type AgentOrchestratorOptions = {
  readonly supervisorPolicy: SupervisorPolicy;
  readonly agentRegistry: AgentDefinitionRegistry;       // from P03 decision B-i
  readonly singleAgentExecutor: SingleAgentExecutor;
  readonly multiAgentExecutor: TokenEfficientMultiAgentExecutor;  // NEW this phase
  readonly contentGuard?: ContentGuard;
  readonly feedbackHook?: FeedbackHook;
};
```

2. Replace the Phase-03 "non-single warns and runs first agent" placeholder with real
   composition. Structure `run()` as:

```
route → plan
if composition === "single"   → runSingle(manager)            (Phase 03 path, intact)
if composition === "sequential" → runSequential(plan.agents)
if composition === "parallel"   → runParallel(plan.agents)
→ merge subRuns into synthesis + aggregated tokenUsage
→ per-orchestrator response guard (evaluateResponsePolicy on merged output)  [D32]
→ contentGuard.inspect (async)
→ feedbackHook.evaluate (async)
→ assemble OrchestratorReport
```

3. **Per-agent execution with retry** — each agent runs through `runWithRetry`, counting
   attempts:

```typescript
private async runOneAgentWithRetry(
  agent: AgentDefinition,
  task: string,
  contextPackage?: ContextPackage,
  tools?: readonly ToolContract[]
): Promise<{ result: FrameworkResult<SingleAgentRunReport>; attemptCount: number }> {
  let attemptCount = 0;
  const result = await runWithRetry(
    (attempt) => {
      attemptCount = attempt;
      return this.singleAgentExecutor.execute({
        task,
        includeContext: contextPackage !== undefined,
        contextPackage,
        tools
      });
    },
    agent.retryPolicy
  );
  return { result, attemptCount };
}
```
> LOCKED DECISION (do not deviate): sequential AND parallel BOTH loop
   > `singleAgentExecutor.execute()` once per agent, each wrapped in `runWithRetry` with that
   > agent's `retryPolicy`. This is the only path that lets per-agent retry + per-agent policy
   > apply. EVERY sub-run is therefore `executorReport.kind === "single"`.
   >
   > `multiAgentExecutor` is INJECTED into the orchestrator (constructor dep) but NOT invoked
   > by any composition path in Stage 26. It is kept on the options for forward-compat (Stage
   > 31 homogeneous role fan-out) and so the container wires the real instance in P06. Add ONE
   > test asserting the injected `multiAgentExecutor` is reachable/non-undefined; do not call
   > its `.execute()` from the orchestrator this stage. Record this in the changelog.
   >
   > Consequence: `OrchestratorSubRun.executorReport.kind` is always `"single"` in Stage 26.
   > The `"multi"` union branch (defined in P02) stays valid for future use; no Stage 26 code
   > produces it. Tests must not assert a `"multi"` branch is produced.

4. **Sequential** — pipe agent N's `result.summary` into agent N+1's task (e.g. append as
   context preamble to the task string, or — cleaner — pass prior summaries as a synthesized
   task prefix). Keep it deterministic and documented.

5. **Parallel** — `Promise.allSettled` over `runOneAgentWithRetry` calls. For a settled
   rejection or a `fail` result, record an `OrchestratorRefusal` or a `warnings` entry and
   continue; do not abort the whole run unless ALL agents fail (then `fail`).

6. **Merge** — `synthesis` = concatenated/role-headered summaries (deterministic role-header
   synthesis, matching the multi-agent executor's style — read how `TokenEfficientMultiAgent
   Executor` builds its `synthesis` and mirror the header format). `tokenUsage` = summed
   `inputTokens`/`outputTokens`/`totalTokens` across sub-runs.

7. **Per-orchestrator response guard (D32)** — after merge, call once:

```typescript
// The merged output as a DeterministicAgentOutput-shaped value for the guard.
// Use the manager's responsePolicy (or the first agent's) — document the choice.
const response = evaluateResponsePolicy(mergedOutput, input.contextPackage, policy);
```

> `evaluateResponsePolicy(output, contextPackage, policy)` expects a
   > `DeterministicAgentOutput`. CONFIRMED required fields (core/src/agents/types.ts:153):
   > `role: AgentRole`, `summary: string`, `findings: readonly string[]`, `sourceCount: number`.
   > Optional: `tokenUsage?`, `citations?`, `evidenceCoverage?`, `confidence?`, `abstainReason?`.
   > Build the merged value honestly — NO `as any`:
   >
   >   const mergedOutput: DeterministicAgentOutput = {
   >     role: "manager",
   >     summary: synthesis,
   >     findings: [],
   >     sourceCount: input.contextPackage?.sources?.length ?? 0,
   >     citations: /* union of sub-run citations, or undefined */
   >   };
   >
   > Resolve `policy` from the manager `AgentDefinition`'s `responsePolicy` (route plan's
   > first agent). D32 intent: when `policy === undefined`, OMIT `report.response` entirely
   > (the field is optional and "undefined when no policy set"). When `policy` is set, populate
   > `report.response` with the single `evaluateResponsePolicy(...)` result.

8. Populate `subRuns[i].attemptCount` from the counter.

### MODIFY — `packages/agentic-ai-infra-runtime/src/orchestrator/index.ts`
No change if barrel already exports `agent-orchestrator.js` (Phase 03).

---

## TESTS TO ADD (+10) — extend `test/orchestrator/agent-orchestrator.test.ts` or add
`test/orchestrator/agent-orchestrator-composition.test.ts`

Inject a STUB `SupervisorPolicy` returning multiple agents to exercise composition (the default
only emits "single"). Build real executors + registry as in Phase 03.

1. **Sequential happy path** — stub supervisor returns 2 agents, `composition:"sequential"` →
   `ok`, `subRuns.length === 2`, `plannedAgents` length 2, synthesis contains both role headers.
2. **Parallel happy path** — `composition:"parallel"`, 2 agents → `subRuns.length === 2`,
   uses `allSettled` (assert both ran even if order differs).
3. **Parallel partial failure** — one agent's executor returns `fail`, the other `ok` →
   run still `ok`, failing agent recorded in `warnings`/`refusals`, succeeding sub-run present.
4. **Parallel total failure** — all agents fail → orchestrator returns `fail`.
5. **Retry — attemptCount reported** — agent with `retryPolicy.maxAttempts:3` +
   `retryableErrorCodes:["<retryable code>"]`; stub executor fails twice then succeeds →
   `subRuns[0].attemptCount === 3`, run `ok`.
6. **Retry — NEVER_RETRY floor** — agent retryPolicy allows a code that is in `NEVER_RETRY`
   (e.g. `token.budget-exceeded`); stub executor returns it → `runWithRetry` blocks → sub-run
   reflects the `agent.retry-blocked` failure (assert no extra attempts beyond 1).
7. **Per-orchestrator response guard runs once (D32)** — agent set with a `responsePolicy`;
   assert `report.response` is populated ONCE with a `ResponsePolicyDecision`, not per-agent.
8. **No responsePolicy → report.response omitted** (D32 "undefined when no policy set").
9. **tokenUsage aggregation** — `report.tokenUsage.totalTokens` equals the sum across sub-runs.
10. **D23 — single path unchanged** — the Phase-03 single happy-path test still passes
    identically (re-assert it or reference it).

---

## SELF-REVIEW CHECKLIST

- [ ] Parallel uses `Promise.allSettled`, never `Promise.all`.
- [ ] `attemptCount` derived from the `op` callback counter, NOT from a non-existent
      `RetryOutcome`.
- [ ] `runWithRetry` is called with the agent's `retryPolicy`; the orchestrator adds NOTHING
      to `NEVER_RETRY`.
- [ ] Per-orchestrator guard calls `evaluateResponsePolicy` exactly ONCE on the merged output.
- [ ] `report.response` omitted when policy undefined; populated when set (D32).
- [ ] The merged `DeterministicAgentOutput`-shaped value fills all REQUIRED fields honestly
      (read the type; do not stub with `as any`).
- [ ] Total-failure → `fail`; partial-failure → `ok` with warnings. Never throws.
- [ ] Role-header synthesis format mirrors `TokenEfficientMultiAgentExecutor` (grep-confirmed).
- [ ] Which executor each composition uses is documented in the changelog AND matches tests.
- [ ] Single path (Phase 03) byte-unchanged in behavior.

## WHAT NOT TO DO

- Do NOT invent `RetryOutcome` or any new orchestrator type.
- Do NOT call SmartRouter / LLM / network (still deferred; orchestrator MAY hold a router ref
  for later phases but does not call it here).
- Do NOT add per-agent guard logic in the orchestrator — that already lives in the multi-agent
  executor (D32 `per-agent` timing). Orchestrator does per-orchestrator only.
- Do NOT modify `runWithRetry`, `evaluateResponsePolicy`, `NEVER_RETRY`, or any executor.
- Do NOT use `as any` to satisfy `evaluateResponsePolicy`'s input — build a real shape.
- Do NOT reference LangGraph / LangChain / AutoGen / CrewAI / BM25-as-library.

## CI + COMMIT

> RUNNER NOTE: `pnpm.cmd` is the Windows/PowerShell form. On a Linux runner (Codex cloud,
> CI container) use `pnpm run ci`. Do ONLY this phase, then STOP — do not begin the next phase
> in the same session, even if context remains.

```
pnpm.cmd run ci         # expect test 565/565 ✓
```
Changelog `changelog/stage-26/stage-26-phase-05-<date>.md` — document the executor-per-
composition choice and the merged-output guard input construction. Then:
```
git commit -m "feat(orchestrator): multi-agent composition + retry + per-orchestrator guard (Stage 26 P05)"
```

## DONE SIGNAL

- Final test count (expect 565).
- Which executor each of single/sequential/parallel uses.
- Confirmation `allSettled` used and `NEVER_RETRY` unchanged.
- 3-line RESULTS_SUMMARY.
