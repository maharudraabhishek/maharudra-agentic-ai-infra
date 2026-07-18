# D50 Safe-Agent Schema Closure

**Date:** 2026-06-25  
**Stage:** engineering-hygiene — safe-agent-schema  
**Phase:** 01 — D50 closure (scripts + schema + hooks + process rules + docs)  
**Tests at completion:** CI not re-run for doc-only phase; prior baseline 547/547 passes (Stage 26 Phase 03)  
**CI status:** Security review passed; pnpm gate deferred to validator turn  
**Decisions locked:** D50 (normalization-of-deviance guardrail + upfront-permissions contract), D51 (mid-chain re-routing rule)

---

## Added

### `scripts/subagent-deviance.mjs` (new)

CLI to inspect and flip the `deviance_mode` key in `subagent-routing.json`.
Mirrors the interface of `scripts/subagent-routing.mjs` and uses
read-modify-write so flipping `deviance_mode` never clobbers `mode` or other
peer keys.

Subcommands: `status` | `on` | `off` | `get-mode`.  
Exit codes: 0 on success, 1 on unknown subcommand or write failure.  
Always exits 0 on read operations. Missing or malformed key coerces to `"on"`.  
When flipped to `"off"`, appends an audit record to
`.agentic-local/deviance-alerts.jsonl`.

### `docs/03-cli/sub-agent-deviance-check.md` (new)

Public CLI doc for the deviance guardrail. Covers: overview and D50 rationale,
toggle CLI with example output, nine-signal table (number, name, severity,
trigger, action), output locations, verdict precedence
(DISABLED > TELEMETRY-INCOMPLETE > HIGH-ALERTS > MEDIUM-ONLY > CLEAN), when to
disable, fail-safe guarantees (all hooks exit 0; disabled state logged loudly;
detection is read-only; `--dry-run` for validation). Public vocabulary only —
no internal phase/build-history wording.

### Process decisions added to `AGENTS.md`

**Clause B — Upfront-permissions contract (D50):** New subsection under
`## Sub-Agent Routing — Mandatory For Every Non-Trivial Task`, inserted after
the "Default handback chain" subsection. Specifies that the director enumerates
every permission the planned chain will need in a single block; specialists never
re-prompt mid-chain; missing permissions trigger `HANDBACK → director` with
`RE-PLAN REQUIRED:`; enforcement is spec + runtime (signal 6).

**Clause C — Mid-chain re-routing rule (D51):** New subsection under
`## Sub-Agent Auto-Routing Toggle`, inserted after the "Override on explicit user
choice" subsection. Specifies Fold / Branch / Suspend protocol for user messages
that arrive while a chain is in flight; one trailing tool call after a re-route
is MEDIUM-acceptable.

### `docs/internal/learning-notes/safe-agent-schema.md` — new sections

- Clause B (D50 binding rule) appended verbatim to `## Upfront-permissions contract`.
- New top-level section `## Mid-chain re-routing rule (D51)` with Clause C verbatim.
- `## How this composes with existing rules` table extended with a D51 row and a
  four-row D48 / D49 / D50 / D51 composition table.

---

## Changed

### `scripts/subagent-deviance-check.mjs`

Five previously unimplemented signal detectors added:

| Signal | Description |
| --- | --- |
| 1 | `RESULTS_SUMMARY` in transcript without preceding `validator` SubagentStart in the same chain |
| 4 | Auto mode on but no `director` SubagentStart logged for this turn |
| 6 | PermissionRequest event from a specialist for a pattern not in the director's approved block |
| 7 | Write to an MCP / auth / local↔remote boundary surface without a `security-reviewer` turn |
| 8 | Second `director` SubagentStart in the same turn |

`--dry-run` flag added: runs the full detector suite without writing to
`.agentic-local/deviance-alerts.jsonl`.

### `scripts/subagent-telemetry.mjs`

Tool-event recording (PreToolUse, PostToolUse, PermissionRequest) now gated on
`deviance_mode`. When `deviance_mode = "off"`, tool-event processing is skipped
entirely and the script exits 0 immediately. SubagentStart / SubagentStop
records are always written regardless of mode.

### `scripts/subagent-routing.mjs`

Read-modify-write patch: when flipping `mode`, the script now reads the existing
`subagent-routing.json` first and merges only the `mode` key, preserving
`deviance_mode` and all other peer keys. Previously the file was written from a
fixed template, clobbering any peer keys.

