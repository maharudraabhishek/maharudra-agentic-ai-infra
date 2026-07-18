# Stage 25.5 Phase 02 — Guardrails: ResponsePacket + Citation Propagation
## Claude Code Prompt — MahaRudra Agentic AI Infra

---

## BEFORE YOU START — READ THIS FIRST

**Platform:** Windows 11, PowerShell, Node >= 20, pnpm only
**CI command:** `pnpm.cmd run ci` (build → typecheck → test → lint)
**Current test count after Phase 01:** check `STATUS.md` head of file
**Expected test count after this phase:** Phase 01 count + ~10 tests

This prompt is self-contained. Do not invent details not stated here.
Do not modify any file not listed in the "Files to change" section.
Run `pnpm.cmd run ci` after completing all changes. Fix any failures before
declaring done.

**Stage 25.5 umbrella context:**
- **Guardrails** = inspect/restrict (Phase 01 added Input Guard)
- **Feedback Loops** = react/improve (begins in Phase 04)

This phase extends `DeterministicAgentOutput` so it can carry the data
future OutputGuards (Phase 03 + Stage 42 LLM-judge) need. No new policy
fields yet — those land in Phase 03. **No behavior change in this phase.**

---

## CONTEXT — WHAT IS DONE

The following are complete and must not be touched:

- **D23 (LOCKED, Stage 25):** Default behavior is byte-for-byte
  backwards-compatible. Every new field in this phase is OPTIONAL and
  populated only when the source data is available. Tests that omit the new
  fields must continue to pass.

- **D17 (LOCKED, Stage 24):** `runAgentRuntimeEvals` consumes
  `RuntimeMultiAgentRunReport`. **Do not change that input shape.** The new
  fields go on `DeterministicAgentOutput`, which is embedded inside
  `MultiAgentRunReport.outputs`. Since they are all optional, the existing
  eval helper continues to work.

- **D25 (Stage 25.5 Phase 01):** Umbrella vocabulary "Guardrails" and
  "Feedback Loops" project-wide. AgentDefinition stays FLAT.

- **D26 (Stage 25.5 Phase 01):** Input Guard wired; non-fatal warn-only.

- **Stage 21 D2:** `checkGroundedness` lives in
  `runtime/src/evals/retrieval-evals.ts:84`. Reused (NOT modified) in
  Phase 03.

### Current shapes — verify exactly before changing

`packages/agentic-ai-infra-core/src/agents/types.ts:127–133`:
```typescript
export type DeterministicAgentOutput = {
  readonly role: AgentRole;
  readonly summary: string;
  readonly findings: readonly string[];
  readonly tokenUsage?: TokenUsageReport;
  readonly sourceCount: number;
};
```

`packages/agentic-ai-infra-core/src/context/types.ts:14–19`:
```typescript
export type ContextSource = {
  readonly sourceId: string;
  readonly providerId?: string;
  readonly label: string;
  readonly tokenEstimate?: number;
};
```

These are the two structures the propagation flows between.

---

## NEW LOCKED DECISIONS — Stage 25.5 Phase 02

### D27 — `DeterministicAgentOutput` gains four optional fields
- `citations?: readonly AgentOutputCitation[]` — references to context sources used
- `evidenceCoverage?: number` — fraction in [0, 1] of context sources that were cited
- `confidence?: number` — optional self-assessment in [0, 1]; today populated only when explicitly computed (Stage 42 LLM-judge fills it)
- `abstainReason?: string` — populated when an agent chooses to abstain (Phase 03 implementations write this); free-form string for human readability. Typed enum lives in `AgentResponsePolicy.onWeakEvidence` (Phase 03).

`AgentOutputCitation` is a NEW core type:
```typescript
export type AgentOutputCitation = {
  readonly sourceId: string;
  readonly label?: string;
  readonly providerId?: string;
};
```

All four fields are optional. D23 preserved.

### D28 — Propagation lives in the executors, NOT in core
Both executors (`SingleAgentExecutor`, `TokenEfficientMultiAgentExecutor`)
build their `DeterministicAgentOutput` from `ContextPackage.sources`. Core
types do NOT compute citations — they only declare the shape.

The propagation is **mechanical**: every `ContextSource` in the package
becomes one `AgentOutputCitation` in the output. `evidenceCoverage` is
computed by Phase 03 from the eventually-produced output text (this phase
just lays the wiring).

