# Monorepo Platform Architecture

## Purpose

This workspace contains the Rudraloka engineering system:

- Fullstack web application.
- Local AI development infrastructure.
- MCP servers.
- Future backend microservices.
- Future RAG and agentic commerce systems.
- Infrastructure-as-code under `infra/`.

## Monorepo vs Distributed System

A monorepo is source-code organization. It means multiple apps, services, packages, docs, and infrastructure can live in one repository.

A distributed system is runtime architecture. It means multiple services run separately and communicate over APIs, queues, events, or shared infrastructure.

These are not opposites. A monorepo can contain independently deployed microservices.

## Selected Direction

Rudraloka's selected direction is:

- Monorepo for source code.
- Independently deployed microservices for runtime.
- Infrastructure under `infra/` inside the monorepo.
- Future services separated into `services/ai/`, `services/non-ai/`, and `services/platform/`.

## Why This Helps AI-Assisted Development

AI-assisted development works better when related context is close together.

In a monorepo, Codex can read architecture docs, MCP policy, service code, and infrastructure docs from one workspace. That makes safe local tools and future project indexing easier to reason about.

The tradeoff is that CI/CD must be disciplined. A monorepo should not mean "deploy everything every time."

## Deployment Model

Deployment does not need to deploy everything if CI/CD is configured correctly.

Future CI/CD should detect which service changed and build/deploy only the affected service and dependencies.

Examples:

- A change in `services/ai/recommendations` should deploy the recommendations service.
- A change in shared package code may trigger multiple dependent services.
- A docs-only change should not deploy services.

## GitHub And GitOps Implications

GitHub will be the source control and review surface.

Git-based deployment means changes flow through commits and pull requests. Later, Kubernetes or deployment systems can watch Git state and reconcile environments from it.

This gives Rudraloka a clean path to production-grade engineering practices without splitting the project into many repositories too early.

## Current Workspace Shape

Current high-level shape:

```txt
rudraloka-workplace/
├── apps/
├── mcp/
│   └── rudraloka-dev-mcp/
├── docs/
├── AGENTS.md
├── package.json
└── pnpm-workspace.yaml
```

Future expansion will add `services/` and `infra/` when there is implementation work that belongs there.

