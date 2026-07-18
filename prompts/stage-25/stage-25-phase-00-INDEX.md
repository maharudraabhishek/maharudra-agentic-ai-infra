# Stage 25 — AgentDefinition + AgentDefinitionRegistry
## Phase Index (for the operator, NOT for Claude Code)

---

## What Stage 25 ships

P4 Layer 10 foundation: per-agent declarative configuration with planning-time
policy enforcement. Lands the type system, registry, and enforcement plumbing
that Stage 26 (orchestrator) and Stage 27 (Postgres-backed eval store + supervisor)
will build on.

**Scope is strictly bounded.** Stage 25 enforces only `allowedTools` and
`budgetPolicy` at planning time. `modelPolicy`, `retrievalPolicy`,
`memoryPolicy`, and `approvalPolicy` are declared in the type but enforcement
is deferred to Stages 26/27. Execution-time per-agent enforcement is also Stage 26.

**Stage 25 is non-breaking.** All 429 existing tests pass without modification
except mock-container construction sites that gain the new `agentRegistry` field
(5 sites updated in Phase 03).

---

## Pre-flight checks

Before running Phase 01, confirm on your machine:

```powershell
cd C:\Users\abhi1\react\maharudra-agentic-ai-infra
pnpm run ci
```

Expected output:
```
test 429/429 ✓
build ✓ typecheck ✓ test ✓ lint ✓
```

If CI is not green at 429/429, do NOT start Stage 25. Either:
- Resolve the failure first, or
- Confirm with the user that Stage 24 status is what's shown above

---

## Phase order — strict dependency chain

```
Phase 01: core-types
  ↓ (types exist before runtime imports them)
Phase 02: registry-impl
  ↓ (registry exists before container wires it)
Phase 03: container-wiring
  ↓ (container exposes registry before executors consume it)
Phase 04: executor-enforcement
  ↓ (executor honors definition before single-agent evals push)
Phase 05: single-agent-evals
  ↓ (eval push works before validator/docs)
Phase 06: validator-and-docs
```

Each phase ends CI-green. If a phase fails CI, fix in that phase before moving on.

---

## Test count progression

| Phase | Starting tests | Δ | Ending tests |
|---|---|---|---|
| 01 — core-types | 429 | +8 | 437 |
| 02 — registry-impl | 437 | +12 | 449 |
| 03 — container-wiring | 449 | +5 | 454 |
| 04 — executor-enforcement | 454 | +10 | 464 |
| 05 — single-agent-evals | 464 | +8 | 472 |
| 06 — validator-and-docs | 472 | +3 | 475 |

**Final target: ~475 tests passing, CI green.**

These are estimates; if a phase lands ±2 tests off, that is normal. What matters
is the CI is green and the SELF-REVIEW CHECKLIST passes.

---

## File coverage matrix

| File | 01 | 02 | 03 | 04 | 05 | 06 |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| `core/src/agents/types.ts` | ✏️ |  |  |  |  |  |
| `core/src/errors/index.ts` | ✏️ |  |  |  |  |  |
| `core/test/agent-definition.test.ts` | ➕ |  |  |  |  |  |
| `runtime/src/agents/registry.ts` |  | ➕ |  |  |  |  |
| `runtime/src/agents/index.ts` |  | ✏️ | ✏️ | ✏️ | ✏️ |  |
| `runtime/src/runtime/index.ts` |  |  | ✏️ |  |  |  |
| `runtime/src/evals/single-agent-evals.ts` |  |  |  |  | ➕ |  |
| `runtime/src/evals/index.ts` |  |  |  |  | ✏️ |  |
| `runtime/test/agents/registry.test.ts` |  | ➕ |  |  |  |  |
| `runtime/test/runtime.test.ts` |  |  | ✏️ |  |  |  |
| `runtime/test/agents/executor-enforcement.test.ts` |  |  |  | ➕ |  |  |
| `runtime/test/evals/single-agent-evals.test.ts` |  |  |  |  | ➕ |  |
| `runtime/test/agent-harness-phase5.test.ts` |  |  | ✏️ |  |  |  |
| `examples/src/vectorless-local/index.ts` |  |  | ✏️ |  |  |  |
| `examples/src/local-context/index.ts` |  |  | ✏️ |  |  |  |
| `core/src/config/validator.ts` |  |  |  |  |  | ✏️ |
| `core/test/config-validator.test.ts` |  |  |  |  |  | ✏️ |
| `docs/04-core-framework/agent-definition-and-registry.md` |  |  |  |  |  | ➕ |
| `docs/internal/learning-notes/stage-25-agent-definition.md` |  |  |  |  |  | ➕ |
| `docs/internal/v3-architecture-snapshot.md` |  |  |  |  |  | ✏️ |
| `STATUS.md` |  |  |  |  |  | ✏️ |
| `kb.md` |  |  |  |  |  | ✏️ |

