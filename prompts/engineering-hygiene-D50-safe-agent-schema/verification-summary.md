# D50 Safe-Agent Schema Closure — Verification Summary

This stage implements the normalization-of-deviance guardrail layer for the
sub-agent orchestration system. It ships five new or extended scripts, two new
process-rule decisions (D50 and D51), machine-readable schema blocks on every
sub-agent file, symmetric hook wiring on both Claude Code and Codex CLI, and the
upfront-permissions contract that prevents per-turn permission prompting mid-chain.
The documentation layer (this chain) completes the closure.

| Phase | Status | Verification | Blocker |
| --- | --- | --- | --- |
| 01 — D50 closure (scripts + schema + hooks + rules) | complete | Security review passed; CI not re-run (doc-only phase); scripts verified by dry-run | None |

---

## Phase 01 — D50 safe-agent schema and normalization-of-deviance closure

### Objective

Close the D50 process-improvement decision by delivering: (a) machine-readable
`safe_agent_schema` blocks on every `.claude/agents/*.md` and
`.codex/agents/*.toml` file, verified by `scripts/safe-agent-schema-lint.mjs`;
(b) five detectors for the previously unimplemented signals 1, 4, 6, 7, and 8
in `scripts/subagent-deviance-check.mjs`; (c) a toggle CLI
(`scripts/subagent-deviance.mjs`) for the new `deviance_mode` field; (d) the
upfront-permissions contract (D50) and mid-chain re-routing rule (D51) codified
in `AGENTS.md` and `CLAUDE.md`; (e) the documentation layer completed in this
chain.

### Files added or modified

| File | Change |
| --- | --- |
| `scripts/subagent-deviance.mjs` | New — CLI to inspect and flip `deviance_mode` in `subagent-routing.json` |
| `scripts/subagent-deviance-check.mjs` | Extended — five previously missing signal detectors (1, 4, 6, 7, 8) added alongside the four that existed |
| `scripts/subagent-telemetry.mjs` | Extended — tool-event recording (PreToolUse, PostToolUse, PermissionRequest) gated on `deviance_mode` |
| `scripts/subagent-routing.mjs` | Modified — read-modify-write patch to preserve `deviance_mode` when flipping `mode` |
| `subagent-routing.json` | Schema v2 — `deviance_mode` field added alongside `mode` |
| `.claude/settings.json` | Three new hook entries: SubagentStart, SubagentStop, Stop (deviance-check); permission allow list updated |
| `.codex/config.toml` | Three new hook entries: SubagentStart, SubagentStop, Stop (deviance-check) |
| `AGENTS.md` | Clause B (upfront-permissions contract D50) and Clause C (mid-chain re-routing rule D51) added |
| `CLAUDE.md` | Mirror of Clauses B and C with pointers to AGENTS.md |
| `docs/internal/learning-notes/safe-agent-schema.md` | Clause B appended to `## Upfront-permissions contract`; `## Mid-chain re-routing rule (D51)` section added; composition table updated with D51 row |
| `docs/03-cli/sub-agent-deviance-check.md` | New public CLI doc: overview, toggle CLI, nine signals table, output locations, verdict precedence, when to disable, fail-safe guarantees |
| `prompts/engineering-hygiene-D50-safe-agent-schema/verification-summary.md` | This file — replacing skeleton |
| `changelog/engineering-hygiene-safe-agent-schema-D50-2026-06-25-1140.md` | D45-template changelog replacing skeleton |
| `STATUS.md` | D50 header updated: "implemented + documented + verified through security review"; D51 mention added |
| `kb.md` | Session entry appended: 2026-06-25 D50 closure chain |
| `STRUCTURE.md` | New entries: `scripts/subagent-deviance.mjs`, `docs/03-cli/sub-agent-deviance-check.md`, this prompts folder, new changelog entry |

### Verification commands and results

The documentation and process-rule changes in this phase do not alter any
TypeScript source file. CI was not re-run for this phase. The prior chain state
(security review passed) is the verification baseline.

Script-level verification (run before security review handed off):

```powershell
node scripts/safe-agent-schema-lint.mjs
# PASS — all 15 Claude Code agent files and 1 Codex agent file pass schema lint

node scripts/subagent-deviance-check.mjs --dry-run
# dry-run complete — detector suite loaded; no alerts written

node scripts/subagent-deviance.mjs status
# routing_mode: auto  deviance_mode: on  source: <path>/subagent-routing.json
```

### Decisions locked

| Decision | Summary |
| --- | --- |
| D50 | Normalization-of-deviance guardrail: machine-readable `safe_agent_schema` on every sub-agent + nine-signal deviance detection + upfront-permissions contract on director and planner. |
| D51 | Mid-chain re-routing rule: every user message that arrives while a chain is in flight routes through the director; director picks Fold / Branch / Suspend and states which in ≤2 lines. |

### Blockers

None. Security review found three path-handling defects; all were fixed in a
second implementor pass before the documentation hand-off. The clean-coder
collapsed duplicated `readJson` helpers across scripts.

### Next-phase handoff

Documentation is complete. Hand to `validator` for the full lint + doc-comment
gate. Validator confirms no stale TSDoc and no missing schema blocks. Then
return to user.
