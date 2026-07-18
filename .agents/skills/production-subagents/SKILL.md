---
name: production-subagents
description: Use for EVERY non-trivial task. Routes work to the production-grade sub-agent roster (planner, design-architect, implementor, clean-coder, refactorer, debugger, validator, executor, documentation, security-reviewer, release-manager, ai-agentic-specialist, web-extractor, web-scraper). Shared by Claude Code and Codex. Claude Code invokes sub-agents via the Agent tool with subagent_type; Codex adopts each profile by reading the corresponding file under .claude/agents/.
---

# Production-Grade Sub-Agents

Every non-trivial task in this repo runs through a roster of specialised sub-agents that each think like a world-class lead engineer in their domain. This skill is the routing layer.

The roster lives at `.claude/agents/<name>.md`. Each file is both a Claude Code native sub-agent definition (with YAML frontmatter Claude Code parses) and a role profile Codex reads to "put on the hat" for that specialisation.

## Why This Exists

Single-agent execution drifts on complex work: planning, design, implementation, validation, docs, and security all get squeezed into one stream of consciousness. The result is shortcuts, missing tests, leaky boundaries, and "I will document later." This roster forces each concern through a specialist who has only that concern.

A world-class engineering team has a planner, an architect, an implementor, a reviewer, a tester, a documentation owner, a security reviewer, and a release manager — and they hand work between roles deliberately. This skill encodes that team into a single repo.

## Workflow

1. **Identify task class.** Use the routing table below to pick the entry sub-agent (often `planner`).
2. **Spawn the sub-agent.**
   - **Claude Code:** call the `Agent` tool with `subagent_type: "<name>"` and a self-contained prompt that names the goal, the constraints, and the expected output.
   - **Codex:** read `.claude/agents/<name>.md` and adopt the operating rules and output shape in that file for the next turn. State explicitly which hat you are wearing.
3. **Follow the handback chain.** Each sub-agent's file declares which sub-agent it hands control to. Respect the chain — do not skip `validator`.
4. **Compose, do not collapse.** Multiple sub-agents may run in sequence on one task; that is the point. Do not consolidate roles "to save a turn."
5. **Never declare done without `validator`.** The `RESULTS_SUMMARY` block requires a validator verification line.

## Routing Table

| Task involves | Entry sub-agent | Typical handback chain |
| --- | --- | --- |
| New feature with ≥ 3 steps or unclear scope | `planner` | planner → design-architect → implementor → clean-coder → documentation → validator |
| New public type, exported port, error code, or cross-package contract | `design-architect` | design-architect → implementor → validator → documentation |
| Implementing an approved design | `implementor` | implementor → clean-coder → validator → documentation |
| Reviewing or tightening recently written code | `clean-coder` | clean-coder → validator |
| Structural rewrite without behaviour change | `refactorer` | refactorer → validator |
| Failing test, crash, regression, unexpected behaviour | `debugger` | debugger → implementor (fix) → validator |
| Pre-completion verification gate | `validator` | validator → (relevant fixer if RED) |
| Run a long or scripted command | `executor` | executor → requester |
| Adding TSDoc, README, learning notes, diagrams | `documentation` | documentation → validator |
| MCP tool, write surface, auth, retrieval indexing, local-vs-remote boundary | `security-reviewer` | security-reviewer → design-architect/implementor → validator |
| Version bump, CHANGELOG, package.json hygiene, publish prep | `release-manager` | release-manager → (user confirmation to publish) |
| MCP, RAG, retrieval, context budgets, multi-agent orchestration, dashboard | `ai-agentic-specialist` | ai-agentic-specialist → design-architect → implementor → security-reviewer → validator |
| Targeted single-URL doc lookup | `web-extractor` | web-extractor → requester |
| Multi-source research / library comparison | `web-scraper` | web-scraper → design-architect |

If two rows apply, run them in sequence — do not pick one.

## Default Handback Chain (most stage / phase work)

```txt
  user task
      │
      ▼
  planner ─ produces step plan
      │
      ▼
  design-architect ─ produces typed contracts
      │
      ▼
  implementor ─ writes code + tests
      │
      ▼
  clean-coder ─ tightens names, kills dup
      │
      ▼
  documentation ─ TSDoc, README, diagrams
      │
      ▼
  security-reviewer ─ only if surface changed
      │
      ▼
  validator ─ pnpm.cmd typecheck && build && test && lint
      │
      ▼
  RESULTS_SUMMARY (orchestrator handback)
```

Each arrow is an explicit hand-off. The current sub-agent's final message names the next one.

## Provider-Specific Invocation

```txt
  CLAUDE CODE                             CODEX
  ─────────                               ─────
  Agent tool:                             Read .claude/agents/<name>.md
    subagent_type: "<name>"               State "Entering <name> hat"
    prompt: "<self-contained brief>"      Follow Operating Rules in that file
    description: "<3–5 word desc>"        Produce Required Output Shape
                                          Hand back to named next sub-agent
  Result is a single message.
  Read it, route to the next sub-agent.
```

Claude Code sub-agents have isolated context windows — each call starts fresh. Pass the relevant prior output as part of the new prompt; do not assume the sub-agent saw earlier turns.

Codex shares one context — switching hats means stating the change explicitly so the human reader and any orchestrator can follow which role wrote which paragraph.

## Anti-Patterns Forbidden by This Skill

- **Skipping the planner** on multi-step work because "the plan is obvious."
- **Skipping the validator** because typecheck was green on the last package-filtered run.
- **Collapsing implementor + clean-coder + documentation** into one streamed turn — the quality dies.
- **Letting `web-extractor` paraphrase** instead of quoting.
- **Treating `security-reviewer` as optional** for any change that touches a write surface.

## Hand-off Discipline

Every sub-agent's final message must include exactly one of:

```txt
HANDBACK → <next-sub-agent>          (the chain continues)
HANDBACK → user                       (the chain ends, awaiting confirmation)
HANDBACK → none                       (no further work needed — rare, requires justification)
```

The orchestrator (Claude Code itself, or the human in Codex) uses this line to decide the next call.

## Relationship to Other Skills

- The six topic skills (`framework-architecture`, `mcp-security-review`, `cli-template-design`, `agentic-context-design`, `dashboard-token-efficiency`, `package-release-readiness`) describe **what** to think about in their domain.
- This skill describes **who** thinks about it — which specialist owns the turn.
- Sub-agents that reference a topic skill (e.g. `security-reviewer` ↔ `mcp-security-review`) load that skill themselves; the routing layer does not re-load it.

## Verification

This skill has no runtime artefact. Verify by:

1. The sub-agent roster at `.claude/agents/` exists and the 14 files match the routing table.
2. Each agent file's frontmatter `name` matches its filename.
3. AGENTS.md "Sub-Agent Routing" section references this skill.
4. The slash command `/production-subagents` imports this file.
