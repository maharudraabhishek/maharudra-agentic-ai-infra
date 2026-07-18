# Engineering Hygiene — Per-Phase Changelog Discipline
## Claude Code Prompt — MahaRudra Agentic AI Infra (process improvement, not a stage)

---

## BEFORE YOU START — READ THIS FIRST

**Platform:** Windows 11, PowerShell, Node >= 20, pnpm only
**CI command:** `pnpm.cmd run ci`
**Current test count:** unchanged (this prompt adds NO tests)
**Expected after this prompt:** same count, plus a new `changelog/` folder

This is a **process-improvement prompt**, not a stage. It introduces an
engineering discipline that all future phase prompts inherit. The rule
lands in `AGENTS.md` and becomes binding for every subsequent Claude Code
session.

**Why now:** Stages 1–25 are documented narratively in `kb.md` and at the
release-summary level in `CHANGELOG.md`, but there is no structured
per-phase engineering record listing what was added / changed / deprecated
/ removed / renamed / fixed. As the framework crosses Stage 25 and enters
production hardening (Stage 25.5 + Stage 26), the per-phase record becomes
necessary for code archaeology, dependency tracking, and downstream
package migration.

This prompt:
1. Creates the `changelog/` folder with a format spec
2. Backfills Stage 25 (6 phase entries) from `kb.md`
3. Adds the discipline rule to `AGENTS.md` so every future phase prompt
   inherits it automatically — including the not-yet-executed Stage 25.5
   phase prompts

---

## CONTEXT — WHAT IS DONE

The project today has three documentation surfaces:

| Surface | Purpose | Audience |
|---|---|---|
| `CHANGELOG.md` (root) | High-level release-style summary | Framework users |
| `kb.md` (root) | Chronological narrative session log | Framework engineers |
| `STATUS.md` (root) | Snapshot of current frontier + last green CI | Anyone returning to context |

What is **missing**: a structured per-phase record listing the concrete
code-shape deltas — new exports, signature changes, deprecations,
removals, renames. The new `changelog/` folder fills that gap.

The three existing surfaces are NOT replaced. They serve different
audiences and timeframes. The new folder is purely additive.

---

## NEW LOCKED DECISION

### D45 — Per-phase changelog discipline (project-wide engineering rule)

Every stage/phase Claude Code prompt MUST include a `CHANGE` block that
creates one new file under `changelog/` describing the code-shape deltas
of that phase. The file follows the Keep-a-Changelog format (Added,
Changed, Deprecated, Removed, Renamed, Fixed). Filename pattern:

```
changelog/stage-{N}[-{sub}]-phase-{NN}-{YYYY-MM-DD-HHMM}.md
```

Examples:
```
changelog/stage-25-phase-01-2026-03-12-1430.md
changelog/stage-25-5-phase-03-2026-06-15-0900.md
changelog/stage-26-phase-02-2026-07-02-1100.md
```

`{N}` is the stage number (e.g. `25`). `{sub}` is the sub-stage suffix
when present (e.g. `5` for Stage 25.5). `{NN}` is the zero-padded phase
number. `{YYYY-MM-DD-HHMM}` is the local-time timestamp of when the phase
was completed. Lexicographic sort = chronological sort.

The rule is enforced by reviewers (Claude self-review + human review).
No CI lint is added today — the discipline lives in `AGENTS.md` as a
session-level binding rule.

---

## ARCHITECTURAL DECISION — WHY KEEP-A-CHANGELOG, NOT FREEFORM

Three reasons:

1. **Mechanical discovery.** Engineers six months later searching "when
   did `AgentRetryPolicy` get introduced?" find one entry. Searching
   "what was deprecated in Stage 25.5?" finds N entries. Freeform prose
   doesn't support this.

2. **Cross-phase invariants are checkable.** A "Removed" entry must
   appear in some phase before its referenced symbol can be absent from
   the next phase. A "Renamed" entry must appear before downstream
   imports can reference the new name. This is auditable by tooling
   later; freeform isn't.

