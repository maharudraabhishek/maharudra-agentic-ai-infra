# Changelog — MahaRudra Agentic AI Infra

This folder holds one file per shipped phase. Each file lists the concrete
code-shape deltas of that phase using the Keep-a-Changelog vocabulary.

For the high-level release-style summary, see `../CHANGELOG.md`.
For the chronological narrative session log, see `../kb.md`.
For the current frontier, see `../STATUS.md`.

## Filename Convention

```
stage-{N}[-{sub}]-phase-{NN}-{YYYY-MM-DD-HHMM}.md
```

- `{N}` — stage number (e.g. `25`)
- `{sub}` — sub-stage suffix when present (e.g. `5` for Stage 25.5)
- `{NN}` — zero-padded phase number
- `{YYYY-MM-DD-HHMM}` — local-time completion timestamp

Lexicographic sort = chronological sort.

## Entry Template

Every entry MUST contain the following sections, in this order. Sections
with no content state `_(none)_` rather than being omitted — this makes
"nothing was removed" explicit rather than ambiguous.

```markdown
# Stage {N}[-{sub}] Phase {NN}

**Date:** YYYY-MM-DD HH:MM
**Stage name:** (short title)
**Phase name:** (short title)
**Test count:** before/before → after/after (+delta)
**CI:** build ✓ typecheck ✓ test ✓ lint ✓
**Decisions locked:** D{X}, D{Y}, ...

## Added

- `package/path/file.ts` — `SymbolName` (class | interface | type | function | constant | enum)
- ...

## Changed

- `package/path/file.ts` — `SymbolName`: brief description of the change
- ...

## Deprecated

- `package/path/file.ts` — `SymbolName`: superseded by `NewSymbolName`; removal scheduled for Stage {target}

## Removed

- `package/path/file.ts` — `SymbolName` removed; replaced by `NewSymbolName` (Stage {when})

## Renamed

- `package/path/file.ts` — `OldName` → `NewName` (semantics unchanged | semantics changed: ...)

## Fixed

- `package/path/file.ts` — `SymbolName`: brief description of the bug or regression fixed

## Documentation

- `docs/path/file.md` — new section / update / removal
- `kb.md` — appended session entry
- `STATUS.md` — frontier updated

## Notes

Free-form. Architectural reasoning, follow-ups for future stages, known
limitations. Keep brief.
```

## Authoring Rules

1. **One file per phase.** Multi-phase stages produce multiple files.
2. **Reference symbols by full qualified path.** `runtime/src/guardrails/input-guard.ts — DefaultInputGuard`, not just `DefaultInputGuard`.
3. **List every exported symbol that was added, changed, removed, renamed, or deprecated.** Internal helpers that never appear in a public barrel may be omitted.
4. **Include the test count delta.** Tests are the proof the phase shipped.
5. **Cross-reference decisions.** Every entry must list the D-numbers locked in this phase. If no decisions were locked, write `_(none)_`.
6. **Never edit an existing changelog file after it ships.** Mistakes are corrected by appending a new entry in a later phase that explicitly references the prior one (`## Notes — supersedes stage-X-phase-Y`).

## Relationship to Other Surfaces

- **`CHANGELOG.md`** at the repo root is a release-summary view. When a
  release is cut, its section is built by aggregating the changelog/ entries
  since the previous release. The aggregation is human-curated today; a
  script may automate it later.
- **`kb.md`** is the narrative session log. It contains *why* each phase
  shipped. The changelog/ folder contains *what* shipped. Both are needed.
- **`STATUS.md`** is the snapshot. It contains the current frontier and
  pointer to the latest changelog entry.
