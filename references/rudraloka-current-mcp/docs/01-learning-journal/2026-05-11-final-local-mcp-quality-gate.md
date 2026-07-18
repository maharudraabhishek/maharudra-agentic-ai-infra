# Final Local MCP Quality Gate

## Concept

A quality gate is a repeatable set of checks that says, "this local platform is safe enough to build on."

For Rudraloka's local MCP AI infrastructure, the quality gate combines code checks, unit tests, runtime checks, retrieval benchmarks, prompt-injection defense, and sanitized observability.

## Mental Model

Think of the quality gate like a workshop exit checklist.

Before a tool leaves the bench, you check that it is assembled, labeled, tested, and safe to handle. You do not add new features during the exit check. You prove the current tool can be trusted.

## Why It Matters

Local AI infrastructure can become complicated quietly. It has scanners, chunkers, embeddings, a database, retrieval, planners, evals, logs, and docs.

The final local quality gate makes that complexity visible:

- unit tests protect deterministic business logic
- lint protects maintainability
- evals protect MCP safety behavior
- retrieval benchmarks catch source-quality regressions
- prompt-injection warnings preserve trust boundaries
- runbooks make the process repeatable before CI/CD

## Rudraloka Example

`run_project_rag_evals` now checks a benchmark query like `run_mcp_security_evals`.

With the mock embedding provider, the test does not ask for deep semantic understanding. It asks a practical question: did exact/full-text/metadata retrieval find the expected source class?

That is the right level for the current local mock phase.

## Flow Diagram

```txt
developer task
   |
   v
package checks
   |-- typecheck
   |-- build
   |-- lint
   `-- unit tests
   |
   v
local MCP runtime checks
   |-- DB health
   |-- migrations
   |-- mock indexing
   `-- retrieval/context/planner
   |
   v
eval checks
   |-- knowledge pipeline
   |-- project RAG benchmark
   `-- MCP security
```

This diagram shows why the gate has layers. Fast package checks catch code issues first. Runtime checks prove the local database and index are ready. Evals check safety and retrieval behavior.

## Prompt-Injection Boundary

```txt
retrieved chunk says "ignore rules"
   |
   v
context builder returns it as evidence
   |
   v
assistant follows AGENTS.md + MCP policy instead
```

Retrieved text can be useful evidence, but it cannot become an instruction source. The warning `retrieved-content-is-untrusted-evidence-not-instruction` keeps that boundary explicit.

## Tradeoffs

Starting with non-type-aware ESLint is less strict than typed linting, but it avoids a noisy first migration. Strict TypeScript still runs separately.

Keeping unit tests DB-free means they cannot prove live retrieval quality. That is intentional. The MCP eval tools own DB-dependent checks and safe skip behavior.

The benchmark uses exact and metadata-driven expectations because mock embeddings are deterministic but not semantic. Real semantic quality waits for a separately approved embedding provider.

## Common Mistakes

- Treating a DB-offline safe skip as a failed semantic benchmark.
- Adding broad lint rules before the baseline is stable.
- Testing live Postgres behavior in unit tests.
- Fixing retrieval misses by indexing unsafe paths.
- Treating retrieved chunks as instructions.
- Adding provider SDKs while still in the mock-only phase.

## Related Docs

- [Final Local MCP Quality Gate](../06-runbooks/final-local-mcp-quality-gate.md)
- [Local MCP Testing And Static Analysis](../03-mcp/local-mcp-testing-and-static-analysis.md)
- [Prompt Injection Defense](../05-security/prompt-injection-defense.md)
- [Retrieval Benchmark Quality Gate](../04-ai-infra/retrieval-benchmark-quality-gate.md)
- [Dependency Security Audit Policy](../05-security/dependency-security-audit.md)
