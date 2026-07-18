# Engineering hygiene — LIFO stage-summary handoff

**Date:** 2026-06-24 09:56 IST
**Stage name:** Engineering hygiene
**Phase name:** D47 LIFO stage-summary handoff
**Test count:** Not applicable — process/documentation change
**CI:** `node --check` passed for the changed local scripts; quota warning output confirms the LIFO continuation guidance.
**Decisions locked:** D47 — the active stage verification summary is the sole operational handoff.

## Added

_(none)_

## Changed

- `AGENTS.md` — quota warnings now require an active stage-summary update; D47 defines a newest-first completed-phase stack and removes root handovers.
- `prompts/stage-26/verification-summary.md` — rebuilt as a detailed LIFO stack with complete Phase 03, 02, and 01 records before the remaining-phase plan.
- `CLAUDE.md`, `README.md`, and `docs/internal/agent-switching/switching-guide.md` — agent switching now reads `STATUS.md`, `kb.md`, and the active stage summary.
- `scripts/quota-check.mjs`, `scripts/session-summary.mjs`, and `scripts/update-doc-timestamps.mjs` — remove handover generation, messaging, and timestamp tracking.

## Deprecated

- Root-level `handover.md` and the Claude `/handover` workflow are retired. The replacement is the active stage's LIFO verification summary.

## Removed

- `handover.md` — redundant point-in-time handover artifact.
- `.claude/commands/handover.md` — obsolete slash-command workflow.

## Renamed

- `handoverLines()` → `continuationLines()` in `scripts/quota-check.mjs`; semantics now direct agents to the authoritative stage summary.

## Fixed

- Eliminated duplicated and potentially stale session state across the root handover, `STATUS.md`, and stage records.
- Made the immediate continuation context visible at the top of each completed-stage stack.

## Documentation

- `STRUCTURE.md` and `STATUS.md` — record the D47 process change and this immutable entry.
- `kb.md` — records the rationale and ownership boundaries for the LIFO model.
- `prompts/stage-25/stage-25-phase-00-INDEX.md` — removes the obsolete next-chat handover instruction.

## Notes

No framework runtime contract, package export, or Stage 26 implementation
behavior changed. Existing immutable changelog entries may mention the former
handover workflow as historical evidence; D47 supersedes those instructions.
