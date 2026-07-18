# Dependency Security Audit Policy

## Purpose

This policy keeps local MCP dependencies reviewable before CI/CD adds automated checks.

Dependencies are part of the security boundary. A package can add scripts, transitive code, network behavior, filesystem behavior, or provider integrations. Local MCP tooling should therefore add dependencies deliberately and keep the lockfile reviewable.

## Current Lightweight Gate

Run the audit manually when dependencies change:

```powershell
pnpm audit
```

This is documentation-first for now. No package `audit` script is added in the first quality gate pass, because the project is still establishing baseline lint/test scripts.

## Review Policy

Before adding a dependency, check:

- What problem does it solve?
- Can TypeScript or an existing dependency solve it?
- Does it execute shell commands?
- Does it read environment files?
- Does it introduce model/provider SDKs?
- Does it run install/build scripts?
- Does it add a large transitive dependency tree?
- Does it affect MCP runtime behavior or only tests/tooling?

## Explicit Approval Required

These dependency types require explicit approval before implementation:

- model/provider SDKs
- embedding provider SDKs
- paid API clients
- `dotenv` or env-file loading packages
- shell-execution libraries
- filesystem watcher libraries
- arbitrary SQL/query builders that expand DB surface area
- packages that require credentials or `.env` setup

This preserves the current local-only mock provider architecture.

## Lockfile Review

When dependencies change, review `pnpm-lock.yaml` for:

- unexpected provider SDKs
- unexpected shell execution packages
- new install/build scripts
- large dependency jumps
- duplicate major versions
- packages unrelated to the requested task

The lockfile is part of the implementation, not a background detail.

## Update Cadence

Recommended cadence before CI/CD:

- audit when dependencies change
- review security advisories before major implementation milestones
- avoid broad dependency upgrades during feature work
- batch low-risk tooling updates separately from MCP behavior changes

After CI/CD exists, this policy can become an automated dependency review and audit gate.

## Related Docs

- [MCP Security Policy](mcp-security-policy.md)
- [Local MCP AI Security Checklist](local-mcp-ai-security-checklist.md)
- [Final Local MCP Quality Gate](../06-runbooks/final-local-mcp-quality-gate.md)
