---
name: service-scaffold
description: "Use when creating a new app, service, or package folder in the Rudraloka monorepo. Respects the chosen architecture: pnpm monorepo, independently deployed microservices, infrastructure under infra/, and later separation of AI, non-AI, and platform services."
---

# Service Scaffold

Use this skill when creating a new app, service, or package in the Rudraloka monorepo.

## Architecture Rules

Respect the chosen architecture:

- Keep the repository as a pnpm monorepo.
- Design services so they can be independently deployed.
- Put infrastructure code and deployment definitions under `infra/`.
- Preserve room for later separation of AI services, non-AI business services, and platform services.
- Keep deployment assumptions compatible with GitHub-based source control, Docker images, Kubernetes workloads, and Git-based deployment workflows.
- Use TypeScript and strict type checking.
- Prefer small composable modules with explicit boundaries.

## Before Creating Files

Clarify or infer:

- Service name and responsibility.
- Whether it is an app, backend service, worker, shared package, AI service, non-AI service, or platform service.
- Runtime, deployment target, and data ownership.
- Public API boundaries and dependencies on other packages.
- GitHub repository workflow, Docker image boundary, Kubernetes deployment shape, and Git-based promotion path.

If the choice affects architecture materially, present the proposed folder and package shape before writing files.
Explain concepts and tradeoffs before implementation prompts. Do not provide detailed implementation prompts before the user chooses an option.

## Scaffold Standards

- Use pnpm only.
- Follow existing workspace conventions for package layout, TypeScript config, linting, tests, and build setup.
- Prefer minimal initial files over speculative abstractions.
- Add explicit schemas for service inputs at trust boundaries.
- Add tests for business logic when behavior is introduced.
- Keep AI-specific code isolated from non-AI business logic unless the architecture decision says otherwise.
- Do not read or modify secrets, `.env*`, `.npmrc`, keys, tokens, or credentials.
- Do not remove `AGENTS.md`.
- Use the numbered docs structure consistently when adding or updating documentation.
- Maintain learning notes in `docs/01-learning-journal/` when scaffolding teaches an important concept.
- For service communication, deployment, CI/CD, package boundaries, and system architecture, include simple ASCII diagrams where helpful. Use Mermaid only when the flow is complex and the target doc supports it. Add a short explanation below every diagram.

## Learning Documentation

For every major service or package scaffolding task, consider whether the user learned an architecture pattern, workflow, debugging lesson, or deployment concept. If yes, add or update a detailed beginner-friendly learning note in `docs/01-learning-journal/`.

Learning notes should include what the concept means, why it matters, a mental model, a Rudraloka example, flow or architecture diagrams when useful, tradeoffs, common mistakes, how it connects to the monorepo and service architecture, and related links to `docs/02-architecture/`, `docs/04-ai-infra/`, or runbooks when useful.

For architecture decisions, update `docs/02-architecture/architecture-decisions.md` after presenting options and tradeoffs and after the user chooses.

## Verification

After creating or changing a service, run the relevant pnpm checks, scoped to the package when practical:

- `typecheck`
- `build`
- tests for changed business logic

Report the commands or MCP-controlled scripts used and their results.
