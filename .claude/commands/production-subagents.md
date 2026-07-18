<!--
  Command:  /production-subagents
  Purpose:  Load the production-subagents routing skill into focused context.
            The skill describes when and how to invoke the 14-specialist roster
            living at .claude/agents/.
  Logic:    Delegates to the shared SKILL.md in .agents/skills/ so Codex and
            Claude Code share a single source of truth. No content is duplicated
            here.
  Usage:    Type /production-subagents when:
              - starting a new multi-step task and you want the routing chain
                visible in the active context;
              - reviewing whether the right sub-agent owns the next step;
              - onboarding a fresh session that needs the roster surfaced.
  See also: .claude/agents/                      — sub-agent definitions
            AGENTS.md § Sub-Agent Routing        — the mandatory rule
-->

@.agents/skills/production-subagents/SKILL.md
