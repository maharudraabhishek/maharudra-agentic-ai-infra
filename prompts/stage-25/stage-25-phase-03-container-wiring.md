# Stage 25 Phase 03 — Container Wiring: agentRegistry as Non-Optional Service
## Claude Code Prompt — MahaRudra Agentic AI Infra

---

## BEFORE YOU START — READ THIS FIRST

**Platform:** Windows 11, PowerShell, Node >= 20, pnpm only
**CI command:** `pnpm run ci`
**Starting test count:** 449/449 passing (Phase 02 complete)
**Expected test count after this phase:** ~454 passing (+5)

This prompt is self-contained. Do not invent details not stated here.
Do not modify any file not listed in the "FILES TO CHANGE" section.

Phase 02 added the registry class and factory. This phase exposes it
through the service container so executors can consume it.

---

## CONTEXT — WHAT IS DONE (locked from Phases 01–02)

- `AgentDefinition` type, `AgentDefinitionRegistry` interface — Phase 01
- `InMemoryAgentDefinitionRegistry`, `createAgentDefinitionRegistry()`,
  `DEFAULT_AGENT_DEFINITIONS` — Phase 02
- `RuntimeServiceContainer` (in `runtime/src/runtime/index.ts:106`) has 11
  fields. Two were added by Stage 24 (`evalStore`, `evalHarness`) as
  NON-OPTIONAL — D16. Phase 03 follows that precedent.
- `ExecutorOptions` (in `runtime/src/agents/index.ts`) has 8 optional fields,
  including `evalStore?: EvalStore`. Phase 03 adds `agentRegistry?` in the
  same style.

---

## NEW LOCKED DECISION — D22 (Stage 25)

- **D22** `agentRegistry: AgentDefinitionRegistry` is NON-OPTIONAL on
  `RuntimeServiceContainer`. Auto-built from `config.agents.agents` via
  `createAgentDefinitionRegistry()`. Caller may override by passing
  `agentRegistry` in `RuntimeStartOptions`. Mirrors D16's evalStore/evalHarness pattern.

---

## SCOPE

This phase:

1. Adds `agentRegistry: AgentDefinitionRegistry` to `RuntimeServiceContainer` (NON-OPTIONAL)
2. Adds `agentRegistry?: AgentDefinitionRegistry` to `RuntimeStartOptions` (optional override)
3. Wires auto-construction in `createRuntimeServiceContainer()`
4. Adds `agentRegistry?: AgentDefinitionRegistry` to `ExecutorOptions` (optional)
5. Updates 2 example files to pass `agentRegistry: container.agentRegistry` when constructing executors (canonical pattern)
6. Adds 5 tests in `runtime/test/runtime.test.ts`

**Tests that construct executors directly without a container (e.g.
`agent-harness-phase5.test.ts`) are NOT modified.** They construct executors
with minimal options; `agentRegistry` is optional in `ExecutorOptions` and
falls back to no enforcement (Stage 24 behavior, by D23).

---

## FILES TO CHANGE

```
packages/agentic-ai-infra-runtime/src/runtime/index.ts                (modify — container type + factory body)
packages/agentic-ai-infra-runtime/src/agents/index.ts                 (modify — ExecutorOptions field + import)
packages/agentic-ai-infra-runtime/test/runtime.test.ts                (modify — 5 new tests)
examples/src/vectorless-local/index.ts                                (modify — pass agentRegistry to executor)
examples/src/local-context/index.ts                                   (modify — pass agentRegistry to executor)
```

---

## CHANGE 1 — `packages/agentic-ai-infra-runtime/src/runtime/index.ts`

### 1a. Add imports

Find the existing imports block from `@maharudra/agentic-ai-infra-core` (near
top of file). Add `AgentDefinitionRegistry` to it. The exact existing line
will look like:

```typescript
import type {
  AgenticInfraProjectConfig,
  ResolvedProjectConfig,
  ToolContract,
  ToolExecutionHandler,
  RuntimeMode,
  FrameworkResult,
  RuntimeObservabilitySink,
  EvalStore
} from "@maharudra/agentic-ai-infra-core";
```

(Exact set may differ — the test for correctness is that `EvalStore` is
already in the list.)

Add `AgentDefinitionRegistry` to the import:

```typescript
import type {
  AgenticInfraProjectConfig,
  ResolvedProjectConfig,
  ToolContract,
  ToolExecutionHandler,
  RuntimeMode,
  FrameworkResult,
  RuntimeObservabilitySink,
  EvalStore,
  AgentDefinitionRegistry
} from "@maharudra/agentic-ai-infra-core";
```

Then add the registry factory import. Find the existing imports from
`../agents/index.js` (likely near other internal imports) and add
`createAgentDefinitionRegistry`:

