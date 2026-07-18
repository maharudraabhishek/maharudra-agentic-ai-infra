# Project Overview

## Purpose

Rudraloka is the main production learning project for moving from senior software engineering into AI, GenAI, and ML engineering.

The learning style is project-based. Instead of studying isolated AI concepts and then hoping they connect later, the project builds production-grade systems and explains the concepts as they become necessary.

## Product Direction

Rudraloka will grow into a full platform with:

- Web application.
- Admin dashboards.
- Native Android application.
- Native iOS application.
- Backend services deployed as independent microservices.
- AI infrastructure for developer workflows and product capabilities.

## Backend Direction

The monorepo can contain services written in different backend stacks over time:

- Python FastAPI for AI services, data workflows, and ML-adjacent APIs.
- Node.js for TypeScript-friendly web and platform services.
- Java Spring Boot for enterprise-style backend services where strong JVM patterns help.

The selected architecture direction is a monorepo with independently deployed microservices. Source code can live together while runtime services deploy separately.

## Platform Requirements

Rudraloka engineering should build toward:

- GitHub-based source control and review workflows.
- Docker images for deployable services.
- Kubernetes for service runtime later.
- Git-based deployment workflows.
- Infrastructure code under `infra/` inside the monorepo.

## AI Roadmap

The AI learning and infrastructure roadmap includes:

- MCP for safe local AI-assisted development.
- Controlled tools for reads, writes, commands, logs, and security evals.
- RAG for grounded knowledge retrieval.
- Embeddings and vector search.
- Chunking and context window management.
- Agents and orchestration.
- Eval harnesses for local tools and product AI behavior.
- AI observability for traces, quality, cost, and safety.

## Learning Model

The mental model is: learn by building the system you wish you had.

For example, MCP is not just a protocol to memorize. In Rudraloka, MCP becomes the secure bridge between Codex and the local codebase. RAG is not just a diagram. Later, it becomes the way Codex and production AI services retrieve approved Rudraloka knowledge.