3. **Modern AI infra and serious TypeScript packages use this format.**
   See: `@anthropic-ai/sdk` CHANGELOG, `langchain` releases, `dspy`
   changelog. Adopting the shape now means future automation (e.g.
   generating release notes via script) works without retrofit.

`towncrier`-style news fragments were considered. Rejected because they
require a build step at release time; per-phase markdown files are
human-readable today and aggregable later.

---

## FILES TO CHANGE — COMPLETE LIST

| # | File | Action |
|---|---|---|
| 1 | `changelog/README.md` | CREATE |
| 2 | `changelog/stage-25-phase-01-{date}.md` | CREATE (backfill from kb.md) |
| 3 | `changelog/stage-25-phase-02-{date}.md` | CREATE (backfill from kb.md) |
| 4 | `changelog/stage-25-phase-03-{date}.md` | CREATE (backfill from kb.md) |
| 5 | `changelog/stage-25-phase-04-{date}.md` | CREATE (backfill from kb.md) |
| 6 | `changelog/stage-25-phase-05-{date}.md` | CREATE (backfill from kb.md) |
| 7 | `changelog/stage-25-phase-06-{date}.md` | CREATE (backfill from kb.md) |
| 8 | `AGENTS.md` | MODIFY (add "Per-Phase Changelog Discipline" section) |
| 9 | `CHANGELOG.md` | MODIFY (add one line noting the new `changelog/` folder) |
| 10 | `STATUS.md` | MODIFY (one bullet recording this hygiene change) |
| 11 | `kb.md` | MODIFY (append a session entry for this prompt itself) |

Backfill scope is **Stage 25 only** (6 phases). Earlier stages remain
covered by `kb.md` narrative. Drawing a line at Stage 25 keeps this
prompt finishable in one Claude Code session.

---

## CHANGE 1 — CREATE `changelog/README.md`

```markdown
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
```

---

## CHANGE 2–7 — BACKFILL 6 STAGE 25 PHASE ENTRIES

Read `kb.md` for the Stage 25 phase entries (Phase 01 through Phase 06).
For each phase, create one file under `changelog/` with the filename
`stage-25-phase-{NN}-{YYYY-MM-DD-HHMM}.md`. Use the date from `kb.md` for
each phase; if the time is missing, default to `1200`.

For each phase, follow the template above. Extract:

- **Added** symbols from the "Files touched (new)" or "What shipped" sections in `kb.md`. Run `git log --diff-filter=A --name-only --pretty=format: -- packages/` between the previous phase's last commit and this phase's last commit if commit history is available; otherwise extract from the kb.md narrative.
- **Changed** symbols from the "Files touched (modified)" entries. The narrative usually names the changed export — preserve it.
- **Decisions locked** — every kb.md phase entry already lists the D-numbers; copy them.
- **Test count delta** — every kb.md phase entry lists before/after; copy.

**If `kb.md` does not explicitly enumerate symbol-level deltas** for a
phase (which will be the common case for older phases), fill the changelog
file at the granularity available. Mark the entry's `## Notes` section
with: `_Backfilled from kb.md narrative on {today}; symbol-level granularity may be incomplete._`

Each backfill file should be 30–80 lines. **Do not invent symbols.** If
the narrative doesn't say it, don't write it. Half-known is better than
imagined.

### Example backfill — `changelog/stage-25-phase-04-{kb-date}.md`

