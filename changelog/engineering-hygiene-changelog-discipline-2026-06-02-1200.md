# Engineering Hygiene — Per-Phase Changelog Discipline

**Date:** 2026-06-02 12:00
**Stage name:** _(process-improvement prompt, not a stage)_
**Phase name:** Per-phase changelog discipline (D45)
**Test count:** 500/500 → 500/500 (+0, unchanged)
**CI:** build ✓ typecheck ✓ test ✓ lint ✓
**Decisions locked:** D45

## Added

- `changelog/README.md` — Keep-a-Changelog format spec, filename convention, entry template, authoring rules, relationship to `CHANGELOG.md` / `kb.md` / `STATUS.md`
- `changelog/stage-25-phase-01-2026-05-28-1200.md` — Stage 25 Phase 01 backfill (AgentDefinition core types)
- `changelog/stage-25-phase-02-2026-05-28-1200.md` — Stage 25 Phase 02 backfill (registry implementation)
- `changelog/stage-25-phase-03-2026-05-28-1200.md` — Stage 25 Phase 03 backfill (container wiring)
- `changelog/stage-25-phase-04-2026-05-28-1200.md` — Stage 25 Phase 04 backfill (executor enforcement)
- `changelog/stage-25-phase-05-2026-06-01-1200.md` — Stage 25 Phase 05 backfill (single-agent evals)
- `changelog/stage-25-phase-06-2026-06-01-1200.md` — Stage 25 Phase 06 backfill (validator and docs)
- `AGENTS.md` — "Per-Phase Changelog Discipline (D45)" section: filename pattern, required sections, symbol granularity rules, immutability rule, relationship to other surfaces, enforcement model

## Changed

- `CHANGELOG.md` — one additive line noting the new `changelog/` folder
- `STATUS.md` — one bullet noting the engineering hygiene change
- `kb.md` — session entry for this prompt (D45, what shipped, what is intentionally not done)

## Deprecated

_(none)_

## Removed

_(none)_

## Renamed

_(none)_

## Fixed

_(none)_

## Documentation

- `changelog/README.md` (NEW) — format reference
- `AGENTS.md` — D45 rule added
- `kb.md` — session entry appended
- `STATUS.md` — hygiene bullet added

## Notes

This is a process-improvement prompt, not a stage. It introduces D45 as a project-wide engineering rule binding on all future Claude Code sessions.

Backfill scope is Stage 25 only (6 phases). Stages 1–24 remain covered by `kb.md` narrative only.

What is intentionally not done:
- No CI lint enforcing the rule (reviewer discipline only today)
- No backfill of Stages 1–24
- No automatic `CHANGELOG.md` aggregation script
- No machine-readable changelog (markdown only)
