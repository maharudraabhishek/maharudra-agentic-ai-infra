# Changelog

## 0.1.0

Release-readiness baseline for MahaRudra Agentic AI Infra.

### Added

- **Engineering hygiene:** Introduced per-phase changelog folder at `changelog/`. From this point forward, every stage/phase ships with one structured entry listing Added / Changed / Deprecated / Removed / Renamed / Fixed exports. See `changelog/README.md` for the format and `AGENTS.md` § "Per-Phase Changelog Discipline" for the rule.
- Package-ready private workspace metadata for core, generator, runtime, dashboard, and test-utils packages.
- Generated-project smoke tests for blank, existing, full context, remote-safe, dashboard, Docker, dry-run, and rerun scenarios.
- Append-only managed `.gitignore` block for generated local state.
- CI workflows: `workspace-checks.yml` (typecheck/build/test/lint on push and PR), `generated-smoke.yml` (focused generator smoke matrix), and `release-readiness.yml` (manual, non-publishing release-readiness gate with pack dry-run and private-flag enforcement).
- Root `LICENSE` file declaring `UNLICENSED — All Rights Reserved` posture explicitly.
- Public framework completion matrix at `docs/02-architecture/framework-completion-matrix.md`.
- Documentation-only example workspace members for blank workspace, existing full-stack app, full agentic context, and remote-safe scenarios.
- Public docs and troubleshooting runbooks aligned with local-first and remote-safe setup boundaries.
- Internal release-readiness, CI/CD, smoke-testing, and package-publishing learning notes.
- Stage 26 Layer 10 `AgentOrchestrator` is container-wired through `RuntimeServiceContainer.orchestrator`; a corrective pass now enforces canonical identity, trace correlation, usable exact approval, output actions, typed refusals, and sanitized seam failures. Token-efficient shared-context composition remains pending.

### Safety

- Packages remain private and unpublished.
- Docker and migrations remain user-controlled.
- Release workflow never publishes packages, even when manually triggered.
- Generated runtime remains provider-free and deterministic.
