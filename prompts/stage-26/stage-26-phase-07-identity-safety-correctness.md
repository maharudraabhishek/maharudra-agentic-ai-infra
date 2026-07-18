# Stage 26 Phase 07 — Identity and safety correctness

## Objective

Repair the production-correctness gaps found after the original Stage 26
closeout. The phase makes registered agent identity authoritative from routing
through execution and reporting, restores usable exact approval, enforces
output-policy actions, preserves refusal taxonomy, and contains injected seam
exceptions inside `FrameworkResult`.

## Concept

Canonical identity means every policy and report field is derived from the same
registry definition. A supervisor may select an id, but it cannot inject a
different role, budget, allowlist, or policy for that id.

```typescript
await orchestrator.run({ task, traceId: "trace-42" });
// The executor receives the canonical agent id and trace id; its report must
// return the same values or orchestration fails closed.
```

Approval is a two-stage decision: permission establishes that a capability may
be attempted, then exact approval authorizes the specific mutation. Missing or
incorrect approval remains a typed denial; valid approval reaches the handler.

```txt
Supervisor route
      |
      v
Canonical registry lookup -- missing/duplicate/forged --> fail closed
      |
      v
SingleAgentExecutor(agentId, traceId) -- identity mismatch --> fail closed
      |
      +--> permission policy --> exact approval --> handler
      |
      v
Response policy --> content guard --> feedback --> OrchestratorReport
                       | block/rewrite
                       +--> enforce action, never return unsafe synthesis
```

## Files to change

1. `packages/agentic-ai-infra-core/src/errors/index.ts`
2. `packages/agentic-ai-infra-core/test/agent-definition.test.ts`
3. `packages/agentic-ai-infra-runtime/src/agents/index.ts`
4. `packages/agentic-ai-infra-runtime/src/feedback-loops/retry-loop.ts`
5. `packages/agentic-ai-infra-runtime/src/harness/index.ts`
6. `packages/agentic-ai-infra-runtime/src/orchestrator/agent-orchestrator.ts`
7. Focused core/runtime tests under `packages/*/test/`
8. Runtime module READMEs and public/internal Stage 26 documentation
9. `STATUS.md`, `kb.md`, `STRUCTURE.md`, and `CHANGELOG.md`
10. `prompts/stage-26/verification-summary.md`
11. `changelog/stage-26/stage-26-phase-07-2026-07-11-2319.md` (final change)

## Acceptance criteria

- A planned agent id resolves to the canonical registry definition before
  execution; unknown, duplicate, or identity-spoofed routes fail closed.
- `SingleAgentExecutor` accepts `agentId` and `traceId`, applies the resolved
  definition's role, tool policy, token budget, response policy, eval rules, and
  attribution, and rejects an unknown explicitly requested id.
- Executor reports must match the orchestrator's canonical agent id and trace id.
- Injected supervisor, executor, guard, and feedback throws become sanitized
  `framework.internal-error` results without leaked causes or messages.
- Exact approval can authorize an approval-gated mutation; absent or incorrect
  approval returns `runtime.approval-required` with
  `refusalReason: "approval-required"`.
- `agent-allowlist` and `approval-required` survive retry wrappers and appear in
  orchestrator refusal evidence where a partial result can be returned.
- Content `block` fails with `output.unsafe`; content `rewrite` returns only the
  replacement text; missing replacement fails closed.
- Response actions `abstain` and `ask` do not return the rejected synthesis.
- Available context sources are not reported as citations unless an executor
  explicitly cited them.
- Existing additive behavior remains compatible when optional registry,
  `agentId`, or `traceId` inputs are absent.

## Verification

Run focused evidence first, then the full gate after documentation and security
review:

```powershell
pnpm.cmd --filter @maharudra/agentic-ai-infra-core run typecheck
pnpm.cmd --filter @maharudra/agentic-ai-infra-core run test
pnpm.cmd --filter @maharudra/agentic-ai-infra-runtime run typecheck
pnpm.cmd --filter @maharudra/agentic-ai-infra-runtime run test
pnpm.cmd run ci
```

Focused implementation evidence before the final gates: core 64/64 and runtime
412/412 tests passed. This is not a completion signal until the security review
and validator gate pass.

## Self-review

- [ ] Every modified declaration has intent-focused API documentation.
- [ ] Identity is canonical at route, execute, and report boundaries.
- [ ] Approval ordering permits exact approval without weakening permission checks.
- [ ] No thrown dependency text, stack, cause, raw task, or approval text is exposed.
- [ ] Guard and response actions change control flow, not only telemetry.
- [ ] Refusal reasons survive wrapping and aggregation.
- [ ] Citation tests distinguish available sources from cited evidence.
- [ ] Public docs contain no internal phase language.
- [ ] The Stage 26 verification summary is updated before the changelog.
- [ ] The immutable Phase 07 changelog is created last and matches actual evidence.

## Completion state

Implemented with focused evidence; awaiting security review and the full
validator gate. Stage 26 remains reopened.
