<!--
  Command:  /package-release-readiness
  Purpose:  Load the package release readiness skill for publishing prep and CI/CD gate work.
  Logic:    Delegates to the shared SKILL.md in .agents/skills/ so Codex and Claude Code
            share a single source of truth. No content is duplicated here.
  Auto-load: No — on-demand only. Loaded by skill routing in AGENTS.md when the task matches.
  Usage:    Type /package-release-readiness when the task involves:
              - package.json metadata (name, version, exports, files field)
              - verifying private:true and UNLICENSED are preserved
              - CHANGELOG updates or version bumping
              - CI/CD release workflow design or review
              - release dry-run vs actual publish decisions
              - public package documentation or README accuracy
  Warning:  This skill enforces that packages remain private:true and unpublished
            unless the user gives explicit approval. Do not override this.
-->

@.agents/skills/package-release-readiness/SKILL.md