```typescript
import { createAgentDefinitionRegistry } from "../agents/index.js";
```

If no existing import from `../agents/index.js` exists, add this as a new
import line near the other internal `../*/index.js` imports.

### 1b. Add field to `RuntimeServiceContainer` type

Find the `RuntimeServiceContainer` type (declared around line 106). Find
the `readonly evalHarness: EvalHarness;` line. Add the new field
immediately AFTER `evalHarness`:

```typescript
  readonly evalHarness: EvalHarness;
  /**
   * Agent definition registry — read-only lookup of `AgentDefinition` by id
   * or role. Stage 25.
   *
   * Auto-wired by `createRuntimeServiceContainer()` from
   * `config.agents.agents` via `createAgentDefinitionRegistry()`. Always
   * contains the six default definitions; caller-supplied profiles override
   * defaults on id collision (caller wins).
   *
   * Used by executors at planning time to apply per-agent `allowedTools` and
   * `budgetPolicy` (Stage 25 Phase 04). Stage 26 will use it for
   * orchestrator routing and execution-time enforcement.
   */
  readonly agentRegistry: AgentDefinitionRegistry;
```

### 1c. Add field to `RuntimeStartOptions` type

Find the `RuntimeStartOptions` type (declared around line 189). Add a new
optional field, ideally at the end before the closing brace:

```typescript
  /**
   * Caller-supplied `AgentDefinitionRegistry`. Overrides the auto-built
   * default registry. Useful when callers need to register definitions with
   * policy fields (allowedTools, budgetPolicy, evalRules) that the config
   * schema doesn't yet support (config-driven rich definitions land in
   * Stage 26).
   */
  readonly agentRegistry?: AgentDefinitionRegistry;
```

### 1d. Wire auto-construction in `createRuntimeServiceContainer()`

Find the body of `createRuntimeServiceContainer()`. Find the existing
Stage 24 wiring block — look for the comment `// Stage 24: eval store + harness wiring.`
or similar. The block constructs `evalStore` and `evalHarness`.

Immediately AFTER that block, BEFORE the final `return ok({ ... })` statement,
add:

```typescript
  // Stage 25: agent definition registry wiring.
  // Auto-built from config.agents.agents when no caller override supplied.
  // Always contains the six default definitions (no policy fields) — D23
  // guarantees backwards-compatibility.
  const agentRegistry =
    options.agentRegistry ??
    createAgentDefinitionRegistry(resolved.value.agents.agents);
```

Then find the `return ok({ ... })` block at the end of the function. Add
`agentRegistry` to the returned object. Existing structure looks roughly
like:

```typescript
  return ok({
    config: resolved.value,
    tools: registeredTools,
    handlers: options.handlers ?? createFrameworkToolHandlers(...),
    observability: options.observability ?? new StderrObservabilitySink(),
    trajectoryRecorder,
    tokenRecorder: options.tokenRecorder ?? new TokenUsageRecorder(),
    evalStore,
    evalHarness,
    retrievalRouter,
    storageProvider,
    sessionManager,
    traceSink,
    smartRouter,
    embeddingProvider
  });
```

Add `agentRegistry` immediately after `evalHarness` so the field order in
the return value matches the field order in the type declaration:

```typescript
  return ok({
    config: resolved.value,
    tools: registeredTools,
    handlers: options.handlers ?? createFrameworkToolHandlers(...),
    observability: options.observability ?? new StderrObservabilitySink(),
    trajectoryRecorder,
    tokenRecorder: options.tokenRecorder ?? new TokenUsageRecorder(),
    evalStore,
    evalHarness,
    agentRegistry,
    retrievalRouter,
    storageProvider,
    sessionManager,
    traceSink,
    smartRouter,
    embeddingProvider
  });
```

The `createFrameworkToolHandlers(...)` ellipsis is the existing argument
list — do NOT modify it. Just preserve whatever args are already there.

---

## CHANGE 2 — `packages/agentic-ai-infra-runtime/src/agents/index.ts`

### 2a. Add import

Find the existing imports from `@maharudra/agentic-ai-infra-core`. Add
`AgentDefinitionRegistry` to the type-only import list:

```typescript
import type {
  // ... existing imports including EvalStore, AgentRole, AgentProfile, etc.
  AgentDefinitionRegistry
} from "@maharudra/agentic-ai-infra-core";
```

Preserve all existing imports; just add `AgentDefinitionRegistry` to the type
import list.

### 2b. Add field to `ExecutorOptions`

Find the `ExecutorOptions` type (or interface — check existing code).
It contains fields like `config`, `trajectoryRecorder?`, `tokenRecorder?`,
`sessionManager?`, `sessionId?`, `observability?`, `evalStore?`.

Add a new optional field at the end of the type:

