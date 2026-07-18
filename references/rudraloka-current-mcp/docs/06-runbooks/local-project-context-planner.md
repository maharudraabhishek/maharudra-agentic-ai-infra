# Local Project Context Planner

## Purpose

Milestone 5 adds `plan_project_context`, a safe advisory planner for local Rudraloka development.

The planner helps Codex or Claude decide what context strategy a task needs before doing work:

```txt
task string
   |
   v
plan_project_context
   |
   v
classification + strategy + recommendations
   |
   v
human/agent chooses the next safe step
```

This diagram shows the key boundary. The planner recommends a context path; it does not execute that path.

## What The Planner Does

`plan_project_context` returns:

- `taskType`
- `strategy`
- `recommendedQueries`
- `recommendedSources`
- `recommendedTools`
- `needsUserDecision`
- `includeSecurityContext`
- `includeArchitectureContext`
- `warnings`
- `nextSteps`

It is deterministic and heuristic-first. The same input should return the same output.

Final hardening adds safe planner observability. Planner logs and summaries may include task hashes, task length, mode, task type, strategy, recommendation counts, decision flags, and warning counts. They must not include raw task text.

## What The Planner Must Not Do

The planner must not:

- call the local AI DB
- read files
- call retrieval tools
- call model APIs
- run commands
- run migrations
- index project knowledge
- apply patches or create files
- mutate source files
- recommend arbitrary SQL or mutation/action tools

Tool recommendations are allowlisted. Unsafe tools such as `apply_approved_patch`, `apply_approved_new_file`, `run_local_ai_migrations`, `run_allowed_pnpm_script`, and `index_project_knowledge` must never appear in planner recommendations.

## Safe Example

Tool:

```txt
plan_project_context
```

Input:

```json
{
  "task": "Plan an MCP security review for project knowledge retrieval.",
  "mode": "auto"
}
```

Expected behavior:

- classifies the task as security or MCP context work
- sets `includeSecurityContext` to `true`
- recommends security policy and MCP context sources
- recommends only safe read/context/eval/observability tools
- returns bounded arrays

## Architecture Or Process Choices

When a task involves architecture, process, provider, runtime, or public exposure choices, the planner must set:

```json
{
  "needsUserDecision": true,
  "includeArchitectureContext": true
}
```

The next steps should tell the AI agent to present options and tradeoffs, give a separate recommendation, and wait for the user's choice before implementation.

## Verification

After changing planner behavior, run:

```txt
run_project_rag_evals
run_mcp_security_evals
```

Planner evals do not require the DB or local index to be ready. Retrieval evals may skip DB-dependent checks when the local DB or mock index is unavailable.

Final hardening also checks that planner arrays stay bounded, decision-required tasks are flagged, security context is included for risky work, and unsafe mutation/action tools are not recommended.

## Related Docs

- [Local MCP Context Tools](../03-mcp/local-mcp-context-tools.md)
- [Local MCP Agentic Context Engineering + RAG Design Spec](../04-ai-infra/local-mcp-agentic-context-rag-design-spec.md)
- [MCP Security Policy](../05-security/mcp-security-policy.md)
- [Agentic Context Planner](../01-learning-journal/2026-05-10-agentic-context-planner.md)
- [Final Local MCP AI Hardening](../01-learning-journal/2026-05-10-final-local-mcp-ai-hardening.md)
- [Local MCP AI Infrastructure Operations](local-mcp-ai-infra-operations.md)