```markdown
# Stage 25 Phase 04 — Multi-Agent Definition Enforcement

**Date:** {extract from kb.md}
**Stage name:** Agent Definitions & Registry
**Phase name:** Multi-agent enforcement
**Test count:** {extract from kb.md}
**CI:** build ✓ typecheck ✓ test ✓ lint ✓
**Decisions locked:** {extract from kb.md}

## Added

- `runtime/src/agents/index.ts` — Per-role enforcement in `TokenEfficientMultiAgentExecutor.execute` (around the `roleOutputs.map` block) reading `AgentDefinition.allowedTools` and `AgentDefinition.budgetPolicy.maxTokens`.

## Changed

- `runtime/src/agents/index.ts` — `RuntimeRoleOutput`: added `selectedToolIds: readonly string[]`.

## Deprecated

_(none)_

## Removed

_(none)_

## Renamed

_(none)_

## Fixed

_(none)_

## Documentation

- `kb.md` — Stage 25 Phase 04 session entry
- `docs/internal/v3-architecture-snapshot.md` — Layer 10 row updated

## Notes

Backfilled from kb.md narrative on {today}; symbol-level granularity may be incomplete.
Original session lock: see kb.md entry for full reasoning.
```

Produce 6 such files for Stage 25 phases 01–06.

---

## CHANGE 8 — MODIFY `AGENTS.md`

Find the existing section structure (usually has sections like "Project
Conventions", "Code Style", "Testing Requirements", "Session Workflow",
etc.). Add a new section near the end, before any "Reference Documents"
or appendix-style section.

```markdown
## Per-Phase Changelog Discipline (D45)

Every Claude Code session that ships a stage or phase MUST create one
file under `changelog/` describing the code-shape deltas of that phase.
This rule applies to:

- Every numbered stage (Stage 1 through Stage 51)
- Every sub-stage (Stage 25.5, etc.)
- Every phase within a stage
- Process-improvement prompts (like this one — which adds its own entry)

### Filename

```
changelog/stage-{N}[-{sub}]-phase-{NN}-{YYYY-MM-DD-HHMM}.md
```

The timestamp is the local-time completion time of the session. Use the
ISO-like form `YYYY-MM-DD-HHMM` so files sort lexicographically in
chronological order.

### Required sections

Every changelog entry MUST contain, in order:

1. **Header** — Date, stage/phase names, test count, CI status, D-numbers locked
2. **Added** — new exports (class, interface, type, function, const)
3. **Changed** — modified signatures or behavior of existing exports
4. **Deprecated** — exports marked for removal with target stage
5. **Removed** — deleted exports with replacement reference
6. **Renamed** — old→new with semantics-preservation note
7. **Fixed** — bugs or regressions fixed
8. **Documentation** — doc files added or modified
9. **Notes** — free-form architectural reasoning, follow-ups

Sections with no content state `_(none)_` rather than being omitted.
Explicit "nothing was removed" is more useful than ambiguous silence.

### Symbol granularity

List every exported symbol that crossed a package boundary in this phase.
Internal helpers never exposed in a public barrel may be omitted. Tests
are not changelog material — they are proof that the changelog claims are
correct.

### Never edit shipped entries

Once a changelog file is committed, it is immutable. If a later phase
discovers a mistake in an earlier entry, the correction lives in the
later phase's entry, with a `## Notes — supersedes stage-X-phase-Y` line
naming the prior file.

### Relationship to kb.md, STATUS.md, CHANGELOG.md

- `kb.md` continues to be the narrative session log (the *why*).
- `STATUS.md` continues to be the frontier snapshot.
- `CHANGELOG.md` is curated at release time from the `changelog/` folder.
- `changelog/` is the structured per-phase engineering record (the *what*).

Phase prompts MUST include the changelog file in their "FILES TO CHANGE"
list as the FINAL change of the phase. The self-review checklist of every
phase prompt MUST contain at least one line verifying the changelog file
was created and matches the rules above.

### Enforcement