```typescript
  /**
   * Agent definition registry for planning-time policy enforcement
   * (Stage 25 Phase 04). When provided, the executor applies per-agent
   * `allowedTools` and `budgetPolicy` from the registered `AgentDefinition`.
   *
   * When absent, behavior matches Stage 24 — no per-agent restrictions are
   * applied (D23 backwards-compat). Typically wired from
   * `container.agentRegistry`.
   */
  readonly agentRegistry?: AgentDefinitionRegistry;
```

**Do NOT consume the field in any executor yet.** Phase 04 wires it into
`SingleAgentExecutor.execute()` and `TokenEfficientMultiAgentExecutor.execute()`.
Phase 03's job is only to expose the option slot.

---

## CHANGE 3 — `packages/agentic-ai-infra-runtime/test/runtime.test.ts`

Find the existing test file. Add 5 new tests inside an existing top-level
`describe(...)` block (the file's main describe — usually named
"createRuntimeServiceContainer" or similar). If no suitable block exists,
add a new top-level `describe` at the end:

```typescript
import {
  InMemoryAgentDefinitionRegistry,
  createAgentDefinitionRegistry
} from "../src/agents/index.js";
import type { AgentDefinitionRegistry } from "@maharudra/agentic-ai-infra-core";

describe("createRuntimeServiceContainer — agentRegistry (Stage 25)", () => {
  it("wires a non-optional agentRegistry into the container", () => {
    // Use a minimal valid config — the same shape your other container
    // tests in this file use. If a `buildConfig()` helper exists, prefer it.
    const result = createRuntimeServiceContainer({
      project: { name: "Test", slug: "test" },
      profiles: ["minimal"]
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.agentRegistry).toBeDefined();
    // count() is the cheapest sanity check that the registry is a real
    // implementation, not a stub.
    expect(result.value.agentRegistry.count()).toBeGreaterThan(0);
  });

  it("default registry contains the six framework defaults", () => {
    const result = createRuntimeServiceContainer({
      project: { name: "Test", slug: "test" },
      profiles: ["minimal"]
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.agentRegistry.count()).toBe(6);
    expect(result.value.agentRegistry.findById("manager")).toBeDefined();
    expect(result.value.agentRegistry.findById("security-reviewer")).toBeDefined();
  });

  it("caller can override agentRegistry via RuntimeStartOptions", () => {
    const custom = new InMemoryAgentDefinitionRegistry().register({
      id: "solo",
      role: "manager"
    });
    const result = createRuntimeServiceContainer(
      { project: { name: "Test", slug: "test" }, profiles: ["minimal"] },
      { agentRegistry: custom }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.agentRegistry).toBe(custom);
    expect(result.value.agentRegistry.count()).toBe(1);
    expect(result.value.agentRegistry.findById("solo")).toBeDefined();
  });

  it("agentRegistry reflects config.agents.agents when set", () => {
    const result = createRuntimeServiceContainer({
      project: { name: "Test", slug: "test" },
      profiles: ["minimal"],
      agents: {
        mode: "single-agent",
        agents: [
          { id: "custom-mgr", role: "manager", description: "Custom" }
        ]
      }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Caller profile is registered alongside the six defaults.
    // Note: "custom-mgr" is a new id (not in defaults), so total is 7.
    expect(result.value.agentRegistry.count()).toBe(7);
    expect(result.value.agentRegistry.findById("custom-mgr")?.description)
      .toBe("Custom");
  });

  it("agentRegistry satisfies the read-only AgentDefinitionRegistry interface", () => {
    // Compile-time + runtime check that the container exposes the interface,
    // not the concrete class. This protects consumers from accidentally
    // calling register() through the container.
    const result = createRuntimeServiceContainer({
      project: { name: "Test", slug: "test" },
      profiles: ["minimal"]
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const asInterface: AgentDefinitionRegistry = result.value.agentRegistry;
    expect(typeof asInterface.list).toBe("function");
    expect(typeof asInterface.findById).toBe("function");
    expect(typeof asInterface.findByRole).toBe("function");
    expect(typeof asInterface.count).toBe("function");
  });
});
```