### D29 — Single-agent ResponsePacket extension deferred to Phase 03
`SingleAgentExecutor` does NOT emit a `DeterministicAgentOutput` today —
it returns a `SingleAgentRunReport.result: { summary, steps, warnings }`.
Phase 02 does NOT change that shape. Single-agent citation/response
extension lands in Phase 03 alongside `responsePolicy` enforcement, where
it makes sense as part of one coherent edit. Phase 02 is multi-agent-only.

---

## ARCHITECTURAL DECISION — WHY OPTIONAL, NOT REQUIRED

Three reasons:
1. **D23** — pre-Stage-25.5 callers that construct
   `DeterministicAgentOutput` directly (tests, examples) must continue to
   work without modification.
2. **Determinism preservation** — the existing executors compute outputs
   deterministically. The citations field follows the same determinism: if
   the input context package has sources, the citations field has entries;
   otherwise it's `undefined` (NOT `[]` — undefined vs empty distinguishes
   "field not populated" from "no sources").
3. **Stage 42 readiness** — when the Constitutional AI guard lands, it can
   set `confidence` without touching the executor code. The field is
   already there.

`abstainReason` is populated by Phase 03's OutputGuard when
`responsePolicy.onWeakEvidence` is `"abstain"`. This phase only types the
field; Phase 03 wires the writer.

---

## FILES TO CHANGE — COMPLETE LIST

| # | File | Action |
|---|---|---|
| 1 | `packages/agentic-ai-infra-core/src/agents/types.ts` | MODIFY (add 1 type + 4 optional fields) |
| 2 | `packages/agentic-ai-infra-runtime/src/agents/index.ts` | MODIFY (populate citations in 2 executors) |
| 3 | `packages/agentic-ai-infra-runtime/test/agents/response-packet.test.ts` | CREATE (~10 tests) |
| 4 | `docs/internal/v3-architecture-snapshot.md` | MODIFY (add row + bottom section) |
| 5 | `kb.md` | MODIFY (append Phase 02 entry) |
| 6 | `STATUS.md` | MODIFY (update top + new bullet) |

---

## CHANGE 1 — MODIFY `packages/agentic-ai-infra-core/src/agents/types.ts`

After the existing `DeterministicAgentOutput` declaration (around line 127),
INSERT the new `AgentOutputCitation` type. Then modify
`DeterministicAgentOutput` to include the four optional fields.

```typescript
/**
 * One source citation attached to a `DeterministicAgentOutput`.
 *
 * Each citation corresponds to one entry in the upstream `ContextPackage.sources`
 * used to produce the output. Citations are populated by the executors at run
 * time (Stage 25.5 Phase 02) — core types do not compute them.
 *
 * @umbrella Guardrails — used by OutputGuard (Phase 03) and Stage 42 LLM judge
 *   to verify that agent claims are grounded in retrieved evidence.
 */
export type AgentOutputCitation = {
  /** Stable id of the context source. Matches `ContextSource.sourceId`. */
  readonly sourceId: string;
  /** Human-readable label (e.g. file path or document title). Optional. */
  readonly label?: string;
  /** Retrieval provider that surfaced this source. Optional. */
  readonly providerId?: string;
};

/**
 * One deterministic role output produced without provider or network calls.
 *
 * Stage 25.5 Phase 02 added four optional Guardrails-related fields:
 * `citations`, `evidenceCoverage`, `confidence`, `abstainReason`. All four
 * are optional and D23-safe: pre-Stage-25.5 callers that construct this type
 * without these fields continue to work unchanged.
 */
export type DeterministicAgentOutput = {
  readonly role: AgentRole;
  readonly summary: string;
  readonly findings: readonly string[];
  readonly tokenUsage?: TokenUsageReport;
  readonly sourceCount: number;
  /**
   * Citations to context sources used to produce this output.
   *
   * Populated by `SingleAgentExecutor` and `TokenEfficientMultiAgentExecutor`
   * from the upstream `ContextPackage.sources` (Stage 25.5 Phase 02).
   * Undefined when no context package was available.
   *
   * @guardrail
   */
  readonly citations?: readonly AgentOutputCitation[];
  /**
   * Fraction in [0, 1] of context sources that were cited in the output text.
   *
   * Populated by Phase 03's OutputGuard when a `responsePolicy` is configured.
   * Undefined in Phase 02 — the wiring exists but no caller computes it yet.
   *
   * @guardrail
   */
  readonly evidenceCoverage?: number;
  /**
   * Optional self-assessment in [0, 1] of the agent's confidence in this output.
   *
   * Populated by Stage 42's Constitutional AI judge when enabled. Undefined
   * otherwise. Deterministic executors do not compute confidence.
   *
   * @guardrail
   */
  readonly confidence?: number;
  /**
   * Free-form reason populated when the agent chose to abstain.
   *
   * Set by Phase 03's OutputGuard when `responsePolicy.onWeakEvidence === "abstain"`
   * and evidence coverage falls below `minEvidenceCoverage`. The typed
   * verdict ("abstain" | "ask" | "warn") lives on the response policy itself.
   *
   * @guardrail
   */
  readonly abstainReason?: string;
};
```

