# Stage 26 Phase 08 — Token-efficient composition

## Status

Approved design specification; not started. Do not implement this phase as part
of Phase 07.

## Objective

Replace repeated full-context single-agent composition with truthful,
token-efficient orchestration. Build or accept one shared context package,
derive bounded slices for canonical planned agents, preserve useful sequential
handoffs, and emit correlated usage and evaluation evidence without claiming
work that was not executed.

## Concept

Token-efficient composition shares evidence, not prompts. Each role receives a
bounded slice selected from one context package; sequential roles additionally
receive a compact prior-result handoff. This prevents context cost from growing
toward `agent count × full context`.

```typescript
const result = await orchestrator.run({ task, contextPackage });
// One shared package is sliced by role; each sub-run reports its own bounded use.
```

```txt
Task + one ContextPackage
          |
          v
Canonical supervisor route
          |
          v
RoleContextSlicer -- one bounded slice per planned agent
          |
     +----+-------------------+
     |                        |
 sequential              parallel
 compact handoff N-1      bounded slices concurrently
     |                        |
     +------------+-----------+
                  v
       correlated sub-runs + usage + eval evidence
                  |
                  v
          guarded synthesis/report
```

## Files to change

The design/implementor pass must enumerate exact source and test files before
editing. At minimum it must consider:

1. Runtime orchestrator and agent executor composition contracts.
2. Context slicing and token-accounting tests.
3. Runtime/public documentation and the Stage 26 internal learning note.
4. `STATUS.md`, `kb.md`, and `STRUCTURE.md` when applicable.
5. `prompts/stage-26/verification-summary.md`.
6. The immutable Phase 08 changelog as the final change.

## Acceptance criteria

- Context is built or accepted once per orchestrator run and is not duplicated
  in full for every planned agent.
- Every planned id is canonicalized before slicing or execution.
- Role slices are bounded, deterministic, attributable, and contain only source
  ids available in the shared package.
- Sequential handoffs are compact and bounded; they do not append an unbounded
  transcript or recursively duplicate prior context.
- Parallel composition retains partial-success semantics and truthful failures.
- Reports distinguish actual single-agent sub-runs from multi-agent executor
  reports; no relabeling or fabricated attribution is allowed.
- Usage totals equal the included sub-runs and expose enough evidence for cost,
  latency, retrieval-quality, and token-efficiency dashboards.
- Refusal, retry, response-policy, content-guard, trace, and citation guarantees
  established in Phase 07 remain intact.
- Focused tests prove context reuse and a bounded token-growth relationship as
  agent count increases.

## Verification

```powershell
pnpm.cmd --filter @maharudra/agentic-ai-infra-core run typecheck
pnpm.cmd --filter @maharudra/agentic-ai-infra-runtime run typecheck
pnpm.cmd --filter @maharudra/agentic-ai-infra-runtime run test
pnpm.cmd run ci
```

Record actual counts only after implementation. Security review is mandatory if
context, tool, write, or remote-safe boundaries change; validator is mandatory
before completion.

## Self-review

- [ ] One shared context package is observable in tests.
- [ ] No composition branch sends full context to every role by default.
- [ ] Sequential handoff growth is bounded and tested.
- [ ] Identity, trace, refusal, citation, and guard invariants remain truthful.
- [ ] Usage and eval evidence reflect only executed work.
- [ ] Public docs explain the behavior with a supported example and ASCII flow.
- [ ] Verification summary is updated before the immutable changelog.

## Completion state

Not started. Stage 26 cannot be closed until this phase is implemented,
security-reviewed where applicable, and validated.
