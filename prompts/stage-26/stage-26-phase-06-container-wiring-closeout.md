# Stage 26 — Phase 06 — Container slot + seam tests + D23 regression + docs closeout

ONE phase, ONE session. Wire `orchestrator` into `RuntimeServiceContainer`, add container-seam
tests, run the full D23 regression, and ship all Stage 26 documentation. This phase closes
Stage 26.

---

## BEFORE YOU START — read these from source

1. `packages/agentic-ai-infra-runtime/src/runtime/index.ts`:
   - `RuntimeServiceContainer` type (line ~110) — the 17 current slots. You add `orchestrator`.
   - `RuntimeServiceContainerOptions` (line ~283) — `RuntimeStartOptions & { config,
     contentGuard?, feedbackHook? }`. You add an optional `orchestrator?` / supervisor override.
   - `createRuntimeServiceContainer(options): FrameworkResult<RuntimeServiceContainer>`
     (line ~325) — **SYNCHRONOUS**, returns `FrameworkResult`, NOT a Promise. Read the pre-
     return construction block (lines ~560-583): `agentRegistry`, `inputGuard`, `contentGuard`,
     `feedbackHook` are built as `const`s, then spread into `return ok({...})` (line ~583).
  - CONFIRMED FINDING (do not re-investigate): the container does NOT construct executors.
    `new SingleAgentExecutor` / `new TokenEfficientMultiAgentExecutor` appear in ZERO runtime
    SRC files — only in tests. Both classes are exported from `runtime/src/agents/index.ts`
    (lines 356, 682) but are NOT re-exported from the runtime barrel. `ExecutorOptions`
    (line 127) is exported from the agents module. Therefore THIS PHASE builds both executors
    locally inside the factory from the consts the factory already assembles, then injects
    them into the orchestrator. (See step 3 for the exact ExecutorOptions to pass.)
2. `packages/agentic-ai-infra-runtime/src/orchestrator/agent-orchestrator.ts` —
   `AgentOrchestratorOptions` (supervisorPolicy, agentRegistry, singleAgentExecutor,
   multiAgentExecutor, contentGuard?, feedbackHook?).
3. `packages/agentic-ai-infra-runtime/src/orchestrator/supervisor-policy.ts` —
   `DefaultSupervisorPolicy`.
4. `test/runtime/container-seams.test.ts` (Stage 25.5 P05) — the precedent for container-slot
   tests (auto-construct + override path). Mirror its structure.
5. Docs to update (read each before editing):
   - `docs/internal/v3-architecture-snapshot.md` — Layer 10 rows.
   - `STATUS.md` — header + stage section.
   - `kb.md` — session-entry style + closeout.
   - `AGENTS.md` / `CLAUDE.md` — only if a procedural rule changed (it did not; likely no edit).
   - `CHANGELOG.md` — release-level additive line.

---

## LOCKED DECISIONS THIS PHASE HONORS

