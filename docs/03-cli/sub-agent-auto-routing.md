# Sub-Agent Auto-Routing

A built-in switch that decides, on every prompt, whether a **director**
sub-agent automatically decomposes the task and routes it to specialists,
or whether you name sub-agents yourself in the prompt text.

It works identically on Claude Code and Codex CLI through a single hook
script — flip a JSON file at the repository root and the next prompt picks
up the change.

---

## What this is

When you type a prompt into Claude Code or Codex CLI, the assistant can
either tackle the whole task in one stream of consciousness, or it can
hand pieces of the work to focused **sub-agents** — small specialists that
each think like a world-class lead engineer in one area (planning,
architecture, coding, debugging, validation, documentation, security,
release, web research). This repository ships fifteen of them.

The fifteenth — `director` — is a routing-only sub-agent. Its sole job is
to read your prompt, decide which of the fourteen specialists should own
each part, and emit an explicit chain that the assistant executes in
order.

Auto-routing makes the director run on **every** prompt automatically.
Turn it off and you stay in control: the assistant only invokes
sub-agents you name in the prompt.

| Mode | Behaviour |
| --- | --- |
| `auto` (default) | The director runs first on every prompt, then routes to specialists. |
| `manual` | The assistant handles the prompt directly, or honors a sub-agent name you supply. |

---

## The 15-specialist roster

The full Operating Rules for each role live at `.claude/agents/<name>.md`.
Both Claude Code and Codex CLI read those files — Claude Code parses them
as native sub-agents, Codex CLI adopts each as a role profile when the
director hands work off to it.

| Sub-agent | What it does |
| --- | --- |
| `director` | Reads the prompt, picks specialists, emits a `HANDBACK → <next>` chain. Never writes code. |
| `planner` | Decomposes multi-step work into a numbered, dependency-aware plan. |
| `design-architect` | Designs public types, error codes, and cross-package contracts. |
| `implementor` | Translates an approved design into strict-mode TypeScript with TSDoc. |
| `clean-coder` | Tightens fresh code — naming, SOLID, dependency injection, dead branches. |
| `refactorer` | Reshapes internals without changing behaviour. |
| `debugger` | Reproduces, isolates, root-causes, writes a minimal failing test, fixes. |
| `validator` | Runs the full `pnpm.cmd typecheck`/`build`/`test`/`lint` gate. |
| `executor` | Runs a long or scripted command exactly as told and captures output. |
| `documentation` | Writes TSDoc, READMEs, learning notes, ASCII diagrams. |
| `security-reviewer` | Fail-closed review of MCP, write surfaces, auth, local↔remote boundary. |
| `release-manager` | Version bump, CHANGELOG, package exports, publish dry-run. |
| `ai-agentic-specialist` | Agentic-AI expertise — MCP, RAG, retrieval, token efficiency, multi-agent. |
| `web-extractor` | Fetches one URL and returns a verbatim quote with citation. |
| `web-scraper` | Reads multiple sources and produces a comparison synthesis. |

