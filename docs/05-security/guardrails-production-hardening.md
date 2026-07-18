# Production Guardrails — Normalization of Deviance

The deviance guardrail system (decisions D50 and D52) is a local-only,
observational tool that makes rule violations in the sub-agent orchestration
chain visible before they become routine. It is designed on the principle of
normalization of deviance: small violations left undetected accumulate into
structural failures. The guardrail never blocks a turn, never edits source
files, and never crosses the local-to-remote boundary — it surfaces findings so
the next director invocation (or the user) can act. D52 extends the original
nine-signal baseline to fifteen signals, adds a CI gate mode for automated
pipeline checks, and introduces acknowledged disable records so the off state is
always auditable.

---

## What the system monitors

The fifteen signals are organized into four concern groups.

**Chain integrity (signals 1, 3, 13, 14, 15)**

These signals protect the correctness of the handback chain: that
`RESULTS_SUMMARY` only follows a `validator` turn, that handback names are
valid and within the sub-agent's declared targets, that the validator
actually ran all four pnpm gates, and that every sub-agent stop has a
handback or completion marker.

**Write surface (signals 2, 7, 12)**

These signals enforce the boundaries of what each sub-agent is allowed to
write: files outside the declared `write_surfaces[]`, writes to sensitive
orchestrator or config paths without a `security-reviewer` in the chain, and
writes that escape the repository root entirely.

**Tool compliance (signals 5, 9, 10, 11)**

These signals verify that sub-agents stay within their declared tool lists:
tools used that are not in `required_tools[]`, tools that are in
`refused_tools[]`, reads from paths outside `read_surfaces[]` (treated as
HIGH when the path matches a secret basename pattern), and Bash commands that
do not match any `permission_scopes[]` pattern.

**Routing discipline (signals 4, 6, 8)**

These signals enforce the D50 upfront-permissions contract and the director
lifecycle: auto mode running without a director turn, a specialist
re-prompting the user for a permission that was not in the upfront grant, and
the director spawning more than once in a single turn.

---

## Signal coverage at a glance

The table below maps each signal to the hook stage that can detect it and
whether the detector needs a tool-event window (PreToolUse/PostToolUse records
for the turn). Signals that require a tool-event window are skipped when
`turn_id` is absent from the stop payload.

```txt
  Signal                         Hook stage          Needs tool-event window?
  ─────────────────────────────────────────────────────────────────────────────
  1  results-without-validator   Stop                No
  2  write-outside-surface       Stop (PostToolUse)  Yes
  3  handback-unknown-name       SubagentStop        No
  4  director-skipped            Stop                No
  5  tool-off-required-list      Stop (PreToolUse)   Yes
  6  permission-off-upfront-block Stop (PermReq)     Yes
  7  sensitive-write-no-reviewer  Stop (PostToolUse)  Yes
  8  director-respawn            SubagentStart       No
  9  refused-tool-invoked        Stop (PreToolUse)   Yes
  10 read-outside-surface        Stop (PreToolUse)   Yes
  11 bash-outside-permission-scopes Stop (PreToolUse) Yes
  12 out-of-tree-write           Stop (PostToolUse)  Yes
  13 handback-off-targets        SubagentStop        No
  14 validator-faked-green       Stop                No
  15 missing-handback            SubagentStop        No
  ─────────────────────────────────────────────────────────────────────────────
  Severity key:
    H  = HIGH  (appended to deviance-alerts.jsonl + stderr)
    M  = MEDIUM (stderr only)
    H/M = HIGH or MEDIUM depending on path sensitivity
```

Signal severity summary:

| Severity | Signals |
|---|---|
| HIGH | 1, 2, 3, 6, 9, 12, 13, 14 |
| HIGH or MEDIUM (path-dependent) | 7, 10 |
| MEDIUM | 4, 5, 8, 11, 15 |

---

## Chain integrity flow

The diagram below shows a nominal sub-agent turn and where deviance edges
branch off. Each deviance edge indicates which signal fires and where it
lands (HIGH alert file or MEDIUM stderr).

```txt
  Prompt arrives
       │
       ▼
  UserPromptSubmit hook
       │  auto mode?
       ├─ yes ─► director sub-agent spawned
       │               │ Routing Plan emitted?
       │               ├─ no ──────────────────────────► [signal 4 MEDIUM]
       │               └─ yes
       │                   │
       ▼                   ▼
  SubagentStart (specialist)
       │  director already ran this turn?
       ├─ director starts again ──────────────────────► [signal 8 MEDIUM]
       └─ ok
           │
           ▼
  Tool calls (PreToolUse / PostToolUse)
       │  tool in refused_tools[]? ──────────────────► [signal 9 HIGH]
       │  tool not in required_tools[]? ────────────► [signal 5 MEDIUM]
       │  Bash not in permission_scopes[]? ─────────► [signal 11 MEDIUM]
       │  read outside read_surfaces[]?
       │     secret path? ──────────────────────────► [signal 10 HIGH]
       │     non-secret? ─────────────────────────── [signal 10 MEDIUM]
       │  write outside write_surfaces[]? ──────────► [signal 2 HIGH]
       │  write to sensitive path, no reviewer? ────► [signal 7 HIGH/MEDIUM]
       │  write outside repo root? ─────────────────► [signal 12 HIGH]
       │  permission requested outside upfront grant? [signal 6 HIGH]
       └─ ok
           │
           ▼
  SubagentStop
       │  handback name in 15-roster + handoff_targets[]?
       │     unknown name ─────────────────────────► [signal 3 HIGH]
       │     valid name, not in handoff_targets[] ── [signal 13 HIGH]
       │  no HANDBACK and no RESULTS_SUMMARY? ─────► [signal 15 MEDIUM]
       └─ ok
           │
           ▼
  Claude Stop hook or manual audit command
       │  RESULTS_SUMMARY without validator turn? ──► [signal 1 HIGH]
       │  validator stop has no pnpm gate lines? ───► [signal 14 HIGH]
       └─ ok
           │
           ▼
  CLEAN turn
```

