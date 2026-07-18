<!--
  Command:  /agentic-context-design
  Purpose:  Load the agentic context design skill for retrieval, context, and token efficiency work.
  Logic:    Delegates to the shared SKILL.md in .agents/skills/ so Codex and Claude Code
            share a single source of truth. No content is duplicated here.
  Auto-load: No — on-demand only. Loaded by skill routing in AGENTS.md when the task matches.
  Usage:    Type /agentic-context-design when the task involves:
              - retrieval provider design (full-text, pgvector, document-tree, page-index,
                symbol/code, graph, hybrid)
              - context builder or context optimizer
              - token budget management or heuristic token counting
              - single-agent or token-efficient multi-agent executor
              - shared context packet or role slicing
              - cache/freshness policy
              - what gets indexed vs blocked from retrieval
-->

@.agents/skills/agentic-context-design/SKILL.md