- **D22 / D43 precedent**: `orchestrator` is a NON-optional container slot, auto-wired by the
  factory with a default (`DefaultSupervisorPolicy` + the container's executors + the
  container's `contentGuard`/`feedbackHook`). Callers using `createRuntimeServiceContainer`
  see no API change. D23-safe.
- **Container stays side-effect-free**: constructing the orchestrator must NOT start
  transports, connect DBs, or call the network. It is pure composition of already-built deps.
- **Factory is synchronous** — do not make it async to build the orchestrator; the orchestrator
  constructor does no I/O.
- **Slot count**: 17 → 18 after this phase.

---

## FILES TO CHANGE

### MODIFY — `packages/agentic-ai-infra-runtime/src/runtime/index.ts`

1. Add the slot to `RuntimeServiceContainer` (place it logically near `agentRegistry` /
   guard slots, with a TSDoc block matching the surrounding style):

```typescript
  /**
   * Agent orchestrator — the canonical Layer-10 composition entry point
   * (Stage 26). Auto-wired with `DefaultSupervisorPolicy`, the container's
   * executors, and the container's content guard + feedback hook. Callers may
   * override via `RuntimeServiceContainerOptions.orchestrator`.
   *
   * @umbrella Guardrails
   */
  readonly orchestrator: AgentOrchestrator;
```

2. Add an optional override to `RuntimeServiceContainerOptions`:

```typescript
  /** Override for the auto-wired AgentOrchestrator (Stage 26). */
  readonly orchestrator?: AgentOrchestrator;
  /** Override for the default DefaultSupervisorPolicy (Stage 26). */
  readonly supervisorPolicy?: SupervisorPolicy;
```

3. In the factory body, AFTER `contentGuard` / `feedbackHook` consts and AFTER the executors
   (or their `ExecutorOptions`) are available, build the orchestrator const:

```typescript
// Stage 26: orchestrator wiring (D22 precedent).
  // The container did not build executors before this phase (confirmed: zero
  // src construction sites). Build them here from the consts already assembled,
  // then inject. ExecutorOptions fields are all optional except `config`.
  const supervisorPolicy = supervisorPolicyOverride ?? new DefaultSupervisorPolicy();
  const executorOptions: ExecutorOptions = {
    config: resolved.value,
    observability,
    trajectoryRecorder,
    tokenRecorder: startOptions.tokenRecorder ?? new TokenUsageRecorder(),
    evalStore,
    agentRegistry,
    sessionManager,
    sessionId: startOptions.sessionId
  };
  const singleAgentExecutor = new SingleAgentExecutor(executorOptions);
  const multiAgentExecutor = new TokenEfficientMultiAgentExecutor(executorOptions);
  const orchestrator =
    orchestratorOverride ??
    new AgentOrchestrator({
      supervisorPolicy,
      agentRegistry,
      singleAgentExecutor,
      multiAgentExecutor,
      contentGuard,
      feedbackHook
    });
```

   > If the container does not currently build executors, construct them here from the same
   > `ExecutorOptions` the container already assembles (config, observability, trajectory
   > recorder, token recorder, evalStore, agentRegistry, sessionManager, sessionId). Build them
   > as local consts and pass into the orchestrator. Document this in the changelog.

4. Add `orchestrator,` to the `return ok({...})` object (line ~583), next to `feedbackHook,`.

5. Add imports:
   - `AgentOrchestrator`, `DefaultSupervisorPolicy` from `../orchestrator/index.js`;
   - `SingleAgentExecutor`, `TokenEfficientMultiAgentExecutor`, and the `ExecutorOptions` type
     from `../agents/index.js` (they are NOT on the runtime barrel — import from the module);
   - `TokenUsageRecorder` — confirm its current import (already used at the return site);
   - `SupervisorPolicy`, `AgentOrchestrator` types as needed for the options type.

### MODIFY — destructure the new options keys

In the factory's opening destructure (line ~327: `const { config, contentGuard: ...,
feedbackHook: ..., ...startOptions } = options;`), add `orchestrator` and `supervisorPolicy`
so they do not leak into `startOptions`:

```typescript
  const {
    config,
    contentGuard: contentGuardOverride,
    feedbackHook: feedbackHookOverride,
    orchestrator: orchestratorOverride,
    supervisorPolicy: supervisorPolicyOverride,
    ...startOptions
  } = options;