No CI lint enforces this today. Reviewers (Claude self-review, future
human review) verify presence and format. Future stages may add a script
that checks "every kb.md session header has a matching changelog file"
— that decision is deferred.
```

---

## CHANGE 9 — MODIFY `CHANGELOG.md`

Append one line near the top of the most recent release section:

```markdown
- **Engineering hygiene:** Introduced per-phase changelog folder at `changelog/`. From this point forward, every stage/phase ships with one structured entry listing Added / Changed / Deprecated / Removed / Renamed / Fixed exports. See `changelog/README.md` for the format and `AGENTS.md` § "Per-Phase Changelog Discipline" for the rule.
```

Do NOT restructure the existing `CHANGELOG.md`. One additive line only.

---

## CHANGE 10 — MODIFY `STATUS.md`

Add one bullet to the most recent stage's section:

```markdown
- **Engineering hygiene** ({today}) — Per-phase `changelog/` folder introduced. Stage 25 backfilled (6 entries). Rule landed in `AGENTS.md` § "Per-Phase Changelog Discipline" (D45). All future phases inherit the discipline.
```

---

## CHANGE 11 — MODIFY `kb.md`

Append a new session entry. Mirror the existing pattern.

```markdown
## Engineering Hygiene — Per-phase changelog discipline (D45)

**Date:** {today}
**Status:** Done
**Tests:** unchanged (no test changes in this prompt)

### What shipped

- New folder `changelog/` with README documenting the Keep-a-Changelog format
- Backfilled 6 entries for Stage 25 phases 01–06 from kb.md narrative
- AGENTS.md gained a new section "Per-Phase Changelog Discipline" locking D45
- CHANGELOG.md and STATUS.md note the new system

### Decisions locked

- **D45** — Every stage/phase Claude Code prompt MUST create one structured
  changelog entry under `changelog/`. Format: Keep-a-Changelog with mandatory
  sections (Added/Changed/Deprecated/Removed/Renamed/Fixed/Documentation/Notes).
  Filename: `stage-{N}[-{sub}]-phase-{NN}-{YYYY-MM-DD-HHMM}.md`. Immutable
  once committed. Internal-only helpers may be omitted; every exported symbol
  must be listed.

### What is intentionally not done

- No CI lint enforcing the rule (reviewer discipline only today)
- No backfill of Stages 1–24 (narrative kb.md remains the source)
- No automatic CHANGELOG.md aggregation script (manual curation today;
  scripting deferred to a future engineering-hygiene prompt)
- No machine-readable changelog (markdown-only today; YAML/JSON form deferred)

### Files touched

- `changelog/README.md` (NEW)
- `changelog/stage-25-phase-01-{date}.md` (NEW)
- `changelog/stage-25-phase-02-{date}.md` (NEW)
- `changelog/stage-25-phase-03-{date}.md` (NEW)
- `changelog/stage-25-phase-04-{date}.md` (NEW)
- `changelog/stage-25-phase-05-{date}.md` (NEW)
- `changelog/stage-25-phase-06-{date}.md` (NEW)
- `AGENTS.md`
- `CHANGELOG.md`
- `STATUS.md`
- `kb.md` (this entry)
```

And finally — this prompt itself must produce a changelog entry:

```
changelog/engineering-hygiene-changelog-discipline-{YYYY-MM-DD-HHMM}.md
```

Use the format above with `## Added` listing the new `changelog/README.md`
and the 6 backfilled entries. The filename for THIS prompt does not follow
the stage/phase pattern because this is not a stage — use the descriptive
slug above.

---

## VERIFICATION

Run from the repo root:

```bash
pnpm.cmd run ci
```

Expected: build ✓ typecheck ✓ test ✓ lint ✓. No test changes; counts unchanged.

Manual checks:

```bash
# Folder exists
dir changelog\

# Eight files: README + 6 backfilled Stage 25 entries + 1 self-entry
dir changelog\ | findstr ".md"

# AGENTS.md has the new section
findstr /C:"Per-Phase Changelog Discipline" AGENTS.md
findstr /C:"D45" AGENTS.md

# CHANGELOG.md has the note
findstr /C:"per-phase changelog" CHANGELOG.md

# STATUS.md has the bullet
findstr /C:"changelog/" STATUS.md
```

PowerShell equivalents are acceptable. The point is: 8 files visible in
`changelog/`, AGENTS.md mentions D45, and CI is still green.

---

## SELF-REVIEW CHECKLIST