### `subagent-routing.json` (schema v2)

`deviance_mode: "on"` key added alongside the existing `mode` key.
`description` and `statusWith` / `flipWith` fields updated to describe both
toggles.

### `.claude/settings.json`

Three new hook entries added to the existing hooks array:
- `SubagentStart` → `scripts/subagent-telemetry.mjs`
- `SubagentStop` → `scripts/subagent-telemetry.mjs`
- `Stop` → `scripts/subagent-deviance-check.mjs`

Permission allow list updated to include the Bash patterns required by the
deviance-check and telemetry scripts for reading the toggle file and writing to
`.agentic-local/`.

### `.codex/config.toml`

Three new hook entries added (matching the Claude Code additions):
- `SubagentStart` → `scripts/subagent-telemetry.mjs`
- `SubagentStop` → `scripts/subagent-telemetry.mjs`
- `Stop` → `scripts/subagent-deviance-check.mjs`

### `CLAUDE.md`

Mirrors of Clause B (D50) and Clause C (D51) added after the "Auto-routing
toggle" subsection under `## Production-Grade Sub-Agents (always available)`.
Each mirror is a concise summary with a pointer to `AGENTS.md` for the full rule.

---

## Deprecated

_(none)_

---

## Removed

_(none)_

---

## Renamed

_(none)_

---

## Fixed

### Security-reviewer path-handling defects (3)

The security-reviewer identified three defects in the initial implementor pass:

1. `subagent-deviance-check.mjs` read the telemetry log path using a bare string
   constant that was not resolved relative to the project root when the script was
   invoked from a subdirectory. Fixed: path resolved via `dirname(fileURLToPath(import.meta.url))`.

2. `subagent-telemetry.mjs` wrote the JSONL record without ensuring the
   `.agentic-local/` directory existed, causing a write failure on a fresh clone.
   Fixed: `mkdirSync(stateDir, { recursive: true })` guard added before each write.

3. `subagent-routing.mjs` (pre-patch) overwrote the full file from a template,
   clobbering `deviance_mode` when the routing mode was flipped. Fixed: read-modify-write
   patch ensures all peer keys are preserved.

### Duplicated `readJson` helpers (clean-coder pass)

`scripts/subagent-deviance-check.mjs` and `scripts/subagent-deviance.mjs` each
contained a local `readJson` helper with identical logic. The clean-coder pass
collapsed the implementation in the check script to reuse the same inline pattern
already established in `subagent-routing.mjs`, reducing the helper count from 3 to 1
across the script family.

---

## Documentation

| File | Change |
| --- | --- |
| `docs/03-cli/sub-agent-deviance-check.md` | Created — public CLI doc for the guardrail |
| `AGENTS.md` | Clause B (D50) and Clause C (D51) added |
| `CLAUDE.md` | Mirrors of Clause B and Clause C added |
| `docs/internal/learning-notes/safe-agent-schema.md` | Clause B appended; D51 section added; composition table updated |
| `prompts/engineering-hygiene-D50-safe-agent-schema/verification-summary.md` | Phase 01 record completed (replacing skeleton) |
| `STATUS.md` | D50 header updated to "implemented + documented + verified"; D51 mention added |
| `kb.md` | Session entry appended (2026-06-25) |
| `STRUCTURE.md` | Entries added for new script, new doc, prompts folder, and this changelog |

---

## Notes

**Why D50 + D51 matter for normalization-of-deviance prevention.** The original
sub-agent routing system (D48/D49) specified *who* owns a turn and *how* the
director gets triggered. D50 adds the guardrail layer: machine-readable schemas
declare what each sub-agent is permitted to do, and nine signal detectors make
violations visible immediately rather than letting them accumulate silently. D51
closes the remaining gap: a user message arriving mid-chain was previously
ambiguous — any specialist could have acted on it. The Fold / Branch / Suspend
protocol routes every such message through the director first, preserving chain
integrity regardless of when the user intervenes.

**Fail-safe by design.** Every hook exits 0. The checker is read-only. The
disabled state is logged loudly. These properties mean the guardrail can never
lock the user out, even under malfunction — the cost of a missed detection is
always lower than the cost of a blocked prompt.

**Codex mirror completeness.** D50 also closed the Codex specialist-mirror gap
(audit finding F1 HIGH): all 14 specialists now have `.codex/agents/<name>.toml`
mirrors so Codex has the same native sub-agent surface as Claude Code.
