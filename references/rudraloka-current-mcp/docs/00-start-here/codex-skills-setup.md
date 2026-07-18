# Codex Skills Setup

## What Skills Are

Skills are small repo-scoped operating guides for recurring Codex tasks. Each skill is a folder containing `SKILL.md` with YAML frontmatter:

```md
---
name: example-skill
description: Use when ...
---
```

The `description` tells Codex when to load the skill. The body tells Codex how to work once the skill is active.

## Why SKILL.md Exists

`SKILL.md` keeps task-specific procedure out of the global project instructions. That keeps `AGENTS.md` stable while still giving Codex detailed workflows for sensitive or repeated tasks.

Create a skill when a task has reusable rules, security constraints, review steps, or domain knowledge that should be applied consistently across future sessions.

## AGENTS.md vs SKILL.md

`AGENTS.md` is permanent project guidance. It applies broadly to Rudraloka work: pnpm-only commands, security rules, TypeScript expectations, MCP design rules, and commerce safety rules.

`SKILL.md` is task guidance. It applies when Codex is doing a specific kind of work, such as refactoring the MCP server or comparing architecture options.

## Instructions, Skills, MCP Tools, Hooks, And Evals

Instructions tell Codex how to behave.

Skills tell Codex how to run a reusable workflow.

MCP tools enforce local capabilities and safety boundaries, such as safe file reads, controlled writes, allowlisted pnpm scripts, evals, and sanitized observability summaries.

Hooks can later add deterministic workflow gates around the agent loop.

Evals test whether prompts, tool workflows, retrieval, and security behavior keep working as the system changes.

## Current Skills

`mcp-safe-refactor` is for refactoring the local Rudraloka MCP server.

`mcp-security-review` is for reviewing MCP tools, path policies, command policies, logs, audit behavior, and write workflows.

`architecture-decision` is for architecture choices.

`ai-infra-design` is for RAG, embeddings, vector databases, chunking, orchestration, context-window management, eval harnesses, AI observability, and local-vs-production AI infrastructure design.

`service-scaffold` is for creating new apps, services, or packages in the monorepo.

## How Codex Should Use Skills

First inspect existing skills before creating new ones. Do not duplicate a skill with the same purpose.

When a task matches a skill description, load that skill and follow its workflow. If the skill conflicts with `AGENTS.md`, follow the stricter project security rule and report the conflict.

When improving a skill, keep the body concise and procedural. Add only the details that future Codex sessions need to do the task safely and consistently.