Legend: ➕ created, ✏️ modified

---

## Locked decisions for Stage 25 (D18–D24)

These are NEW decisions added by Stage 25. They join D1–D17 as immutable.

| # | Decision |
|---|---|
| D18 | Legacy `AgentRegistry` and `AgentRouter` interfaces are deprecated, kept for backwards compat. New `AgentDefinitionRegistry` interface supersedes them. |
| D19 | `AgentDefinition = AgentProfile & PolicyFields` via intersection type. `AgentProfile` stays unchanged. |
| D20 | `allowedTools` is a TIGHTENING filter on top of `roleAllowsTool()`. Applied at PLANNING time only in Stage 25; execution-time enforcement deferred to Stage 26. |
| D21 | `AgentDefinitionRegistry` interface is READ-ONLY. Mutation (`register`) is on the concrete `InMemoryAgentDefinitionRegistry` class only. |
| D22 | `agentRegistry: AgentDefinitionRegistry` is NON-OPTIONAL on `RuntimeServiceContainer` (D16 precedent). Auto-built from `config.agents.agents`. |
| D23 | Default definitions (one per `DEFAULT_AGENT_ROLES`) have NO policy fields set — backwards-compatible. Users opt in via explicit config. |
| D24 | `runSingleAgentEvals()` is a separate function from `runAgentRuntimeEvals()`. Single-agent push happens only when `AgentDefinition.evalRules` is set. |

---

## How to run each phase

For each phase file:

1. Open a fresh Claude Code session in the project root
2. Paste the entire phase file content as the first message
3. Let Claude Code do the work
4. When Claude Code says "DONE SIGNAL", verify the test count and CI status it reports
5. If CI fails, ask Claude Code to fix within the same session — do NOT escalate to the next phase
6. Optionally run `pnpm run ci` yourself to double-check
7. Move to the next phase

**Do NOT combine phases.** Each phase is a clean PR-sized unit. Combining them
makes failures harder to attribute and harder to revert.

---

## What "done" looks like for Stage 25

- All 6 phases complete, each with their DONE SIGNAL output captured
- `pnpm run ci` is green on the user's machine with ~475/475 tests passing
- `STATUS.md` reflects Stage 25 completion with the phase-by-phase entries
- `kb.md` has a Stage 25 session entry with D18–D24
- `docs/04-core-framework/agent-definition-and-registry.md` is published
- The active stage verification summary is updated in newest-first order for the next session

After Stage 25 lands, Stage 26 can begin: `AgentOrchestrator` + `SupervisorPolicy`
+ execution-time per-agent enforcement.

---

## Self-review for the operator

Before declaring Stage 25 done, confirm:

- [ ] All 6 phases ran and produced their DONE SIGNAL
- [ ] No phase was skipped or combined
- [ ] `pnpm run ci` is green on the final commit
- [ ] Test count is in the 472–477 range
- [ ] No file outside the FILES TO CHANGE list of any phase was modified
- [ ] No locked decision D1–D17 was violated (look for tell-tale signs: changes to `runAgentRuntimeEvals` input, persisted `AgentDefinition` in storage, etc.)
- [ ] STATUS.md and kb.md were updated in Phase 06
- [ ] The public doc reads professionally — no internal phase numbers, no "Stage N" wording in public content

If anything is off, do NOT publish. Open a corrective session.

---

<!-- Generated 2026-05-25 — Stage 25 plan -->
