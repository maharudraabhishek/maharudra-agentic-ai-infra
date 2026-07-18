<!--
  Command:  /framework-architecture
  Purpose:  Load the framework-architecture skill into focused context for the current task.
  Logic:    Delegates to the shared SKILL.md in .agents/skills/ so Codex and Claude Code
            share a single source of truth. No content is duplicated here.
  Auto-load: This skill is ALSO imported by default in CLAUDE.md at session start.
             Use this command to re-focus explicitly when architecture is the primary concern.
  Usage:    Type /framework-architecture when the task involves:
              - package boundary decisions
              - clean architecture or dependency inversion
              - generated project contract changes
              - local-first vs remote-safe runtime decisions
              - product roadmap or phase planning
-->

@.agents/skills/framework-architecture/SKILL.md
