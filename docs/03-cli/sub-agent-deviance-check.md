# Sub-Agent Deviance Check

A runtime guardrail that detects when the sub-agent orchestration system
drifts from its declared rules — for example, a specialist that re-prompts the
user for permissions mid-chain, a `RESULTS_SUMMARY` emitted without a preceding
`validator` turn, or a sub-agent that writes to a path outside its declared
surface. Violations are surfaced as warnings the next director invocation can
read, not as hard blocks.

All detection is local-only. No network traffic, no API calls, no secrets
touched.

---

## Overview

The deviance check exists because agentic chains fail in subtle ways. A
specialist might skip the validator gate under token pressure. A director might
emit a handback to a name that does not exist in the roster. A sub-agent might
write to a file outside the surface it declared in its schema. Each individual
violation is small; left undetected, they compound into a chain that produces
unreliable output without any signal to the user.

Telemetry is recorded automatically by sub-agent and tool hooks. The detector
can then audit that local telemetry either from the Claude Code Stop hook or by
manual command. Codex intentionally does not register the detector on `Stop`,
because Codex Stop fires at ordinary turn boundaries and can make long-running
multi-step work look interrupted. When the detector finds a violation, it
classifies it as HIGH or MEDIUM and either appends a persistent alert to
`.agentic-local/deviance-alerts.jsonl` (HIGH, non-dry-run only) or emits a
stderr warning only (MEDIUM). The next director invocation reads recent HIGH
alerts and surfaces them in its Routing Plan as `Deviance carry-over from
previous turn`.

The check is governed by the **upfront-permissions contract** locked in
`AGENTS.md` § Sub-Agent Routing (decision D50). D52 extends the signal set to
fifteen signals, adds a CI gate mode, and records upfront-grant acknowledgements
to a separate file.

---

## Telemetry pipeline

The following diagram shows how hook events flow from the orchestrator into the
deviance check and where findings land.

```txt
  Claude Code / Codex CLI
  ────────────────────────────────────────────────────────────────
  UserPromptSubmit hook
        │  subagent-routing-hook.mjs
        │  → injects director context (auto mode)
        ▼
  SubagentStart hook
        │  subagent-telemetry.mjs
        │  → appends SubagentStart record to subagent-routing-log.jsonl
        ▼
  PreToolUse hook (each tool call)
        │  subagent-telemetry.mjs
        │  → appends tool-event record (tool name, agent_id, turn_id)
        ▼
  PostToolUse hook (each tool call)
        │  subagent-telemetry.mjs
        │  → appends post-tool record (path written, result summary)
        ▼
  PermissionRequest hook (if permission needed)
        │  subagent-telemetry.mjs
        │  → appends permission-request record
        ▼
  SubagentStop hook
        │  subagent-telemetry.mjs
        │  → appends SubagentStop record (handback line, exit state)
        ▼
  Claude Stop hook or manual audit command
        │  subagent-deviance-check.mjs
        │  → reads subagent-routing-log.jsonl for current turn_id
        │  → runs 15-signal detector suite
        │  → HIGH: appends to deviance-alerts.jsonl + stderr warning
        │  → MEDIUM: stderr warning only
        │  → LOG-MISSING: synthetic HIGH when hook-health.jsonl absent
        ▼
  .agentic-local/deviance-alerts.jsonl   (HIGH findings, append-only)
  .agentic-local/hook-health.jsonl        (D52 — hook liveness record)
  .agentic-local/deviance-off-ack.jsonl  (D52 — disable acknowledgements)
```

---

## The 15 signals

The detector suite recognizes exactly fifteen signals, grouped by concern.

| # | Slug | Severity | What it detects |
|---|---|---|---|
| 1 | `results-without-validator` | HIGH | `RESULTS_SUMMARY` emitted without a preceding `validator` turn in the same chain |
| 2 | `write-outside-surface` | HIGH | Write to path outside the sub-agent's declared `write_surfaces[]` |
| 3 | `handback-unknown-name` | HIGH | `HANDBACK → <name>` where `<name>` is not in the 15-roster and is not the literal `user` |
| 4 | `director-skipped` | MEDIUM | Auto-routing is on but no director ran this turn |
| 5 | `tool-off-required-list` | MEDIUM | Tool used that is not in the sub-agent's `required_tools[]` |
| 6 | `permission-off-upfront-block` | HIGH | Permission requested mid-chain that was not in the director's upfront grant |
| 7 | `sensitive-write-no-reviewer` | HIGH / MEDIUM | Write to a sensitive path without a `security-reviewer` turn (HIGH for orchestrator files; MEDIUM for skill/prompt files) |
| 8 | `director-respawn` | MEDIUM | Director sub-agent started more than once in the same turn |
| 9 | `refused-tool-invoked` | HIGH | A tool listed in the sub-agent's `refused_tools[]` was invoked |
| 10 | `read-outside-surface` | HIGH / MEDIUM | Read of a path outside the sub-agent's `read_surfaces[]`; HIGH if path matches a secret basename pattern |
| 11 | `bash-outside-permission-scopes` | MEDIUM | Bash invocation whose command string does not match any declared `permission_scopes[]` pattern |
| 12 | `out-of-tree-write` | HIGH | Write to a path outside the repository root |
| 13 | `handback-off-targets` | HIGH | `HANDBACK` target is in the 15-roster but not in this sub-agent's declared `handoff_targets[]` |
| 14 | `validator-faked-green` | HIGH | Validator sub-agent's stop record lacks evidence of all four pnpm gate lines (typecheck / build / test / lint) |
| 15 | `missing-handback` | MEDIUM | Sub-agent stop has no `HANDBACK` line and no `RESULTS_SUMMARY` marker |

