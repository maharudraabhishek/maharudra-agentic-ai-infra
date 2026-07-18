# Agentic Context Planner

## Concept

An agentic context planner decides what kind of project context an AI assistant should gather before answering or implementing.

For Rudraloka Milestone 5, the planner is advisory only. It classifies a task, chooses a strategy, recommends queries, sources, safe tools, warnings, and next steps, then stops.

It does not execute tools automatically.

## Mental Model

Think of the planner like a checklist writer before a workshop.

It can say, "For this job, bring the security policy, architecture decisions, and eval reports." It cannot pick up tools, change files, run commands, or make decisions for the user.

## Why It Matters

AI assistants can move too quickly if every task starts with direct file reads or implementation. A planner makes the first step safer:

- security-sensitive work gets security context
- architecture choices ask for a user decision
- docs and learning updates are remembered
- recommendations stay bounded
- unsafe mutation tools are not recommended

This is especially important for MCP tools because MCP connects an AI client to real local capabilities.

## Rudraloka Example

Task:

```txt
Add a new MCP context tool for project retrieval.
```

The planner should notice MCP, context tooling, retrieval, and source changes. It should recommend security context and implementation sources, but it should not call `safe_read_file`, `get_relevant_context`, or any other tool by itself.

```txt
User task
   |
   v
plan_project_context
   |
   |-- classify task
   |-- select strategy
   |-- recommend sources/tools
   |-- flag user decisions
   `-- return warnings/next steps
   |
   v
AI agent chooses next action with user rules still in charge
```

This diagram shows the planner as a decision helper, not an executor.

## Safety Boundary

The planner must not call:

- database tools
- filesystem reads
- retrieval tools
- model APIs
- command tools
- migration tools
- indexing tools
- patch or new-file apply tools

It also must not recommend mutation/action tools such as `apply_approved_patch`, `apply_approved_new_file`, `run_local_ai_migrations`, `run_allowed_pnpm_script`, `index_project_knowledge`, or arbitrary SQL.

## Tradeoffs

Heuristics are transparent, free, and deterministic. They are easy to test and debug.

The tradeoff is that heuristics are not deeply semantic. A task can be ambiguous, and the planner may recommend extra context or miss a subtle need. That is acceptable for Milestone 5 because the planner is advisory and bounded.

## Common Mistakes

- Letting the planner execute the strategy it recommends.
- Connecting the planner directly into `get_relevant_context` before evals are stable.
- Recommending mutation tools from a context planner.
- Forgetting that architecture and process choices need options/tradeoffs before implementation.
- Treating planner output as permission to bypass AGENTS.md.

## How It Connects To The Current Architecture

Milestone 5 sits above Milestone 4 retrieval.

```txt
Milestone 4 retrieval/context builder
   ^
   |
Milestone 5 advisory planner
```

The planner can recommend retrieval, but retrieval does not automatically call the planner yet. This keeps both pieces easy to test.

## Related Docs

- [Local MCP Context Tools](../03-mcp/local-mcp-context-tools.md)
- [Local MCP Agentic Context Engineering + RAG Design Spec](../04-ai-infra/local-mcp-agentic-context-rag-design-spec.md)
- [Local Project Context Planner Runbook](../06-runbooks/local-project-context-planner.md)
- [MCP Security Policy](../05-security/mcp-security-policy.md)
