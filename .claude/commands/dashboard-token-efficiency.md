<!--
  Command:  /dashboard-token-efficiency
  Purpose:  Load the dashboard and token efficiency skill for observability and reporting work.
  Logic:    Delegates to the shared SKILL.md in .agents/skills/ so Codex and Claude Code
            share a single source of truth. No content is duplicated here.
  Auto-load: No — on-demand only. Loaded by skill routing in AGENTS.md when the task matches.
  Usage:    Type /dashboard-token-efficiency when the task involves:
              - dashboard architecture or sanitized JSON/HTML renderers
              - token usage breakdown views (shared context, role slices, synthesis)
              - context-budget reporting or retrieval quality metrics
              - eval visibility or latency/cost views
              - trajectory recording or safe observability sinks
              - what the dashboard is allowed to display vs what it must exclude
              - explicit loopback-only dashboard server startup behavior
-->

@.agents/skills/dashboard-token-efficiency/SKILL.md
