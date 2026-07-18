<!--
  Command:  /cli-template-design
  Purpose:  Load the CLI template design skill for generator, profile, and scaffold work.
  Logic:    Delegates to the shared SKILL.md in .agents/skills/ so Codex and Claude Code
            share a single source of truth. No content is duplicated here.
  Auto-load: No — on-demand only. Loaded by skill routing in AGENTS.md when the task matches.
  Usage:    Type /cli-template-design when the task involves:
              - CLI command behavior (init, validate, doctor)
              - config profiles (minimal, secure-readonly, controlled-write, etc.)
              - template folder structure or file generation logic
              - generated project path contracts
              - scaffold verification or dry-run behavior
              - safe writer conflict handling or overwrite policy
-->

@.agents/skills/cli-template-design/SKILL.md
