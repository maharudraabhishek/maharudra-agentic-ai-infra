# Stage 26 — Phase 01 — SupervisorPolicy (core interface) + DefaultSupervisorPolicy (runtime)

You are executing ONE phase in ONE Claude Code session for the MahaRudra Agentic AI
Infra monorepo. Do exactly this phase. Do not start Phase 02.

---

## BEFORE YOU START — read these, in order, from the actual source

Do NOT trust this prompt's line numbers blindly — file edits shift them. Open each
file and confirm the shape before writing code.

1. `packages/agentic-ai-infra-core/src/errors/index.ts` — confirm:
   - `FrameworkError` is a **TYPE** (a payload `{ code, message, severity, ... }`), NOT a
     class. There is **no `new FrameworkError(...)`** anywhere in the codebase.
   - `FrameworkResult<T>` is `{ ok: true, value } | { ok: false, error }`.
   - `ok<T>(value)` and `fail<T>(error)` are the only constructors. **You will use `fail()`.**
2. `packages/agentic-ai-infra-core/src/agents/types.ts`:
   - `AgentRole` union (line ~9) — includes `"manager"`.
   - `SafeTaskMetadata` (line ~25) — `{ taskHash, taskType, labels?, riskFlags? }`.
   - `AgentDefinition` (line ~462) — flat, all policy slots optional.
   - `AgentDefinitionRegistry` interface (line ~510) — methods are `list()`,
     `findById(id)`, `findByRole(role)`, `count()`. **There is no `findByRole(...)[0]`
     convenience — `findByRole` returns a `readonly AgentDefinition[]`; index it yourself.**
3. `packages/agentic-ai-infra-core/src/errors/index.ts` — find the `ErrorCode` union.
   Confirm whether `"agent.no-manager-registered"` already exists (it does NOT as of
   Stage 25.5). You will ADD it this phase.
4. `packages/agentic-ai-infra-core/src/index.ts` — the core barrel. Confirm how existing
   modules are re-exported (e.g. `export * from "./agents/index.js";`). You will add an
   `orchestrator` barrel line in the same style.

---

## LOCKED DECISIONS THIS PHASE HONORS

- **D-B1**: `SupervisorPolicy` interface lives in **core**; default impl lives in **runtime**.
  Mirrors every Stage 25.5 seam (`InputGuard`, `OutputGuard`, `ContentGuard`, `FeedbackHook`).
- **route() returns `FrameworkResult<SupervisorRoutePlan>` and DOES NOT THROW.** This is the
  single most important correction vs. the architectural-design doc, which incorrectly showed
  `throw new FrameworkError(...)`. That does not compile. Return `fail({...})` instead.
- **D23**: every addition is additive. 529 baseline tests pass byte-for-byte after this phase.
- **Stage 21 D1**: `SupervisorPolicy.route()` is pure routing logic — NO LLM call, NO SmartRouter,
  NO network, NO I/O. It reads the registry and returns a plan.

---

## FILES TO CHANGE

### NEW — `packages/agentic-ai-infra-core/src/orchestrator/types.ts`

```typescript
import type { AgentDefinition, AgentDefinitionRegistry, SafeTaskMetadata } from "../agents/types.js";
import type { FrameworkResult } from "../errors/index.js";

/**
 * Input to a supervisor routing decision.
 *
 * @umbrella Guardrails
 */
export type SupervisorRouteInput = {
  /** Safe, non-reversible task metadata (never the raw task text). */
  readonly task: SafeTaskMetadata;
  /** Read-only registry of available agent definitions. */
  readonly registry: AgentDefinitionRegistry;
};

/**
 * How the orchestrator should compose outputs across the routed agents.
 *
 * - `"single"`   — `agents` has exactly one entry; trivial composition.
 * - `"sequential"` — pipe each agent's output into the next agent's task.
 * - `"parallel"` — run all agents in isolation; merge at the end.
 */
export type SupervisorComposition = "single" | "sequential" | "parallel";

/** Plan produced by a supervisor: which agents run, and how to compose them. */
export type SupervisorRoutePlan = {
  /** Agents to run, in order. Never empty on an `ok` result. */
  readonly agents: readonly AgentDefinition[];
  /** Composition hint for the orchestrator. */
  readonly composition: SupervisorComposition;
};

/**
 * Decides which agents run for a given task.
 *
 * Pure routing contract: implementations MUST NOT call an LLM, the SmartRouter,
 * the network, or perform I/O (Stage 21 D1). They read the registry and return
 * a plan, or `fail()` when no valid plan exists.
 *
 * Interface lives in core; the default implementation lives in runtime
 * (`DefaultSupervisorPolicy`). Third parties may swap the default without
 * forking the runtime package.
 *
 * @umbrella Guardrails
 */
export interface SupervisorPolicy {
  route(input: SupervisorRouteInput): FrameworkResult<SupervisorRoutePlan>;
}
```