**Signal groups:**

| Group | Signals | Concern |
|---|---|---|
| Chain integrity | 1, 3, 13, 14, 15 | Handback routing, validator gate, chain completeness |
| Write surface | 2, 7, 12 | Writes within declared surfaces, sensitive paths, repo boundary |
| Tool compliance | 5, 9, 10, 11 | Tool list adherence, refused tools, read surface, Bash patterns |
| Routing discipline | 4, 6, 8 | Director lifecycle, upfront-permissions contract |

### Severity semantics

**HIGH** — appends a JSON alert to `.agentic-local/deviance-alerts.jsonl` and
emits a warning to stderr. The next director invocation reads recent HIGH alerts
and surfaces them in its Routing Plan as `Deviance carry-over from previous turn`.

**MEDIUM** — emits a warning to stderr only. No persistent alert is written.
MEDIUM findings go into the telemetry log so they are visible in `--dry-run`
output but do not accumulate in the alerts file.

---

## CLI reference

### Toggle CLI (`scripts/subagent-deviance.mjs`)

```powershell
# show current routing and deviance modes
node scripts/subagent-deviance.mjs status

# turn deviance detection ON (default)
node scripts/subagent-deviance.mjs on

# turn deviance detection OFF — requires --reason
node scripts/subagent-deviance.mjs off --reason "<text>" [--ttl-turns N]

# print exactly "on" or "off" for shell composition
node scripts/subagent-deviance.mjs get-mode
```

### Detector CLI (`scripts/subagent-deviance-check.mjs`)

```powershell
# Optional hook/manual mode (always exits 0)
node scripts/subagent-deviance-check.mjs

# Dry-run: scan log and print JSON verdict without writing alerts
node scripts/subagent-deviance-check.mjs --dry-run

# CI gate: scan a window of recent turns and exit non-zero on findings
node scripts/subagent-deviance-check.mjs --ci-gate [--window-turns N] [--strict]
```

**Exit codes — `--ci-gate` only:**

| Code | Meaning |
|---|---|
| 0 | `CLEAN` or `MEDIUM-ONLY` (without `--strict`) |
| 2 | One or more HIGH alerts in the window |
| 3 | MEDIUM alerts present (only with `--strict`) |
| 4 | `LOG-MISSING` — `hook-health.jsonl` absent |
| 5 | `deviance_mode` is `off` with no acknowledgement record |

Hook/manual mode always exits 0 regardless of findings. For Codex, prefer
`--dry-run`; the project config does not wire this script to `hooks.Stop`.

---

## Switching on and off

The toggle is stored as `deviance_mode` in `subagent-routing.json` at the
repository root alongside the routing `mode` key. Flipping one toggle never
clobbers the other — both scripts use read-modify-write.

Expected output of `status` when detection is on:

```txt
routing_mode:   auto
deviance_mode:  on
source:         <repo>/subagent-routing.json

D50 deviance detection is ON. Tool-event telemetry is recorded.
Automatic Codex Stop-hook detection is disabled; run an audit manually with:
  node scripts/subagent-deviance-check.mjs --dry-run
Disable with: node scripts/subagent-deviance.mjs off --reason "<text>"
```

Expected output when detection is off:

```txt
routing_mode:   auto
deviance_mode:  off
source:         <repo>/subagent-routing.json

D50 deviance detection is OFF. Tool-event records are dropped;
SubagentStart/Stop records are still written.
Enable with: node scripts/subagent-deviance.mjs on
```

The change takes effect on the **next turn** — no restart needed. The default
is `on`; a missing or malformed `deviance_mode` key also coerces to `on`.

### `--reason` requirement

Turning detection off requires an explicit reason:

```powershell
node scripts/subagent-deviance.mjs off --reason "debugging signal 8 false-positive"
```