---

## Where findings go

**HIGH findings** append one JSON line to
`.agentic-local/deviance-alerts.jsonl` and emit a warning to stderr. The next
director invocation reads recent HIGH alerts from that file and surfaces them
as `Deviance carry-over from previous turn` in the Routing Plan.

**MEDIUM findings** emit a warning to stderr only. No persistent alert record
is written. MEDIUM findings appear in `--dry-run` JSON output so they are
visible during developer review.

**LOG-MISSING** is a synthetic finding emitted when
`.agentic-local/hook-health.jsonl` is absent. It indicates the hook pipeline
may not be wired correctly. It lands in the alerts file and raises the dry-run
verdict to `LOG-MISSING`.

All three output files are gitignored. They are written to `.agentic-local/`
and are never committed to the repository.

---

## CI integration

The `--ci-gate` flag enables use in automated pipelines. It scans a window of
recent telemetry turns (default: all turns in the current session; override with
`--window-turns N`) and exits non-zero on findings.

```powershell
# Basic CI gate — exit 2 on any HIGH finding in the last 10 turns
node scripts/subagent-deviance-check.mjs --ci-gate --window-turns 10

# Strict CI gate — also exit 3 on MEDIUM findings
node scripts/subagent-deviance-check.mjs --ci-gate --window-turns 10 --strict
```

Add to `package.json` as a dedicated script for easy invocation:

```json
"scripts": {
  "deviance:ci": "node scripts/subagent-deviance-check.mjs --ci-gate --window-turns 20"
}
```

**Exit codes:**

| Code | Condition |
|---|---|
| 0 | `CLEAN` or `MEDIUM-ONLY` (without `--strict`) |
| 2 | One or more HIGH alerts in the scanned window |
| 3 | MEDIUM alerts present, `--strict` flag given |
| 4 | `LOG-MISSING` — `hook-health.jsonl` absent from `.agentic-local/` |
| 5 | `deviance_mode` is `off` with no acknowledgement record in `deviance-off-ack.jsonl` |

Hook/manual mode always exits 0 and is not affected by these codes. CI gate
mode is the only mode that returns non-zero verdicts.

---

## Disabling detection

The safe default is `on`. Disabling detection requires an explicit reason:

```powershell
node scripts/subagent-deviance.mjs off --reason "benchmarking hook-chain latency"
```

Without `--reason` the command exits 1 and detection remains on. The reason
and a unique token are appended to `.agentic-local/deviance-off-ack.jsonl`. The
CI gate reads this file: if detection is off but no acknowledgement record
exists, it exits with code 5.

An optional `--ttl-turns N` flag tells the toggle to auto-restore after N
completed turns. When TTL expires, detection re-enables automatically on the
next detector audit.

Restore detection at any time:

```powershell
node scripts/subagent-deviance.mjs on
```

Do not disable detection to suppress a warning you do not understand. The
normalization-of-deviance pattern — small violations accepted as routine,
eventually producing structural failure — is exactly what this system exists to
prevent.

---

## Local-only boundary

The deviance guardrail is local-only in every dimension:

- All telemetry is written to `.agentic-local/` which is gitignored. No
  telemetry record leaves the developer machine.
- The hook scripts make no network calls and consume no API tokens.
- The `--ci-gate` flag reads local files only; it does not upload findings.
- The sensitive-path detection (`SENSITIVE_PREFIXES` constant in the check
  script) operates on local filesystem paths and is never transmitted.

For the boundary policy that separates local runtime capabilities from
remote-safe surfaces, see
`docs/05-security/local-vs-remote-safe-mcp.md`.

---

## Operator runbook

**Reading alerts**

Open `.agentic-local/deviance-alerts.jsonl`. Each line is a JSON object with
fields: `ts` (timestamp), `signal` (slug), `severity`, `agent` (sub-agent
name), `detail` (signal-specific context such as the path written or the
unrecognised handback name). The most recent entry is the last line.

**Acknowledging a HIGH alert**

A HIGH alert does not block subsequent turns — it is surfaced in the next
director Routing Plan. To clear carry-over, either:

1. Fix the root cause (update the sub-agent schema, correct the handback chain,
   add the missing `security-reviewer` turn).
2. If the alert was a false positive, add a clarifying comment to
   `docs/internal/learning-notes/deviance-guardrail-production-improvements.md`
   and note the turn ID so the record is traceable.

Do not delete entries from `deviance-alerts.jsonl`. The file is append-only;
entries are historical evidence.

**Rotating logs**

The JSONL files in `.agentic-local/` grow without bound. When a log file
becomes large enough to slow telemetry scans, archive it:

```powershell
# Archive the telemetry log; a fresh file will be created on the next turn
Move-Item .agentic-local/subagent-routing-log.jsonl `
          .agentic-local/subagent-routing-log-$(Get-Date -Format 'yyyyMMdd').jsonl
```

**Using dry-run**

```powershell
node scripts/subagent-deviance-check.mjs --dry-run
```

Prints a JSON verdict object to stdout without writing to
`deviance-alerts.jsonl`. Use this to verify that the detector is reading the
telemetry correctly or to preview what the CI gate would report. The verdict
field is one of `CLEAN`, `MEDIUM-ONLY`, `HIGH-ALERTS`, `DISABLED`,
`LOG-MISSING`, or `TELEMETRY-INCOMPLETE`.