```

(and use the `*Override` names in step 3 accordingly).

### UPDATE — every caller of `createRuntimeServiceContainer`

Because the slot is non-optional, TypeScript will error on any code that constructs a
`RuntimeServiceContainer` LITERAL by hand (tests, examples, CLI templates) without
`orchestrator`. The factory auto-wires it, so callers using the FACTORY are fine. Grep for
hand-built container literals (`: RuntimeServiceContainer = {` or `satisfies
RuntimeServiceContainer`) and fix each — mirror what Stage 25.5 P05 did for `contentGuard` /
`feedbackHook`. List them in the changelog.

---

## TESTS TO ADD (+4) — extend `test/runtime/container-seams.test.ts`

1. **Auto-construct** — `createRuntimeServiceContainer({config})` → `container.orchestrator`
   is an `AgentOrchestrator` instance; a smoke `run({task})` returns `ok` with
   `kind:"orchestrator"`. PRECONDITION: the default registry must contain a `"manager"`
   definition (Stage 25 ships six defaults including `manager`). Verify with
   `container.agentRegistry.findById("manager")` in the test setup; if absent, the smoke run
   would fail-close with `agent.no-manager-registered` — that would signal a registry-default
   regression, not an orchestrator bug.
2. **Default supervisor wired** — the auto-wired orchestrator routes a default-registry task
   to the manager (single composition) end-to-end.
3. **Override path** — passing `{orchestrator: <stub>}` → `container.orchestrator` is the stub
   (factory does not overwrite an explicit override).
4. **supervisorPolicy override** — passing `{supervisorPolicy: <stub>}` (no orchestrator
   override) → the auto-built orchestrator uses the stub policy.

---

## D23 REGRESSION — explicit, not implied

Run the full suite. The 555 pre-Phase-06 tests (and the 480 Stage-25 / 529 Stage-25.5
baselines transitively) MUST pass byte-for-byte. If any baseline test changed, the wiring
leaked behavior — STOP and fix. Add a short note in the changelog: "D23 regression: N baseline
tests unchanged."

---

## DOCUMENTATION (non-negotiable deliverable)

1. `docs/internal/learning-notes/stage-26-orchestrator.md` — NEW. Cover: the six decisions
   (A1 sibling report, B1 core-interface, route-returns-FrameworkResult correction, no-
   RetryOutcome correction, NEVER_RETRY-unchanged correction, allSettled, B-i registry
   injection, agentId plumbing); rejected alternatives; the executor-per-composition choice;
   risks; Stage 27 pickups.
2. `docs/internal/v3-architecture-snapshot.md` — Layer 10 row → "AgentOrchestrator live";
   add a Stage 26 section + matrix rows for the wired refusal codes and the orchestrator slot.
3. `STATUS.md` — header (565 tests, Stage 26 COMPLETE) + a Stage 26 section listing the 6
   phases and test deltas.
4. `kb.md` — one session entry per phase already exists if you logged them; add the Stage 26
   CLOSEOUT block (decisions, corrections-vs-design-doc, final counts).
5. `CHANGELOG.md` — one additive release line.
6. Public reference doc `docs/04-core-framework/agent-orchestrator.md` — NEW. Concepts,
   SupervisorPolicy, composition modes, OrchestratorReport shape, refusal semantics, wiring
   via container, public API surface. Prose, no bullet-spam.

---

## SELF-REVIEW CHECKLIST

- [ ] Factory still SYNC, still returns `FrameworkResult` (not Promise).
- [ ] `orchestrator` slot non-optional; auto-wired; override respected.
- [ ] New options keys destructured so they don't leak into `startOptions`.
- [ ] Container construction does NO I/O (no transport/DB/network) — side-effect-free import.
- [ ] Every hand-built container literal updated (grep-confirmed); factory callers untouched.
- [ ] Slot count is exactly 18; the other 17 are byte-unchanged.
- [ ] Full D23 regression green; note the baseline count in the changelog.
- [ ] All six doc surfaces updated; learning note records the FIVE corrections vs the design
      doc (FrameworkError-is-a-type, route-returns-Result, no-RetryOutcome, NEVER_RETRY-
      unchanged, factory-is-sync).
- [ ] No LangGraph / LangChain / AutoGen / CrewAI / BM25-as-library reference in any doc.

## WHAT NOT TO DO

- Do NOT make the factory async.
- Do NOT make the `orchestrator` slot optional (breaks the D22 precedent + intent).
- Do NOT start transports or connect to a DB while constructing the orchestrator.
- Do NOT add a `agentic.agents.run` MCP tool — deferred to Stage 28 / a follow-on.
- Do NOT change executor or guard behavior to make wiring easier.
- Do NOT reference any external agent framework or "BM25 library" in docs.

## CI + COMMIT

> RUNNER NOTE: `pnpm.cmd` is the Windows/PowerShell form. On a Linux runner (Codex cloud,
> CI container) use `pnpm run ci`. Do ONLY this phase, then STOP — do not begin the next phase
> in the same session, even if context remains.
```
pnpm.cmd run ci         # expect test 569/569 ✓
```
Changelog `changelog/stage-26/stage-26-phase-06-<date>.md` — list touched call sites, the
executor-construction finding, and the D23 baseline count. Then:
```
git commit -m "feat(runtime): wire AgentOrchestrator container slot + Stage 26 closeout (Stage 26 P06)"
```

## DONE SIGNAL

- Final test count (expect 569; Stage 26 total ≈ +40 over 529).
- Whether the container builds executors itself or the orchestrator does (the finding).
- Confirmation slot count 17 → 18 and full D23 regression green.
- List of doc surfaces updated.
- 3-line RESULTS_SUMMARY + "STAGE 26 COMPLETE".
