<!--
  Command:  /mcp-security-review
  Purpose:  Load the MCP security review skill for reviewing local or remote MCP surfaces.
  Logic:    Delegates to the shared SKILL.md in .agents/skills/ so Codex and Claude Code
            share a single source of truth. No content is duplicated here.
  Auto-load: No — on-demand only. Loaded by skill routing in AGENTS.md when the task matches.
  Usage:    Type /mcp-security-review when the task involves:
              - local STDIO MCP tool registration or filtering
              - remote-safe MCP/API surface design or review
              - filesystem access policy or path boundaries
              - secret blocking, write approvals, or command allowlists
              - audit logging or safe error response design
              - retrieval indexing safety (what gets indexed, what is blocked)
-->

@.agents/skills/mcp-security-review/SKILL.md