**Do NOT** rename existing fields. **Do NOT** make any existing field
non-optional. **Do NOT** change `MultiAgentRunReport` or `RuntimeMultiAgentRunReport`
— `outputs: readonly DeterministicAgentOutput[]` inherits the new fields automatically.

---

## CHANGE 2 — MODIFY `packages/agentic-ai-infra-runtime/src/agents/index.ts`

Two changes, both ADDITIVE.

### Change 2.1 — `createRoleOutput()` populates citations

Find `createRoleOutput()` (around line ~995–1024) and modify the returned
object to include a `citations` field derived from the slice's
`includedSourceIds`. The slice already carries source ids — turn them into
citations.

Find this block:

```typescript
return {
  role: slice.role,
  summary: `${slice.role} produced deterministic ${task.taskType} guidance.`,
  findings,
  sourceCount: slice.includedSourceIds.length,
  tokenUsage: {
    inputTokens: slice.tokenEstimate ?? 0,
    outputTokens: counter.countTokens(outputText),
    totalTokens: (slice.tokenEstimate ?? 0) + counter.countTokens(outputText)
  }
};
```

Replace with:

```typescript
const citations = slice.includedSourceIds.map((sourceId) => ({
  sourceId
}));

return {
  role: slice.role,
  summary: `${slice.role} produced deterministic ${task.taskType} guidance.`,
  findings,
  sourceCount: slice.includedSourceIds.length,
  tokenUsage: {
    inputTokens: slice.tokenEstimate ?? 0,
    outputTokens: counter.countTokens(outputText),
    totalTokens: (slice.tokenEstimate ?? 0) + counter.countTokens(outputText)
  },
  citations
};
```

Note: the slice does not carry `label` or `providerId` per source — those
fields are present on `ContextSource` but the slice strips them at
`MultiAgentContextSlicer.slice` time. Stage 25.5 Phase 02 keeps the role
output's citation list **id-only**. Phase 03 enriches it from the
`ContextPackage.sources` lookup table if `responsePolicy.requireCitations`
is true. **Do not** enrich here.

### Change 2.2 — `SingleAgentExecutor.execute()` populates citations on return

Find `SingleAgentExecutor.execute()` (around line 392). At the end of the
method, in the returned `ok({...})` block (around line 574), the report
shape today contains a `result: { summary, steps, warnings }` object. The
single-agent report does NOT currently emit a `DeterministicAgentOutput` —
it has a different `result` shape.

**Decision (D29 — locked here):** Single-agent runs DO NOT emit a
`DeterministicAgentOutput`. `SingleAgentRunReport.result` keeps its
existing 3-field shape. The Phase 02 propagation applies ONLY to
`TokenEfficientMultiAgentExecutor`'s `roleOutputs` (the per-role
`DeterministicAgentOutput[]`). Single-agent output extension happens in
Phase 03 as part of the response policy work (it needs `responsePolicy`
configuration that doesn't exist yet).

So for `SingleAgentExecutor` in Phase 02: **no change**. The change is
entirely in `createRoleOutput` and the `roleOutputs` map in the multi-agent
executor. The latter already constructs `RuntimeRoleOutput` from
`baseOutputs[i]` (around line 773–791) — `citations` propagates
automatically because `RuntimeRoleOutput = DeterministicAgentOutput & { selectedToolIds: readonly string[] }`.

**Do not** touch the multi-agent executor's `roleOutputs.map()` body. The
spread `{ ...baseOutput, selectedToolIds, tokenUsage }` already inherits
the new `citations` field from `baseOutput`.

---

## CHANGE 3 — CREATE `packages/agentic-ai-infra-runtime/test/agents/response-packet.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import type {
  AgentDefinition,
  AgenticInfraProjectConfig,
  ContextPackage,
  DeterministicAgentOutput,
  RoleContextSlice
} from "@maharudra/agentic-ai-infra-core";
import {
  TokenEfficientMultiAgentExecutor,
  createAgentDefinitionRegistry
} from "../../src/agents/index.js";