If the test file's existing structure uses a different config-building
helper, adapt the config-construction call to match local convention.
The semantics of each test (what's asserted) must not change.

---

## CHANGE 4 — `examples/src/vectorless-local/index.ts`

Find the `new SingleAgentExecutor({ ... })` construction (around line 180
in the existing source). The current block looks like:

```typescript
    const executor = new SingleAgentExecutor({
      config: resolvedConfig,
      trajectoryRecorder: container.trajectoryRecorder,
      tokenRecorder: container.tokenRecorder,
      sessionManager: container.sessionManager
    });
```

Add the `agentRegistry` field, threading from the container:

```typescript
    const executor = new SingleAgentExecutor({
      config: resolvedConfig,
      trajectoryRecorder: container.trajectoryRecorder,
      tokenRecorder: container.tokenRecorder,
      sessionManager: container.sessionManager,
      agentRegistry: container.agentRegistry
    });
```

Do not modify anything else in the file.

---

## CHANGE 5 — `examples/src/local-context/index.ts`

Find the `new SingleAgentExecutor({ ... })` construction (around line 271
in the existing source). Apply the same change as in CHANGE 4 — add
`agentRegistry: container.agentRegistry` to the options object.

---

## VERIFICATION

```powershell
pnpm.cmd typecheck
pnpm.cmd build
pnpm.cmd test
pnpm.cmd lint
```

All must pass. Test count should be 449 + 5 = 454.

Common pitfalls:
- `RuntimeServiceContainer` field order matters for readability but does
  not affect typecheck. Keep `agentRegistry` after `evalHarness`.
- If `createRuntimeServiceContainer` is called from tests that destructure
  the returned container, those tests may need re-running but won't break
  — adding a new field to a returned object is non-breaking.
- The example file changes are minimal — just one line added to the
  options object. If the example's `SingleAgentExecutor` construction is
  inside a `try`/`catch` or other control flow, preserve the surrounding
  code exactly.

---

## SELF-REVIEW CHECKLIST

- [ ] `AgentDefinitionRegistry` imported in `runtime/index.ts`
- [ ] `createAgentDefinitionRegistry` imported in `runtime/index.ts`
- [ ] `RuntimeServiceContainer.agentRegistry: AgentDefinitionRegistry` added (NON-OPTIONAL)
- [ ] `RuntimeStartOptions.agentRegistry?: AgentDefinitionRegistry` added (optional)
- [ ] `agentRegistry` auto-built in `createRuntimeServiceContainer()` body, after Stage 24 eval wiring
- [ ] `agentRegistry` included in the returned `ok({...})` object
- [ ] `AgentDefinitionRegistry` imported in `runtime/src/agents/index.ts`
- [ ] `ExecutorOptions.agentRegistry?: AgentDefinitionRegistry` added (optional)
- [ ] Both example files updated — `agentRegistry: container.agentRegistry` added to executor construction
- [ ] 5 new tests added in `runtime/test/runtime.test.ts`
- [ ] `pnpm.cmd typecheck` passes
- [ ] `pnpm.cmd build` passes
- [ ] `pnpm.cmd test` reports ~454 passing
- [ ] `pnpm.cmd lint` passes
- [ ] No executor code modified in this phase (Phase 04 does that)
- [ ] No file outside the FILES TO CHANGE list was modified

---

## WHAT NOT TO DO

- ❌ Do NOT make `RuntimeServiceContainer.agentRegistry` optional — D22 lock; non-optional follows D16 evalStore/evalHarness precedent
- ❌ Do NOT consume `agentRegistry` in any executor in this phase — Phase 04
- ❌ Do NOT modify `agent-harness-phase5.test.ts` — those tests construct executors directly without containers; adding `agentRegistry` there is unnecessary because the field is optional in `ExecutorOptions`
- ❌ Do NOT add MCP tool handlers that expose the registry — Stage 26
- ❌ Do NOT change the signature of `createFrameworkToolHandlers()` — leave that signature exactly as it was after Stage 24
- ❌ Do NOT add the registry to `RuntimeHandle` — `RuntimeHandle` is the surface returned from `start()`, not the container; the registry stays on the container
- ❌ Do NOT add a `dispose()` or `close()` method to the registry — it's in-memory, has no lifecycle resources
- ❌ Do NOT validate `config.agents.agents` for duplicates here — Phase 06 adds that to `DefaultConfigValidator`
- ❌ Do NOT change the order of existing fields on `RuntimeServiceContainer` or `RuntimeStartOptions` — appending is non-breaking; reordering is risky

---

## DONE SIGNAL

```
Stage 25 Phase 03 complete. Test count: [N]/[N] passing.
CI: build ✓ typecheck ✓ test ✓ lint ✓.
Files changed:
  packages/agentic-ai-infra-runtime/src/runtime/index.ts (modified — added agentRegistry to RuntimeServiceContainer + RuntimeStartOptions + factory body)
  packages/agentic-ai-infra-runtime/src/agents/index.ts (modified — added agentRegistry? to ExecutorOptions)
  packages/agentic-ai-infra-runtime/test/runtime.test.ts (modified — 5 new tests for agentRegistry wiring)
  examples/src/vectorless-local/index.ts (modified — pass agentRegistry to SingleAgentExecutor)
  examples/src/local-context/index.ts (modified — pass agentRegistry to SingleAgentExecutor)
Next: Phase 04 — executor enforcement (allowedTools + budgetPolicy).
```

Do not add commentary after this block.
