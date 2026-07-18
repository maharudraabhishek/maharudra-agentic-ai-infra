# Retrieval Quality Eval Suite

This document describes the retrieval quality eval suite introduced in Stage 21,
its six eval functions, and how to invoke them via the `agentic.evals.run` MCP tool.

---

## Overview

The retrieval quality eval suite runs deterministic checks on retrieval results,
context packages, and token budgets. Evals return one of three statuses:

- **passed** — the check passed based on supplied data
- **failed** — the check found a quality problem
- **skipped** — required input was not supplied (not an error)

In Stage 21, most checks return **skipped** when invoked through `agentic.evals.run`
because no real retrieval data or agent trajectory is supplied at the tool call level.
Stage 24 wires actual retrieval results and agent execution data for full coverage.

Relationship to agent evals: `runAgentRuntimeEvals()` checks agent harness behavior
(required roles, forbidden tools, trajectory safety, token budget). The retrieval quality
suite checks retrieval accuracy and policy compliance at the data layer.

---

## Eval Suite Table

| Eval ID                       | Name                                          | Inputs required                          | Passes when                                           |
|-------------------------------|-----------------------------------------------|------------------------------------------|-------------------------------------------------------|
| `retrieval.groundedness`      | Groundedness: context citations present       | contextPackage, outputText               | At least one sourceId from sources appears in output  |
| `retrieval.recall`            | Retrieval recall: expected chunks present     | retrievedResults, expectedChunkIds       | All expected chunk IDs appear in retrieved results    |
| `retrieval.policy-refusal`    | Policy refusal: blocked tools not called      | blockedTools, calledTools                | No calledTools entry appears in blockedTools          |
| `retrieval.budget-compliance` | Budget compliance: token usage within budget  | tokenUsage, tokenBudget                  | totalTokens ≤ tokenBudget                             |
| `retrieval.precision`         | Retrieval precision: low-score results below threshold | retrievedResults              | At most 30% of results are below the score threshold  |
| `retrieval.source-priority`   | Source priority: higher-priority sources ranked higher | retrievedResults              | Top-5 contains a result with the globally highest sourcePriority |

Runner:

| Function                      | Returns                                                          |
|-------------------------------|------------------------------------------------------------------|
| `runRetrievalQualityEvals(input)` | `QualityReport` with suiteName `"retrieval-quality"`, 6 results |

---

## RetrievalQualityEvalInput — Field Reference

| Field                  | Type                              | Used by                             | Default when absent |
|------------------------|-----------------------------------|-------------------------------------|---------------------|
| `retrievedResults`     | `readonly RetrievalResult[]`      | recall, precision, source-priority  | skip eval           |
| `contextPackage`       | `ContextPackage`                  | groundedness                        | skip eval           |
| `outputText`           | `string`                          | groundedness                        | skip eval           |
| `expectedChunkIds`     | `readonly string[]`               | recall                              | skip eval           |
| `irrelevanceThreshold` | `number`                          | precision                           | `0.3`               |
| `tokenUsage`           | `{ totalTokens: number }`         | budget-compliance                   | skip eval           |
| `tokenBudget`          | `number`                          | budget-compliance                   | skip eval           |
| `blockedTools`         | `readonly string[]`               | policy-refusal                      | skip eval           |
| `calledTools`          | `readonly string[]`               | policy-refusal                      | skip eval           |

---

## Usage

### Direct TypeScript call

```typescript
import { runRetrievalQualityEvals } from "@maharudra/agentic-ai-infra-runtime";

const report = runRetrievalQualityEvals({
  retrievedResults: retrievedFromRouter,
  expectedChunkIds: ["chunk-auth", "chunk-session"],
  tokenUsage: { totalTokens: 1200 },
  tokenBudget: 4000
});

console.log(report.status);   // "passed" | "failed" | "skipped"
console.log(report.total);    // 6
console.log(report.passed);   // number of passing checks
```

### Via agentic.evals.run MCP tool

```json
{
  "tool": "agentic.evals.run",
  "input": { "suite": "retrieval-quality" }
}
```

Response shape:

```json
{
  "suite": "retrieval-quality",
  "status": "skipped",
  "total": 6,
  "passed": 0,
  "failed": 0,
  "skipped": 6,
  "results": [
    { "id": "retrieval.groundedness", "name": "retrieval.groundedness", "status": "skipped", "message": "...", "metrics": null },
    ...
  ]
}
```

---

## Current Behavior (Stage 21)

When `agentic.evals.run` is called without supplying retrieval data, all six checks
return `"skipped"`. This is expected and correct:

```txt
  agentic.evals.run { suite: "retrieval-quality" }
        │
        ▼
  runRetrievalQualityEvals({})  ← empty input
        │
        ├─ checkGroundedness        → skipped (no contextPackage)
        ├─ checkRetrievalRecall     → skipped (no expectedChunkIds)
        ├─ checkPolicyRefusal       → skipped (no blockedTools)
        ├─ checkBudgetCompliance    → skipped (no tokenBudget)
        ├─ checkRetrievalPrecision  → skipped (no retrievedResults)
        └─ checkSourcePriority      → skipped (no retrievedResults)
              │
              ▼
        QualityReport { status: "skipped", skipped: 6 }
```

---

## Road to Stage 24

Stage 24 wires real retrieval and agent execution data into `agentic.evals.run`:

| Stage | Change                                                             |
|-------|--------------------------------------------------------------------|
| 21    | Eval functions and agentic.evals.run tool — empty-input semantics  |
| 22    | Source priority field on RetrievalResult; sourcePriority eval gets real data |
| 24    | AgentEvaluator wires agent execution results into evals.run call   |
| 24+   | Full eval coverage: groundedness, recall, budget all populated     |

The `"skipped"` status in Stage 21 is a valid intermediate state, not a failure.

## Suite-based dispatch

`runRetrievalQualityEvals()` is also wrapped by `RetrievalQualitySuite`
(`runtime/src/evals/retrieval-quality-suite.ts`), which implements
`EvalSuiteContract`. The suite is auto-registered into the runtime
`EvalHarness`. Direct callers can still use `runRetrievalQualityEvals()`; the
suite is just a thin adapter that exposes the same evals via the harness's
unified `runAll()` / `runSuite("retrieval-quality")` API.

See `docs/04-core-framework/evaluation-architecture.md` for the full picture.