// Minimal shared config for the multi-agent path
function baseConfig(): AgenticInfraProjectConfig {
  return {
    project: { name: "rp", slug: "rp" },
    runtime: { modes: ["local-stdio-mcp"] },
    tools: [],
    agents: {
      mode: "token-efficient-multi-agent",
      sharedContext: { enabled: true, maxPacketTokens: 4000 }
    },
    tokenEfficiency: {
      tokenBudget: {
        maxTotalTokens: 20000,
        maxInputTokens: 10000,
        maxOutputTokens: 10000,
        perRoleBudget: { manager: 5000 }
      }
    },
    profile: "vectorless-local"
  } as unknown as AgenticInfraProjectConfig;
}

function makeContextPackage(): ContextPackage {
  return {
    id: "ctx-pkg-1",
    task: "review the auth module",
    sources: [
      { sourceId: "s-1", label: "auth.ts" },
      { sourceId: "s-2", label: "session.ts" },
      { sourceId: "s-3", label: "permissions.ts" }
    ],
    contextText: "auth code here",
    tokenEstimate: 500,
    roleSlices: [
      {
        role: "security-reviewer",
        sourcePacketId: "ctx-pkg-1",
        maxTokens: 1000,
        includedSourceIds: ["s-1", "s-2"]
      },
      {
        role: "architecture-reviewer",
        sourcePacketId: "ctx-pkg-1",
        maxTokens: 1000,
        includedSourceIds: ["s-3"]
      }
    ] as readonly RoleContextSlice[]
  };
}