### Folder + format
- [ ] `changelog/` folder exists at repo root
- [ ] `changelog/README.md` documents the filename pattern, template, and authoring rules
- [ ] Filename pattern is consistent across all 7 new files (README + 6 backfill)
- [ ] Every backfill entry contains all 9 required sections (header + 8 content sections)
- [ ] Empty sections state `_(none)_` rather than being omitted

### Backfill correctness
- [ ] 6 backfill files for Stage 25 phases 01–06 (one per phase)
- [ ] Each backfill file's `Decisions locked` matches the corresponding kb.md entry
- [ ] Each backfill file's `Test count` matches the corresponding kb.md entry
- [ ] No invented symbols — every named export traces to a kb.md mention or a real source file
- [ ] Each backfill file's `## Notes` includes the "Backfilled from kb.md narrative on {today}" caveat

### AGENTS.md rule
- [ ] New section "Per-Phase Changelog Discipline" is present
- [ ] D45 is the decision number
- [ ] Filename pattern is documented
- [ ] 8 required entry sections are enumerated
- [ ] "Immutable once committed" rule is stated
- [ ] Relationship to kb.md / STATUS.md / CHANGELOG.md is documented
- [ ] Enforcement model (reviewer discipline today, possible CI later) is stated

### Side files
- [ ] `CHANGELOG.md` gained ONE additive line referencing the folder
- [ ] `STATUS.md` gained ONE bullet noting the hygiene change
- [ ] `kb.md` gained a session entry locking D45

### Meta — this prompt's own changelog
- [ ] `changelog/engineering-hygiene-changelog-discipline-{date}.md` exists
- [ ] Its `## Added` section lists the README, the 6 backfill files, and the AGENTS.md section
- [ ] Its `## Decisions locked` lists D45

### Don't-break-the-build
- [ ] `pnpm.cmd run ci` passes
- [ ] No test files modified
- [ ] No `packages/**/src/**` files modified
- [ ] No `pnpm-workspace.yaml` changes

---

## WHAT NOT TO DO

- Do NOT add a CI lint script that enforces the rule. Reviewer discipline
  only today. CI enforcement is a separate, future prompt.
- Do NOT delete or restructure `CHANGELOG.md`, `kb.md`, or `STATUS.md`.
  The new folder is purely additive.
- Do NOT backfill earlier stages (1–24). The narrative in `kb.md` covers
  them; backfill from prose at scale is error-prone. Stage 25 is the line.
- Do NOT invent symbols in backfill entries. If `kb.md` doesn't mention
  a symbol, leave it out. Half-known is better than imagined.
- Do NOT modify any `packages/**/src/**` source file. This prompt touches
  documentation only.
- Do NOT add a `package.json` script that touches `changelog/`. The
  workflow is markdown-only today.
- Do NOT add a YAML or JSON manifest of the entries. Markdown only.
  Machine-readable form is deferred.
- Do NOT use BOM-prefixed UTF-8 for any new file. Plain UTF-8 only.
- Do NOT include the literal `{today}` or `{date}` placeholder strings
  in the final files — substitute the actual date when running the prompt.
- Do NOT make the backfill files long. 30–80 lines each. The format is
  the value, not prose.

---

## DONE SIGNAL

When complete, output:

```
Engineering hygiene — per-phase changelog discipline — complete.
Files created: 8 (changelog/README.md + 6 stage-25 backfill + 1 self-entry)
Files modified: 3 (AGENTS.md, CHANGELOG.md, STATUS.md, kb.md)
Test count: [N]/[N] passing (unchanged)
CI: build ✓ typecheck ✓ test ✓ lint ✓
New decision locked: D45 (per-phase changelog discipline)

Going forward:
- Every Stage 25.5 phase prompt (already generated, phases 01–05) will inherit this rule from AGENTS.md and produce one changelog/ entry per phase
- Every Stage 26+ phase prompt will produce one changelog/ entry per phase
- Reviewers verify the rule; CI does not (yet)
```