### NEW — `packages/agentic-ai-infra-core/src/orchestrator/index.ts`

```typescript
export * from "./types.js";
```

### MODIFY — `packages/agentic-ai-infra-core/src/index.ts`

Add ONE barrel line, in the same style as the existing exports (match `.js` extension
convention exactly):

```typescript
export * from "./orchestrator/index.js";
```

### MODIFY — `packages/agentic-ai-infra-core/src/errors/index.ts`

Add ONE new code to the `ErrorCode` union, grouped with the other `agent.*` codes
(`agent.weak-evidence`, `agent.tool-call-exceeded`, `agent.timeout`, `agent.retry-exhausted`,
`agent.retry-blocked`, `agent.tool-not-in-allowlist`). Add:

```typescript
  | "agent.no-manager-registered"
```

Confirm the exact union formatting (leading `|`, indentation) by reading the surrounding
codes first. Do not reorder existing codes.

### NEW — `packages/agentic-ai-infra-runtime/src/orchestrator/supervisor-policy.ts`

```typescript
import {
  fail,
  ok,
  type AgentDefinition,
  type FrameworkResult,
  type SupervisorPolicy,
  type SupervisorRouteInput,
  type SupervisorRoutePlan
} from "@maharudra/agentic-ai-infra-core";

/**
 * Default supervisor: routes every task to a single `"manager"` agent.
 *
 * Resolution order:
 *   1. `registry.findById("manager")` — the canonical reserved id (Stage 25).
 *   2. `registry.findByRole("manager")[0]` — fallback for setups that renamed
 *      the id but kept the role.
 *
 * Fails closed with `agent.no-manager-registered` when neither resolves. This
 * is the only failure path; routing is otherwise total.
 *
 * Stage 26 surface is intentionally minimal. Stage 31 (specialist agents)
 * extends it to multi-agent routing without changing this interface.
 *
 * @umbrella Guardrails
 */
export class DefaultSupervisorPolicy implements SupervisorPolicy {
  route(input: SupervisorRouteInput): FrameworkResult<SupervisorRoutePlan> {
    const byId = input.registry.findById("manager");
    const manager: AgentDefinition | undefined =
      byId ?? input.registry.findByRole("manager")[0];

    if (!manager) {
      return fail({
        code: "agent.no-manager-registered",
        message:
          "DefaultSupervisorPolicy requires a 'manager' AgentDefinition (by id or role). None registered.",
        severity: "fatal"
      });
    }

    return ok({ agents: [manager], composition: "single" });
  }
}
```

> NOTE on imports: confirm the core package import name from
> `packages/agentic-ai-infra-runtime/package.json` `dependencies` and from how other runtime
> files import core (e.g. `runtime/src/agents/index.ts` top imports). If types and runtime
> values (`ok`, `fail`) are imported from the same path, keep them in one import block as
> above; if the codebase splits `import type {...}` from value imports, match that convention.

### NEW — `packages/agentic-ai-infra-runtime/src/orchestrator/index.ts`

```typescript
export * from "./supervisor-policy.js";
```

### MODIFY — `packages/agentic-ai-infra-runtime/src/index.ts`

