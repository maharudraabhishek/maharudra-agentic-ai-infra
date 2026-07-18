# Engineering Hygiene — Agent Hooks Reference Parity

**Date:** 2026-07-10 01:22
**Stage name:** Engineering hygiene
**Phase name:** Agent hooks reference parity
**Test count:** 555/555 -> 555/555 (+0)
**CI:** `pnpm.cmd run ci` passed — build ✓ typecheck ✓ test 555/555 ✓ lint ✓
**Decisions locked:** _(none)_

## Added

_(none)_

## Changed

- `scripts/subagent-routing-hook.mjs` — auto-routing context now tells the host to preserve in-flight work for additive constraints and status prompts unless the user explicitly redirects or cancels.
- `scripts/subagent-deviance-check.mjs` — `--dry-run` now stays read-only and no longer writes HIGH findings to `.agentic-local/deviance-alerts.jsonl`; script header now describes optional audit use.
- `scripts/subagent-deviance.mjs` — status text now reflects Codex manual deviance audits instead of automatic Codex Stop-hook detection.
- `scripts/safe-agent-schema-lint.mjs` — CLI entrypoint is guarded so parser helpers can be imported without running the linter and exiting the process.
- `.codex/config.toml` — removed the Codex `hooks.Stop` deviance detector; Codex keeps UserPromptSubmit and telemetry hooks and runs detector audits manually with `--dry-run`.
- `.claude/agents/director.md` — added the reference in-flight work preservation rule while keeping pnpm validation wording.
- `.codex/agents/director.toml` — added the reference in-flight work preservation rule while keeping pnpm validation wording.

## Deprecated

_(none)_

## Removed

- `.codex/config.toml` — removed automatic Codex Stop-hook invocation of `scripts/subagent-deviance-check.mjs`; replacement is `node scripts/subagent-deviance-check.mjs --dry-run`.

## Renamed

_(none)_

## Fixed

- `scripts/subagent-routing-hook.mjs` — Codex/Claude auto-routing context now preserves pending validation, documentation, security-review obligations, and unresolved permissions across additive mid-chain prompts.
- `scripts/subagent-deviance-check.mjs` — dry-run audits no longer mutate `.agentic-local/deviance-alerts.jsonl`.
- `scripts/safe-agent-schema-lint.mjs` — importing `parseClaudeSchema` no longer executes the CLI main path.
- `.codex/config.toml` — Codex no longer runs the deviance detector at ordinary Stop boundaries, matching the Rudraloka Android hook fix.

## Documentation

- `docs/03-cli/sub-agent-deviance-check.md` — clarified Claude Stop-hook vs Codex manual audit behavior.
- `docs/05-security/guardrails-production-hardening.md` — updated guardrail audit language away from Codex Stop-hook assumptions.
- `docs/internal/learning-notes/safe-agent-schema.md` — recorded why Codex does not register the detector on `hooks.Stop`.
- `docs/03-cli/sub-agent-auto-routing.md` — updated deviance guardrail table and signal-set wording.
- `STATUS.md` — updated D50/D51 frontier with Codex manual-audit and in-flight-preservation parity.
- `STRUCTURE.md` — updated script, `.claude/`, `.codex/`, and changelog entries.
- `kb.md` — appended this session's rationale and verification.

## Notes

The Rudraloka Android reference was used as a behavior reference, not copied wholesale. Repo-specific pnpm validation wording, Claude quota/session Stop hooks, and the framework MCP sensitive path stayed intact.