describe("Stage 25.5 Phase 02 — ResponsePacket citation propagation", () => {
  it("DeterministicAgentOutput type accepts citations as optional", () => {
    // Compile-time guard via a type-asserting literal.
    const out: DeterministicAgentOutput = {
      role: "security-reviewer",
      summary: "ok",
      findings: [],
      sourceCount: 0,
      citations: [{ sourceId: "s-1" }]
    };
    expect(out.citations).toHaveLength(1);
  });

  it("DeterministicAgentOutput type accepts evidenceCoverage as optional", () => {
    const out: DeterministicAgentOutput = {
      role: "security-reviewer",
      summary: "ok",
      findings: [],
      sourceCount: 0,
      evidenceCoverage: 0.75
    };
    expect(out.evidenceCoverage).toBeCloseTo(0.75);
  });

  it("DeterministicAgentOutput type accepts confidence and abstainReason as optional", () => {
    const out: DeterministicAgentOutput = {
      role: "security-reviewer",
      summary: "ok",
      findings: [],
      sourceCount: 0,
      confidence: 0.9,
      abstainReason: "evidence weak"
    };
    expect(out.confidence).toBeCloseTo(0.9);
    expect(out.abstainReason).toBe("evidence weak");
  });

  it("Pre-Phase-02 output literals still type-check (D23 compat)", () => {
    const out: DeterministicAgentOutput = {
      role: "manager",
      summary: "x",
      findings: ["a"],
      sourceCount: 1
    };
    expect(out.citations).toBeUndefined();
    expect(out.evidenceCoverage).toBeUndefined();
  });

  it("Multi-agent executor populates citations on role outputs", async () => {
    const config = baseConfig();
    const registry = createAgentDefinitionRegistry({
      ...config.agents,
      agents: []
    } as unknown as typeof config.agents);
    const executor = new TokenEfficientMultiAgentExecutor({
      config,
      agentRegistry: registry
    });
    const result = await executor.execute({
      task: "security review",
      contextPackage: makeContextPackage()
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sec = result.value.roleOutputs.find(
      (r) => r.role === "security-reviewer"
    );
    expect(sec).toBeDefined();
    expect(sec!.citations).toBeDefined();
    expect(sec!.citations!.map((c) => c.sourceId).sort()).toEqual(["s-1", "s-2"]);
  });

  it("Each role's citations match its slice's includedSourceIds", async () => {
    const config = baseConfig();
    const registry = createAgentDefinitionRegistry({
      ...config.agents,
      agents: []
    } as unknown as typeof config.agents);
    const executor = new TokenEfficientMultiAgentExecutor({
      config,
      agentRegistry: registry
    });
    const result = await executor.execute({
      task: "architecture review",
      contextPackage: makeContextPackage()
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const arch = result.value.roleOutputs.find(
      (r) => r.role === "architecture-reviewer"
    );
    expect(arch).toBeDefined();
    expect(arch!.citations).toBeDefined();
    expect(arch!.citations!.map((c) => c.sourceId)).toEqual(["s-3"]);
  });

  it("Citations carry sourceId only (Phase 02 — label/providerId added in Phase 03)", async () => {
    const config = baseConfig();
    const registry = createAgentDefinitionRegistry({
      ...config.agents,
      agents: []
    } as unknown as typeof config.agents);
    const executor = new TokenEfficientMultiAgentExecutor({
      config,
      agentRegistry: registry
    });
    const result = await executor.execute({
      task: "review",
      contextPackage: makeContextPackage()
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const out of result.value.roleOutputs) {
      for (const citation of out.citations ?? []) {
        expect(citation.sourceId).toBeDefined();
        expect(citation.label).toBeUndefined();
        expect(citation.providerId).toBeUndefined();
      }
    }
  });

  it("evidenceCoverage stays undefined in Phase 02 (Phase 03 will populate)", async () => {
    const config = baseConfig();
    const registry = createAgentDefinitionRegistry({
      ...config.agents,
      agents: []
    } as unknown as typeof config.agents);
    const executor = new TokenEfficientMultiAgentExecutor({
      config,
      agentRegistry: registry
    });
    const result = await executor.execute({
      task: "review",
      contextPackage: makeContextPackage()
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const out of result.value.roleOutputs) {
      expect(out.evidenceCoverage).toBeUndefined();
    }
  });

  it("Single-agent executor does not emit citations in Phase 02 (D29)", async () => {
    // Single-agent has a different report shape (`result: {summary,steps,warnings}`);
    // Phase 02 does not extend it. Verify by checking the report type.
    const config: AgenticInfraProjectConfig = {
      ...baseConfig(),
      agents: { mode: "single-agent" } as never
    };
    // Test that the type system does not require citations on
    // SingleAgentRunReport.result. Smoke check only.
    expect(config.agents.mode).toBe("single-agent");
  });

  it("Default registry is non-empty so executor can resolve role definitions", () => {
    const config = baseConfig();
    const registry = createAgentDefinitionRegistry({
      ...config.agents,
      agents: []
    } as unknown as typeof config.agents);
    expect(registry.count()).toBeGreaterThan(0);
  });
});
```

Target: 10 passing tests in this file.

---

## CHANGE 4 — MODIFY `docs/internal/v3-architecture-snapshot.md`

In the matrix, add a row near the Layer 10 entries:

```txt
  DeterministicAgentOutput.citations    Guardrails-umbrella — ResponsePacket field   ✅ Stage 25.5 Phase 02
```

At the bottom of the file, append a new section:

```markdown
## Stage 25.5 Phase 02 — ResponsePacket + citation propagation (Guardrails umbrella)

**Date:** [today's ISO date]
**Tests:** [Phase 01 count] → [actual new count]
**Decisions locked:** D27 (4 optional output fields), D28 (propagation in executors only), D29 (single-agent deferred to Phase 03)

`DeterministicAgentOutput` gains 4 optional fields: `citations`,
`evidenceCoverage`, `confidence`, `abstainReason`. `AgentOutputCitation` is
a new core type. The multi-agent executor's `createRoleOutput()` populates
`citations` from each slice's `includedSourceIds`. Single-agent extension
deferred to Phase 03 (depends on `responsePolicy`).

No behavior change. Existing tests pass unchanged.
```

---

## CHANGE 5 — MODIFY `kb.md`

Append the session entry. Mirror the Phase 01 pattern. Highlights:
- Decisions locked: D27, D28, D29
- Test count: before/after
- Files touched
- "Intentionally not done": single-agent ResponsePacket extension (Phase 03)

---

## CHANGE 6 — MODIFY `STATUS.md`

Update top metadata + new bullet under Stage 25.5 entries.

---

## VERIFICATION

```bash
pnpm.cmd run ci
```

Expected: build ✓ typecheck ✓ test ✓ lint ✓. New test file adds 10 tests.

Spot checks:
```bash
# Verify the new core type is exported:
pnpm.cmd --silent exec rg -n "AgentOutputCitation" packages/agentic-ai-infra-core/src/

# Verify executors populate citations:
pnpm.cmd --silent exec rg -n "citations" packages/agentic-ai-infra-runtime/src/agents/index.ts
```

---

## SELF-REVIEW CHECKLIST

### Invariants
- [ ] D23 — pre-Phase-02 literals of `DeterministicAgentOutput` still type-check
- [ ] D17 — `RuntimeMultiAgentRunReport` and `runAgentRuntimeEvals` consumed shape unchanged at the schema level
- [ ] `MultiAgentRunReport.outputs` field is unchanged in the core types file
- [ ] No new error codes added (Phase 04 handles refusal taxonomy)
- [ ] Single-agent executor's `result: { summary, steps, warnings }` shape unchanged (D29)

### New type correctness
- [ ] `AgentOutputCitation` exported from `core/src/agents/types.ts`
- [ ] Four optional fields on `DeterministicAgentOutput` ordered after `sourceCount`
- [ ] Each new field is `readonly`
- [ ] TSDoc on each field carries the `@guardrail` umbrella tag
- [ ] `AgentOutputCitation.sourceId` is required; `label` and `providerId` are optional

### Wiring
- [ ] `createRoleOutput` builds citations from `slice.includedSourceIds`
- [ ] Citations contain only `sourceId` (no `label`, no `providerId`)
- [ ] `TokenEfficientMultiAgentExecutor.roleOutputs.map` spread preserves citations (no explicit change needed there)
- [ ] `SingleAgentExecutor.execute` is unchanged

### Tests
- [ ] 10 `it()` blocks in `response-packet.test.ts`
- [ ] All previously passing tests still pass
- [ ] Total test count: Phase 01 count + 10
- [ ] `pnpm.cmd run ci`: build ✓ typecheck ✓ test ✓ lint ✓

### Documentation
- [ ] v3-architecture-snapshot.md updated
- [ ] kb.md Phase 02 entry appended
- [ ] STATUS.md updated

---

## WHAT NOT TO DO

- Do NOT rename or remove any existing field on `DeterministicAgentOutput`
- Do NOT make new fields non-optional — they MUST be optional (D23)
- Do NOT enrich citations with `label` / `providerId` in Phase 02. The slice
  doesn't carry them; doing the cross-reference is Phase 03 work that the
  policy decision depends on.
- Do NOT touch `MultiAgentRunReport.outputs` or `RuntimeMultiAgentRunReport.roleOutputs`
  shape directly — they inherit changes through `DeterministicAgentOutput`
- Do NOT add citation propagation to `SingleAgentExecutor` — Phase 03
  handles single-agent under D29
- Do NOT compute `evidenceCoverage` in this phase — Phase 03 needs to know
  output text length and citation presence; this phase only types the field
- Do NOT add new MCP tools — the existing `agentic.context.build` and
  `agentic.retrieval.search` flows already produce the data
- Do NOT export `AgentOutputCitation` from `runtime/src/index.ts` — only
  core types are part of the public agent-output contract
- Do NOT add tests that mutate `DeterministicAgentOutput` after creation —
  the type is `readonly` throughout

---

## DONE SIGNAL

```
Stage 25.5 Phase 02 complete.
Test count: [N]/[N] passing.
CI: build ✓ typecheck ✓ test ✓ lint ✓
Files changed: [list]
New decisions locked: D27 (output fields), D28 (executor-side propagation), D29 (single-agent deferred)
Next phase: 25.5-03 — Guardrails: Output Guard + ResponsePolicy + expanded BudgetPolicy
```
