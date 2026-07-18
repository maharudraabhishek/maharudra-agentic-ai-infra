# Stage 24 — Phase 7: Executor refactor (options object + MultiAgent eval push)
## Claude Code Prompt — MahaRudra Agentic AI Infra

---

## BEFORE YOU START

**Platform:** Windows 11, PowerShell, Node >= 20, **pnpm only**
**CI command:** `pnpm run ci`
**Read first:** `AGENTS.md`, `STATUS.md`, `kb.md`, `packages/agentic-ai-infra-runtime/src/agents/index.ts` (the executor file you are refactoring — scan both `SingleAgentExecutor` (~line 286) and `TokenEfficientMultiAgentExecutor` (~line 495))
**Prerequisite:** Phase 2 complete (`InMemoryEvalStore` available); CI green at ~405 tests
**Expected after this phase:** ~405 tests passing (refactor only, no new tests)

---

## SCOPE — Phase 7 only

Refactor both executor constructors from 6 positional parameters to a single `ExecutorOptions` object (D17). Add `evalStore` to the options. Only `TokenEfficientMultiAgentExecutor` pushes records to the `EvalStore` after a successful run — `SingleAgentExecutor` accepts the option for forward compatibility but does NOT push (the eval input shape requires `RuntimeMultiAgentRunReport`, which single-agent runs don't produce).

This is a breaking change to two public constructors. All 5 known call sites (3 in tests, 2 in examples) are updated in the same change set.

---

## VERIFIED FACTS (do not re-derive)

- `SingleAgentExecutor` constructor today: `(config, trajectoryRecorder?, tokenRecorder = new TokenUsageRecorder(), sessionManager?, sessionId?, observability = silentObservabilitySink)`
- `TokenEfficientMultiAgentExecutor` constructor today: **same 6 positional params**
- `runAgentRuntimeEvals` is **synchronous** and returns `QualityReport` (no Promise, no throws)
- The eval input field `report` is typed `RuntimeMultiAgentRunReport | undefined`. `SingleAgentRunReport` does NOT satisfy it
- MultiAgent's success path ends with `return ok({ runId, traceId, task, routedRoles, sharedContextPacketId, roleSlices, outputs, synthesis, tokenUsage, naiveTokenEstimate, sharedContextTokenEstimate, estimatedTokenSavings, warnings, contextBuildCount, noNetworkCalls });`

---

## FILES TO CHANGE

```
packages/agentic-ai-infra-runtime/src/agents/index.ts                 MODIFY (refactor 2 classes, add push)
packages/agentic-ai-infra-runtime/test/agent-harness-phase5.test.ts   MODIFY (3 call sites)
examples/src/vectorless-local/index.ts                                MODIFY (1 call site)
examples/src/local-context/index.ts                                   MODIFY (1 call site)
```

---

## CHANGE 1 — `runtime/src/agents/index.ts`

### 1a. Add the `ExecutorOptions` type

Place this near the top of the file, AFTER the existing `MultiAgentExecutorInput` type (around line 79) and BEFORE `classifyTask`:

```typescript
/**
 * Construction options shared by both agent executors.
 *
 * Both `SingleAgentExecutor` and `TokenEfficientMultiAgentExecutor` accept
 * this single options object instead of 6 positional parameters. All fields
 * except `config` are optional.
 *
 * `evalStore` is accepted by both executors but only `TokenEfficientMultiAgentExecutor`
 * pushes records — single-agent runs cannot satisfy `runAgentRuntimeEvals`'s
 * input shape (Stage 25 adds single-agent eval via `AgentDefinition.evalRules`).
 */
export type ExecutorOptions = {
  readonly config: AgenticInfraProjectConfig | ResolvedProjectConfig;
  readonly trajectoryRecorder?: TrajectoryRecorder;
  readonly tokenRecorder?: TokenUsageRecorder;
  readonly sessionManager?: SessionManager;
  readonly sessionId?: string;
  readonly observability?: RuntimeObservabilitySink;
  /**
   * Optional eval store. When provided, `TokenEfficientMultiAgentExecutor`
   * pushes one `EvalRunRecord` per successful run after constructing the
   * report and before returning.
   *
   * `SingleAgentExecutor` accepts this option for forward compatibility but
   * does not push — Stage 25 adds single-agent eval via `AgentDefinition.evalRules`.
   */
  readonly evalStore?: EvalStore;
};
```

You will need these imports at the top of the file if not already present:

```typescript
import type { EvalStore } from "@maharudra/agentic-ai-infra-core";
import { runAgentRuntimeEvals } from "../evals/index.js";
```

### 1b. Refactor `SingleAgentExecutor` constructor

Locate `export class SingleAgentExecutor` (~line 286). Replace the existing constructor with:

```typescript
  /**
   * Creates a single-agent executor from an options object.
   *
   * Stage 24 refactored this from 6 positional params (D17). The `evalStore`
   * option is accepted for forward compatibility but is not used in Stage 24 —
   * `runAgentRuntimeEvals` requires `RuntimeMultiAgentRunReport`, which
   * single-agent runs do not produce. Stage 25 adds single-agent eval via
   * `AgentDefinition.evalRules`.
   *
   * @param options - Construction options. `config` is required; all other
   *   fields are optional. `tokenRecorder` defaults to a fresh
   *   `TokenUsageRecorder`. `observability` defaults to `silentObservabilitySink`.
   */
  constructor(private readonly options: ExecutorOptions) {}

  private get config(): AgenticInfraProjectConfig | ResolvedProjectConfig {
    return this.options.config;
  }

  private get trajectoryRecorder(): TrajectoryRecorder | undefined {
    return this.options.trajectoryRecorder;
  }

  private get tokenRecorder(): TokenUsageRecorder {
    return this.options.tokenRecorder ?? this.defaultTokenRecorder;
  }

  private readonly defaultTokenRecorder = new TokenUsageRecorder();

  private get sessionManager(): SessionManager | undefined {
    return this.options.sessionManager;
  }

  private get sessionId(): string | undefined {
    return this.options.sessionId;
  }

  private get observability(): RuntimeObservabilitySink {
    return this.options.observability ?? silentObservabilitySink;
  }
```

The accessor pattern preserves all internal usage of `this.config`, `this.trajectoryRecorder`, etc. without touching the rest of the class body. The `defaultTokenRecorder` field ensures the same instance is returned on each `get tokenRecorder()` access (preserves prior behavior).

### 1c. Refactor `TokenEfficientMultiAgentExecutor` constructor

Locate `export class TokenEfficientMultiAgentExecutor` (~line 495). Apply the same refactor:

```typescript
  /**
   * Creates a multi-agent executor from an options object.
   *
   * Stage 24 refactored this from 6 positional params (D17). The `evalStore`
   * option, when set, causes `execute()` to push one `EvalRunRecord` per
   * successful run after the report is built and before returning.
   */
  constructor(private readonly options: ExecutorOptions) {}

  private get config(): AgenticInfraProjectConfig | ResolvedProjectConfig {
    return this.options.config;
  }

  private get trajectoryRecorder(): TrajectoryRecorder | undefined {
    return this.options.trajectoryRecorder;
  }

  private get tokenRecorder(): TokenUsageRecorder {
    return this.options.tokenRecorder ?? this.defaultTokenRecorder;
  }

  private readonly defaultTokenRecorder = new TokenUsageRecorder();

  private get sessionManager(): SessionManager | undefined {
    return this.options.sessionManager;
  }

  private get sessionId(): string | undefined {
    return this.options.sessionId;
  }

  private get observability(): RuntimeObservabilitySink {
    return this.options.observability ?? silentObservabilitySink;
  }
```

### 1d. Add the eval push in `TokenEfficientMultiAgentExecutor.execute()`

Locate the final `return ok({...});` block in `execute()` (~line 713). It currently looks like:

```typescript
    return ok({
      runId: ids.runId,
      traceId: ids.traceId,
      task,
      routedRoles,
      sharedContextPacketId: packet.id,
      roleSlices,
      outputs,
      synthesis,
      tokenUsage: actualUsage,
      naiveTokenEstimate,
      sharedContextTokenEstimate: sharedUsage.inputTokens,
      estimatedTokenSavings: Math.max(0, naiveTokenEstimate - actualUsage.totalTokens),
      warnings: contextPackage.warnings,
      contextBuildCount: 1,
      noNetworkCalls: true
    });
```

Replace it with:

```typescript
    const runReport: RuntimeMultiAgentRunReport = {
      runId: ids.runId,
      traceId: ids.traceId,
      task,
      routedRoles,
      sharedContextPacketId: packet.id,
      roleSlices,
      outputs,
      synthesis,
      tokenUsage: actualUsage,
      naiveTokenEstimate,
      sharedContextTokenEstimate: sharedUsage.inputTokens,
      estimatedTokenSavings: Math.max(0, naiveTokenEstimate - actualUsage.totalTokens),
      warnings: contextPackage.warnings,
      contextBuildCount: 1,
      noNetworkCalls: true
    };

    // Stage 24: push one EvalRunRecord per successful run. Non-fatal —
    // EvalStore.push does not throw, and runAgentRuntimeEvals is synchronous
    // and never throws. Suite-level rules (AgentEvaluator) re-evaluate with
    // configured `requiredRoles`, `forbiddenTools`, and `hardBudget`.
    if (this.options.evalStore) {
      const evalReport = runAgentRuntimeEvals({ report: runReport });
      this.options.evalStore.push({
        runId: ids.runId,
        traceId: ids.traceId,
        threadId: activeThreadId,
        recordedAt: new Date().toISOString(),
        report: evalReport
      });
    }

    return ok(runReport);
```

Verify `activeThreadId` is the correct local variable name in scope at this point in the source (it is, based on the existing thread-management logic earlier in `execute()`). If the local is named differently (e.g. `threadId`), use that name. Do not introduce a new variable.

---

## CHANGE 2 — `runtime/test/agent-harness-phase5.test.ts`

Update all 3 executor instantiations to pass options objects.

### Site 1 (~line 193)

Replace:
```typescript
const executor = new SingleAgentExecutor(
  resolvedConfig,
  trajectoryRecorder,
  tokenRecorder,
  sessionManager
);
```

With:
```typescript
const executor = new SingleAgentExecutor({
  config: resolvedConfig,
  trajectoryRecorder,
  tokenRecorder,
  sessionManager
});
```

### Site 2 (~line 214) and Site 3 (~line 262)

Both are `TokenEfficientMultiAgentExecutor`. Apply the same shape:

```typescript
const executor = new TokenEfficientMultiAgentExecutor({
  config: resolvedConfig,
  trajectoryRecorder,
  tokenRecorder,
  sessionManager
});
```

Use whatever variable names the existing code uses for each call site — do not rename. Just rewrap the args into the options object.

---

## CHANGE 3 — `examples/src/vectorless-local/index.ts`

Locate the existing line (~line 180):

```typescript
const executor = new SingleAgentExecutor(
  resolvedConfig,
  container.trajectoryRecorder,
  container.tokenRecorder,
  container.sessionManager
);
```

Replace with:

```typescript
const executor = new SingleAgentExecutor({
  config: resolvedConfig,
  trajectoryRecorder: container.trajectoryRecorder,
  tokenRecorder: container.tokenRecorder,
  sessionManager: container.sessionManager
});
```

---

## CHANGE 4 — `examples/src/local-context/index.ts`

Locate the existing line (~line 271):

```typescript
const executor = new SingleAgentExecutor(
  resolvedConfig,
  container.trajectoryRecorder,
  container.tokenRecorder,
  container.sessionManager,
  exampleSessionId
);
```

Replace with:

```typescript
const executor = new SingleAgentExecutor({
  config: resolvedConfig,
  trajectoryRecorder: container.trajectoryRecorder,
  tokenRecorder: container.tokenRecorder,
  sessionManager: container.sessionManager,
  sessionId: exampleSessionId
});
```

---

## SELF-REVIEW CHECKLIST

- [ ] `ExecutorOptions` type defined with `config` required and 6 optional fields including `evalStore`
- [ ] `EvalStore` imported from core; `runAgentRuntimeEvals` imported from `../evals/index.js`
- [ ] Both `SingleAgentExecutor` and `TokenEfficientMultiAgentExecutor` constructors take ONE `ExecutorOptions` parameter
- [ ] Private accessor pattern preserves all `this.config` / `this.trajectoryRecorder` / etc. references inside class bodies
- [ ] `defaultTokenRecorder` field ensures `tokenRecorder` returns the same instance per access
- [ ] `TokenEfficientMultiAgentExecutor.execute()` builds `runReport`, then conditionally pushes, then `return ok(runReport)`
- [ ] The push uses `this.options.evalStore` (NOT `this.evalStore`)
- [ ] The push uses `activeThreadId` (whatever the local var is named in the existing source)
- [ ] `SingleAgentExecutor.execute()` is unchanged below the constructor — no push, no eval call
- [ ] All 3 test call sites updated to options object
- [ ] Both example call sites updated to options object
- [ ] `pnpm typecheck` passes — no positional-constructor errors remain
- [ ] All 405 existing tests still pass (no new tests in this phase)
- [ ] `pnpm run ci` passes: build ✓ typecheck ✓ test ✓ lint ✓
- [ ] JSDoc on `ExecutorOptions` and both refactored constructors

---

## WHAT NOT TO DO

- Do NOT add a `try/catch` around `runAgentRuntimeEvals` or `evalStore.push` — neither throws
- Do NOT push from `SingleAgentExecutor` — its return type does not satisfy the eval input shape
- Do NOT refactor `execute()` bodies — only the constructors and the final `return ok(...)` block in MultiAgent
- Do NOT add a backward-compatible positional constructor overload — clean break is correct (D17)
- Do NOT rename any internal variable inside the existing class bodies — only constructor signatures change
- Do NOT update docs in this phase (`docs/08-examples/*.md` ships in Phase 11)
- Do NOT add new tests in this phase — verification is via existing tests still passing after the refactor

---

## DONE SIGNAL

```
Stage 24 Phase 7 complete.
Test count: [N]/[N] passing (target ~405, unchanged).
CI: build ✓ typecheck ✓ test ✓ lint ✓
Files changed: 4
Next: Phase 8 — MCP tools (upgrade evals.run + add evals.agent-eval)
```
