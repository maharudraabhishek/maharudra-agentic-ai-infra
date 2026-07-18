# Glossary

## MCP

Model Context Protocol. A way for an AI client to call tools exposed by a server.

Example: Codex calls `safe_read_file` through the local MCP server.

## Codex

The AI coding assistant used in this workspace.

Example: Codex can inspect files, propose changes, and run allowlisted checks when tools permit it.

## AGENTS.md

Project-level instructions for AI-assisted development.

Example: `AGENTS.md` says Rudraloka uses pnpm only.

## SKILL.md

A task-specific workflow file for Codex.

Example: `.agents/skills/mcp-safe-refactor/SKILL.md` tells Codex how to refactor the MCP server safely.

## Eval Harness

A repeatable test setup for AI or tool behavior.

Example: `run_mcp_security_evals` checks that unsafe MCP operations are denied.

## RAG

Retrieval-Augmented Generation. The system retrieves relevant knowledge before asking the model to answer.

Example: Retrieve product policy docs before generating a support answer.

## Embeddings

Numeric representations of meaning.

Example: "red silk saree" and "crimson silk sari" should have nearby embeddings.

## Chunking

Breaking documents into smaller pieces for retrieval.

Example: Split a markdown document by headings before indexing.

## Vector Database

A database optimized for similarity search over embeddings.

Example: Find chunks most similar to a user's question.

## Context Window

The amount of text a model can consider at once.

Example: Retrieval must choose the best few chunks because not everything fits.

## Orchestration

Coordinating model calls, tools, retries, approvals, and outputs.

Example: Search docs, draft a patch, run checks, then summarize.

## Tool Calling

An AI model asks an external tool to do a specific action.

Example: Call `project_info` to learn MCP policy limits.

## Audit Log

A security-focused event log.

Example: Record that a patch apply was attempted and whether it succeeded.

## traceId

An ID that links related events from one operation.

Example: One eval run can have the same trace ID across app and audit logs.

## spanId

An ID for a specific operation inside a trace.

Example: A single tool call gets its own span ID.

## STDIO

Standard input/output transport for local process communication.

Example: Codex starts the local MCP server and communicates over STDIO.

## HTTPS MCP

An MCP server exposed over HTTPS.

Example: A future ChatGPT-safe MCP server should be HTTPS, authenticated, and business-safe.

## Monorepo

One repository containing multiple apps, services, packages, and docs.

Example: `apps/`, `mcp/`, `services/`, and `infra/` can live in one repo.

## Independently Deployed Microservices

Services that can be built and deployed separately.

Example: Updating an AI recommendation service should not require deploying every backend.

## GitOps

Using Git as the source of truth for deployment state.

Example: A Kubernetes change is made by merging a Git pull request.

## Controlled-Write Workflow

A write process with proposal, review, exact approval, and apply steps.

Example: `propose_file_patch` followed by `apply_approved_patch`.

## Path Traversal

An attempt to escape an allowed directory through path input.

Example: `../../.env`.

## Allowlist

A list of explicitly allowed actions.

Example: Only `typecheck`, `build`, `lint`, and `test` pnpm scripts are allowed for the MCP package.

## Deny-By-Default

Block anything not explicitly allowed.

Example: Unknown file extensions are denied until reviewed and added.