The reason and a unique token are recorded in `.agentic-local/deviance-off-ack.jsonl`.
Without `--reason` the command exits 1 and detection remains on.

---

## Verdict precedence

When interpreting the current state of the guardrail, apply this precedence
order from highest priority to lowest. In dry-run mode the highest-priority
matching verdict is returned.

```txt
DISABLED          deviance_mode = "off" in subagent-routing.json
     │
     ▼
LOG-MISSING       hook-health.jsonl absent — pipeline may be broken
     │
     ▼
TELEMETRY-INCOMPLETE   turn_id missing or unmatched — signals 2/5/6/7/9/10/11/12 skipped
     │
     ▼
HIGH-ALERTS       One or more HIGH findings this turn
     │
     ▼
MEDIUM-ONLY       Warnings emitted to stderr; no HIGH entries in alerts file
     │
     ▼
CLEAN             No signals fired this turn
```

A DISABLED state is louder than CLEAN — the disabled state is logged to stderr
every turn to prevent the toggle from being silently forgotten.

---

## Output locations

Three local files accumulate the guardrail's output. All three are gitignored
and created at runtime — they are never committed.

| File | Written by | Contents |
|---|---|---|
| `.agentic-local/subagent-routing-log.jsonl` | `scripts/subagent-telemetry.mjs` | One JSON line per SubagentStart, SubagentStop, PreToolUse, PostToolUse, and PermissionRequest event. Append-only. |
| `.agentic-local/deviance-alerts.jsonl` | `scripts/subagent-deviance-check.mjs` | One JSON line per HIGH-severity deviance finding. Append-only. Also receives an audit record when `deviance_mode` is flipped to `"off"`. |
| `.agentic-local/deviance-off-ack.jsonl` | `scripts/subagent-deviance.mjs` | Acknowledgement records each time detection is disabled, including the reason and a unique token. |

---

## When to disable

The safe default is `on`. Turning detection off is appropriate in exactly one
scenario: **benchmarking the raw cost of the hook chain** (measuring turn
latency without the detector overhead). In that case, restore `on` immediately
after the benchmark.

Do not disable detection to suppress a warning you do not understand. Suppressed
warnings accumulate into the normalization-of-deviance pattern the system exists
to prevent — small violations become invisible, then routine, then structural.

---

## Fail-safe guarantees

The deviance check is designed so it can never lock the user out, even when it
malfunctions.

- **All hooks exit 0.** `scripts/subagent-deviance-check.mjs`,
  `scripts/subagent-telemetry.mjs`, and `scripts/subagent-routing-hook.mjs`
  always exit with code 0. A crash, a missing file, a JSON parse error, or any
  other runtime failure is caught and silently ignored. The turn proceeds
  regardless.

- **Disabled state is loudly logged.** When `deviance_mode = "off"`, each
  detector audit emits a line to stderr:
  `[deviance-check] DISABLED — detection is off (subagent-deviance.mjs on to enable)`.
  This prevents the toggle from being silently forgotten between sessions.

- **Detection is read-only.** The checker reads telemetry; it never edits
  source files, never modifies agent schemas, and never re-routes chains on its
  own. All correction decisions belong to the next director invocation or the
  user.

- **`--dry-run` for validation.** Run
  `node scripts/subagent-deviance-check.mjs --dry-run` to verify the detector
  logic without writing to `.agentic-local/deviance-alerts.jsonl`. Useful for
  CI validation of the detector itself.

---

## Where the source of truth lives

| File | Role |
|---|---|
| `AGENTS.md` § Sub-Agent Routing | Binding contract: upfront-permissions (D50), mid-chain re-routing (D51), validator gate |
| `subagent-routing.json` | The combined toggle file (`mode` + `deviance_mode`) |
| `scripts/subagent-deviance.mjs` | CLI to inspect and flip `deviance_mode` |
| `scripts/subagent-deviance-check.mjs` | Optional audit handler — reads telemetry, detects fifteen signals, writes HIGH alerts outside `--dry-run` |
| `scripts/subagent-telemetry.mjs` | SubagentStart / SubagentStop / PreToolUse / PostToolUse / PermissionRequest hook handler — appends one JSONL record per event |
| `scripts/safe-agent-schema-lint.mjs` | Schema validator — asserts all agent files declare the required `safe_agent_schema` fields |
| `docs/internal/learning-notes/safe-agent-schema.md` | Internal engineering reference — full fifteen-signal table, schema field definitions, D50/D51/D52 rationale |
| `docs/05-security/guardrails-production-hardening.md` | Public security doc — signal groups, CI integration, operator runbook |
| `.claude/settings.json` | Claude Code hook wiring (SubagentStart, SubagentStop, Stop) |
| `.codex/config.toml` | Codex CLI hook wiring; no `hooks.Stop` detector entry |