Add ONE barrel line, in the existing style:

```typescript
export * from "./orchestrator/index.js";
```

---

## TESTS TO ADD (+4) — `packages/agentic-ai-infra-runtime/test/orchestrator/supervisor-policy.test.ts`

Use the project's existing test framework and import style (read an existing runtime test
file first — e.g. `test/guardrails/output-guard.test.ts` — to copy the exact `describe`/`it`
/ assertion API and the registry construction helper).

Cover:
1. **Happy path by id** — registry with a `"manager"` definition → `ok`, `plan.agents`
   length 1, `plan.agents[0].id === "manager"`, `plan.composition === "single"`.
2. **Fallback by role** — registry where the manager definition has a non-`"manager"` id but
   `role: "manager"` → `ok`, resolves via `findByRole`.
3. **Fail-closed** — registry with NO manager (by id or role) → `result.ok === false`,
   `result.error.code === "agent.no-manager-registered"`, `result.error.severity === "fatal"`.
4. **Purity / determinism** — calling `route()` twice with the same input returns equal plans
   and does not mutate the registry (`registry.count()` unchanged before/after).

To build registries, use the real `createAgentDefinitionRegistry(...)` (find it in
`runtime/src/agents/...` or core — grep `createAgentDefinitionRegistry`) rather than a hand-
rolled stub, so the test exercises the real lookup semantics.

---

## SELF-REVIEW CHECKLIST (run before declaring DONE)

- [ ] No `throw` anywhere in the new code. `route()` returns `fail({...})`, never throws.
- [ ] `FrameworkError` is used only as a TYPE (in the `fail()` argument); never `new`.
- [ ] `agent.no-manager-registered` is spelled identically in: the `ErrorCode` union, the
      `fail()` call, and the test assertion. Grep all three.
- [ ] `findByRole("manager")[0]` indexes the array — not treated as a single value.
- [ ] Core barrel and runtime barrel both export the new `orchestrator` module.
- [ ] No LLM / SmartRouter / network / fs import in `supervisor-policy.ts` (Stage 21 D1).
- [ ] `import type` vs value-import convention matches surrounding files.
- [ ] `.js` extension on every relative import (NodeNext/ESM convention used project-wide).

## WHAT NOT TO DO

- Do NOT build `AgentOrchestrator` — that is Phase 03.
- Do NOT add the container slot — that is Phase 06.
- Do NOT add `OrchestratorReport` — that is Phase 02.
- Do NOT reference LangGraph, LangChain, AutoGen, CrewAI, LlamaIndex, or "BM25-the-library"
  anywhere — in code, comments, TSDoc, or docs. This project deliberately has zero agent-
  framework dependencies; `SupervisorPolicy` is its own deterministic routing primitive.
  If you describe it by analogy, describe it as "a pure routing function over the agent
  registry," not as "like X's supervisor."
- Do NOT add `enforcementMode`, `outputSchema`, or any `AgentDefinition` field. The shape is
  locked (D27, D30, D31, D36).
- Do NOT throw from `route()` even for the no-manager case.

## CI + COMMIT

> RUNNER NOTE: `pnpm.cmd` is the Windows/PowerShell form. On a Linux runner (Codex cloud,
> CI container) use `pnpm run ci`. Do ONLY this phase, then STOP — do not begin the next phase
> in the same session, even if context remains.
```
pnpm.cmd run ci         # build ✓ typecheck ✓ test 533/533 ✓ lint ✓
```

Then create the changelog entry `changelog/stage-26/stage-26-phase-01-<date>.md`
(Keep-a-Changelog format, D45) and commit:

```
git add -A
git commit -m "feat(orchestrator): SupervisorPolicy interface + DefaultSupervisorPolicy (Stage 26 P01)"
```

## DONE SIGNAL

Report back exactly:
- Final test count (expect 533).
- The four new test names.
- Confirmation that `agent.no-manager-registered` is the only new error code.
- Confirmation no baseline test changed.
- A 3-line RESULTS_SUMMARY block.