The director never invokes itself recursively. Once it emits its routing
chain, the orchestrator (Claude Code's main loop, or you driving Codex CLI)
executes that chain step by step.

---

## How auto mode works on Claude Code

Claude Code fires a **UserPromptSubmit** hook every time you submit a
prompt — before the model sees it. The hook is wired in
`.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          { "type": "command", "command": "node scripts/subagent-routing-hook.mjs", "timeout": 30 }
        ]
      }
    ]
  }
}
```

The script reads `subagent-routing.json` at the repository root and, if
mode is `auto`, prints a JSON envelope to stdout. Claude Code reads the
envelope's `hookSpecificOutput.additionalContext` field and attaches it
alongside your prompt. The model sees: "spawn the director sub-agent
first" and acts on it.

Native sub-agent invocation: Claude Code reads
`.claude/agents/<name>.md` files at session start. Each file's YAML
frontmatter (`name`, `description`, `tools`, `model`) defines a sub-agent
that Claude Code can spawn via the `Agent` tool with
`subagent_type: "<name>"`.

---

## How auto mode works on Codex CLI

Codex CLI supports the same hook. `.codex/config.toml` at the repository
root contains:

```toml
[[hooks.UserPromptSubmit.hooks]]
type = "command"
command = "node scripts/subagent-routing-hook.mjs"
timeout = 30
statusMessage = "Sub-agent auto-routing"

[agents]
max_depth = 2
```

The same script runs, the same JSON envelope is emitted, and Codex CLI
reads `hookSpecificOutput.additionalContext` the same way Claude Code
does. One script powers both stacks.

Native sub-agent invocation on Codex uses `.codex/agents/<name>.toml`
files. This repository ships one — `.codex/agents/director.toml` —
because the director is the only sub-agent the hook spawns directly.
When the director hands off to (say) `implementor`, Codex reads
`.claude/agents/implementor.md` as a role profile and adopts that hat for
the next turn.

The `[agents] max_depth = 2` setting raises Codex's default nested-agent
depth from 1 to 2 so the director (depth 1) can spawn specialists
(depth 2).

---

## Auto-routing flow

The same flow applies to both stacks:

```txt
                  user submits prompt
                          │
                          ▼
              UserPromptSubmit hook fires
                          │
                          ▼
        scripts/subagent-routing-hook.mjs
              reads subagent-routing.json
                          │
              ┌───────────┴────────────┐
              │                        │
        mode = "auto"             mode = "manual"
              │                        │
              ▼                        ▼
    inject additionalContext       (silent — exit 0)
    "spawn director sub-agent"             │
              │                            ▼
              ▼                  orchestrator handles
       orchestrator              prompt directly OR honors
       spawns director           user-named sub-agent
              │
              ▼
       director emits ROUTING PLAN
       ending in HANDBACK → <next>
              │
              ▼
       orchestrator spawns <next>
       and continues the handback chain
              │
              ▼
       validator (mandatory)
              │
              ▼
       RESULTS_SUMMARY
```

The hook always exits `0`. A misconfigured toggle never blocks a prompt.

---

## The toggle file

`subagent-routing.json` at the repository root is the single source of
truth:

```json
{
  "mode": "auto",
  "description": "Sub-agent auto-routing toggle. 'auto' = director runs on every prompt and routes to specialists from the 14-roster; 'manual' = user names sub-agents explicitly. Read by scripts/subagent-routing-hook.mjs (UserPromptSubmit hook for both Claude Code and Codex CLI).",
  "flipWith": "node scripts/subagent-routing.mjs on | off",
  "statusWith": "node scripts/subagent-routing.mjs status"
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `mode` | `"auto"` \| `"manual"` | The only field that affects behaviour. Any value other than `"manual"` (case-insensitive) is treated as `"auto"`. |
| `description`, `flipWith`, `statusWith` | string | Documentation in-line — purely for the human reader of the JSON. The hook script ignores them. |

If the file is missing, malformed, or contains an unknown value, the
effective mode is `auto`. This is the safer default: you explicitly opted
into the routing system by keeping the repo's defaults, so silently
disabling it would be surprising.

---

## Switching on and off

A small Node CLI ships with the repository. From the project root:

```powershell
# show current mode
node scripts/subagent-routing.mjs status

# turn auto-routing ON
node scripts/subagent-routing.mjs on

# turn auto-routing OFF (you name sub-agents manually)
node scripts/subagent-routing.mjs off

# print just the mode word for shell composition
node scripts/subagent-routing.mjs get-mode
```

Bash users:

```bash
node scripts/subagent-routing.mjs status
node scripts/subagent-routing.mjs on
node scripts/subagent-routing.mjs off
node scripts/subagent-routing.mjs get-mode
```

Expected output of `status` when auto is on:

```txt
mode:   auto
source: /path/to/repo/subagent-routing.json

The director sub-agent runs on every prompt and routes to specialists.
Disable with: node scripts/subagent-routing.mjs off
```

The change takes effect on the **next prompt** — no restart needed.
Codex CLI rebuilds its `AGENTS.md` instruction chain only at session
start, but the UserPromptSubmit hook is recomputed every prompt so the
toggle still works mid-session.

---

## Override at prompt time

You can override the director on any single prompt by naming a sub-agent
in the prompt itself. The director's Operating Rules detect the named
sub-agent and hand directly to it, skipping the rest of the routing
chain. This works in both `auto` and `manual` modes.

Examples:

```txt
> Use the debugger to find why the agent harness test
> is flaking on Windows only.
```

```txt
> Let the documentation agent add TSDoc to the new
> RetrievalRouter exports.
```

If you do not name a sub-agent, the director picks the chain from its
task-class table (see `.claude/agents/director.md`).

---

## What gets injected (token cost)

The hook injects about 850 characters (≈ 200 tokens, 102 words) of
`additionalContext` per prompt when auto-routing is on. This is the
verbatim string emitted:

```txt
SUB-AGENT AUTO-ROUTING IS ON (toggle: subagent-routing.json → auto).
Before doing anything else with this prompt, route it through the director
sub-agent. Claude Code: call Agent with subagent_type:"director" and pass
the user's prompt verbatim. Codex CLI: spawn the director sub-agent defined
at .codex/agents/director.toml. The director decomposes the task, picks
specialists from the 14-roster (planner, design-architect, implementor,
clean-coder, refactorer, debugger, validator, executor, documentation,
security-reviewer, release-manager, ai-agentic-specialist, web-extractor,
web-scraper), and ends with HANDBACK → <next>. Honor the chain; skipping
validator before RESULTS_SUMMARY is forbidden. Override: if the user
explicitly named a sub-agent in this prompt, honor that and skip the
director. Disable: node scripts/subagent-routing.mjs off
```

You can re-measure at any time by running the hook directly:

```powershell
node scripts/subagent-routing-hook.mjs
```

When the toggle is `manual`, the hook emits nothing — zero token cost.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Hook seems silent — no director spawning | Mode is `manual` | `node scripts/subagent-routing.mjs on` |
| Hook errors out | `node` not on PATH for the shell that launched the assistant | Add Node to PATH or use a full path in `command` |
| Hook can't find `subagent-routing.json` | Assistant was launched from a sub-directory and the hook resolved a different `cwd` | Always launch Claude Code / Codex CLI from the repository root |
| Toggle file got malformed | Manual edit broke the JSON | Script falls back to `auto` automatically; fix the JSON or run `node scripts/subagent-routing.mjs on` to rewrite it |
| Director keeps re-running mid-chain | Orchestrator is mis-routing | The director runs once per prompt. Mid-chain handoffs are the orchestrator's job — see `.claude/agents/director.md` § Operating Rules |
| Want one prompt without the director | Name a sub-agent in the prompt (override) — no need to flip the toggle | "Use the debugger to…" |

---

## Normalization-of-deviance guardrail

Auto-routing also records local **deviance guardrail** telemetry on every turn.
When a sub-agent or the orchestrator drifts from its declared rules — for
example, a
`HANDBACK → <name>` where `<name>` is not in the 15-roster, or a
`RESULTS_SUMMARY` without a preceding `validator` turn — the detector can
surface the deviation as a warning the next director invocation can see. Codex
runs this detector manually with `node scripts/subagent-deviance-check.mjs
--dry-run` because its Stop lifecycle is also a normal turn boundary.

Three local-only artefacts power the guardrail:

| File | Role |
| --- | --- |
| `scripts/subagent-telemetry.mjs` | `SubagentStart` / `SubagentStop` hook handler. Appends one JSON line per event to `.agentic-local/subagent-routing-log.jsonl`. |
| `scripts/subagent-deviance-check.mjs` | Optional audit handler. Scans local telemetry for deviance signals; writes HIGH-severity findings to `.agentic-local/deviance-alerts.jsonl` outside `--dry-run`. |
| `scripts/safe-agent-schema-lint.mjs` | Validates that every `.claude/agents/<name>.md` and `.codex/agents/<name>.toml` declares the required `safe_agent_schema` fields. |

The full signal set and severity rules live at
`docs/internal/learning-notes/safe-agent-schema.md` (decisions **D50/D52**). No
network traffic, no secrets touched — the entire chain runs locally and
gitignored.

## Upfront-permissions contract

The director and planner now collect **every permission the planned chain will
need** before the first specialist runs. A `Permissions required across the
chain` block in every Routing Plan lists the Bash patterns, write paths, MCP
servers, and network surfaces the user must approve once. Downstream
specialists inherit the approved surface and never re-prompt for any pattern
in the approved set.

If a specialist mid-chain discovers a permission outside the approved
surface, it stops and hands back to the director with a
`RE-PLAN REQUIRED: <missing>` note — the director then re-emits the plan with
an updated permissions block. This replaces the old per-turn permission-
prompt loop.

## Known limitations and roadmap

Auto-routing has known limitations. The internal audit at
`docs/internal/learning-notes/sub-agent-auto-routing-gap-audit.md` tracks
them; the highlights below are the ones a user needs to know.

| Limitation | Impact | Status |
| --- | --- | --- |
| The hook is advisory, not enforcing. It injects "spawn the director" as `additionalContext`; a weakly-aligned model under high token pressure can ignore it. | Routing discipline can degrade silently on a single turn. AGENTS.md, CLAUDE.md, and the per-prompt nudge are the counterweights; the D50 deviance guardrail makes the violation visible in the next turn. | Open — design choice (see R4). |

### Roadmap

| Item | Change | Effort | Status |
| --- | --- | --- | --- |
| R1 | Mirror the 14 specialists to `.codex/agents/<name>.toml` so Codex CLI gets the same native sub-agent surface Claude Code has. | ~1 session | Closed (D50). |
| R2 | Add prompt-side override detection in `scripts/subagent-routing-hook.mjs` — when the user names a sub-agent, emit a direct-route envelope and skip the director. | ~30 LOC + tests | Closed (D50). |
| R3 | Add `SubagentStart` / `SubagentStop` hooks that append `{ts, turnId, subagent}` to `.agentic-local/subagent-routing-log.jsonl`. | ~50 LOC, gitignored output | Closed (D50). |
| R4 | Decide on stronger enforcement (soft `SubagentStop` warning vs hard block). Pending data from D50 deviance log before deciding. | TBD | Open — pending data. |

If you hit a limitation that is not on the list above, capture it in the
audit first; do not patch the public doc without an audit entry.

---

## Where the source of truth lives

| File | Role |
| --- | --- |
| `AGENTS.md` § Sub-Agent Auto-Routing Toggle | Binding contract for both Claude Code and Codex |
| `subagent-routing.json` | The toggle file (committed) |
| `scripts/subagent-routing.mjs` | CLI to inspect and flip the toggle |
| `scripts/subagent-routing-hook.mjs` | UserPromptSubmit hook handler shared by both stacks |
| `.claude/settings.json` | Claude Code hook wiring |
| `.codex/config.toml` | Codex CLI hook wiring + `[agents] max_depth` |
| `.claude/agents/director.md` | Claude Code native director sub-agent |
| `.codex/agents/director.toml` | Codex CLI native director sub-agent |
| `.claude/agents/<name>.md` | The 14 specialists (Claude Code native; Codex role profile) |
| `.agents/skills/production-subagents/SKILL.md` | The routing-layer skill that documents the handback chain |

`CLAUDE.md` surfaces the same roster table for Claude Code at session
start. `STATUS.md` records the toggle as decision **D49** in the live
project state.
