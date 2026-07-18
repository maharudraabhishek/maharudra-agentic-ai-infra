# Stage 24 — Phase 5: Eval data fixtures
## Claude Code Prompt — MahaRudra Agentic AI Infra

---

## BEFORE YOU START

**Platform:** Windows 11, PowerShell, Node >= 20, **pnpm only**
**CI command:** `pnpm run ci`
**Read first:** `AGENTS.md`, `STATUS.md`, `kb.md`
**Prerequisite:** Phase 1 complete (`EvalDataset` schema defined)
**Expected after this phase:** test count unchanged (~400 — fixtures only, no new tests)

---

## SCOPE — Phase 5 only

Add the `examples/eval-data/` directory with two sample dataset files and a README documenting the schema. These are fixture data shipped with the repo as a reference for users; not consumed by any test in this phase.

---

## FILES TO CHANGE

```
examples/eval-data/retrieval-quality.json   NEW
examples/eval-data/agent-runtime.json       NEW
examples/eval-data/README.md                NEW
```

---

## CHANGE 1 — `examples/eval-data/retrieval-quality.json` (NEW)

```json
{
  "version": 1,
  "name": "retrieval-quality-fixtures",
  "description": "Sample dataset for retrieval quality eval. Real projects replace these with domain-specific items.",
  "items": [
    {
      "id": "rq-1-auth-overview",
      "question": "How does session authentication work in this codebase?",
      "expectedChunks": ["auth/session-overview", "auth/session-lifecycle"],
      "expectedAnswer": "Sessions are created via resumeOrCreateSession and stored by the SessionManager.",
      "expectedToolCalls": ["agentic.retrieval.search", "agentic.context.build"],
      "tags": ["security", "auth"],
      "difficulty": "easy",
      "matchMode": "substring"
    },
    {
      "id": "rq-2-storage-providers",
      "question": "What storage providers are supported?",
      "expectedChunks": ["storage/providers/types", "storage/providers/memory", "storage/providers/postgres"],
      "expectedAnswer": "The framework supports memory and postgres storage providers via the StorageProvider interface.",
      "expectedToolCalls": ["agentic.retrieval.search"],
      "tags": ["storage", "architecture"],
      "difficulty": "medium",
      "matchMode": "substring"
    },
    {
      "id": "rq-3-pgvector-migration",
      "question": "Which migration enables pgvector and at what dimension?",
      "expectedChunks": ["migrations/005-pgvector-1024"],
      "expectedAnswer": "Migration 005 ALTERs the embedding column to vector(1024).",
      "expectedToolCalls": ["agentic.retrieval.search"],
      "tags": ["storage", "migrations"],
      "difficulty": "hard",
      "matchMode": "exact"
    }
  ]
}
```

---

## CHANGE 2 — `examples/eval-data/agent-runtime.json` (NEW)

```json
{
  "version": 1,
  "name": "agent-runtime-fixtures",
  "description": "Sample dataset for agent runtime eval. Real projects replace these.",
  "items": [
    {
      "id": "ar-1-security-review",
      "question": "Review the security posture of the new tool",
      "expectedChunks": ["tools/security-policy"],
      "expectedAnswer": "Security review completed.",
      "expectedToolCalls": ["agentic.retrieval.search"],
      "tags": ["security"],
      "difficulty": "medium",
      "matchMode": "substring"
    },
    {
      "id": "ar-2-doc-pass",
      "question": "Document the eval system architecture",
      "expectedChunks": ["docs/eval-architecture"],
      "expectedAnswer": "Eval architecture documented.",
      "expectedToolCalls": ["agentic.context.build"],
      "tags": ["documentation"],
      "difficulty": "easy",
      "matchMode": "substring"
    },
    {
      "id": "ar-3-architecture-review",
      "question": "Architectural review of the executor refactor",
      "expectedChunks": ["agents/executor-options"],
      "expectedAnswer": "Executors now use options object construction.",
      "expectedToolCalls": ["agentic.retrieval.search"],
      "tags": ["architecture"],
      "difficulty": "medium",
      "matchMode": "substring"
    }
  ]
}
```

---

## CHANGE 3 — `examples/eval-data/README.md` (NEW)

```markdown
# Eval Datasets — Sample Format

This directory holds JSON eval datasets consumed by `DatasetEvaluator`.

## Schema (version 1)

Required fields per item: `id`, `question`, `expectedChunks`, `expectedAnswer`,
`expectedToolCalls`.

Optional fields: `tags`, `difficulty`, `matchMode`, `tokenBudget`, `metadata`.

Top-level: `version` (must be `1`), `name`, optional `description`, `items` array.

Example item:

\`\`\`json
{
  "id": "stable-unique-identifier",
  "question": "input fed to the system under eval",
  "expectedChunks": ["chunk-id-1"],
  "expectedAnswer": "expected string",
  "expectedToolCalls": ["agentic.retrieval.search"],
  "tags": ["security"],
  "difficulty": "easy",
  "matchMode": "substring",
  "tokenBudget": 4000,
  "metadata": { "source": "your-source", "createdAt": "2026-05-22" }
}
\`\`\`

## Match modes

- `substring` (default) — case-insensitive substring match after whitespace
  normalization
- `exact` — case-sensitive exact match after trim
- `semantic` — delegated to the optional LLM-judge evaluator; skipped when the
  LLM judge is not registered

## Security

- Do NOT include PII, secrets, API keys, or production data
- Datasets are read by the framework but never logged or transmitted

## Adding new datasets

Drop a `.json` file in this directory. The dataset loader rejects path
traversal — filenames must be plain (no `/`, `\\`, `..`).
```

---

## SELF-REVIEW CHECKLIST

- [ ] All 3 files exist at the documented paths
- [ ] Both JSON files validate against `validateEvalDataset` from Phase 1 (manual check by reading the schema in `core/src/evals/types.ts`)
- [ ] Each JSON file has ≥3 items with varied `tags`, `difficulty`, and `matchMode`
- [ ] No PII, secrets, or production data in any item
- [ ] Both JSON files parse as JSON (no trailing commas, no comments)
- [ ] `examples/eval-data/README.md` documents schema, modes, security rules, addition policy
- [ ] `pnpm run ci` passes (no new tests in this phase but lint and build must remain green)

---

## WHAT NOT TO DO

- Do NOT consume these fixtures in any test — they are documentation/reference data
- Do NOT add a `tsconfig.json` to `examples/eval-data/` — these are plain JSON, no TypeScript
- Do NOT modify any TypeScript source in this phase
- Do NOT add real product names, customer data, or anything resembling production content

---

## DONE SIGNAL

```
Stage 24 Phase 5 complete.
Test count: [N]/[N] passing (unchanged, fixtures only).
CI: build ✓ typecheck ✓ test ✓ lint ✓
Files changed: 3
Next: Phase 6 — LlmJudgeEvaluator
```
