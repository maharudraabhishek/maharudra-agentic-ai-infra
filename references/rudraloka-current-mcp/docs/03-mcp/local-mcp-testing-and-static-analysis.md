# Local MCP Testing And Static Analysis

## Purpose

`mcp/rudraloka-dev-mcp` now has a small durable test and lint foundation.

The goal is not maximum coverage in one pass. The goal is a stable quality base that protects the riskiest local MCP logic before CI/CD is introduced.

```txt
unit tests
   |-- policy logic
   |-- chunking logic
   |-- planner logic
   |-- sanitizers
   `-- deterministic mock embeddings

eval tools
   |-- DB readiness skips
   |-- retrieval benchmarks
   |-- MCP security behavior
   `-- end-to-end local acceptance
```

Unit tests should stay fast, deterministic, and DB-free. MCP eval tools cover runtime and DB-dependent behavior.

## Scripts

Run from the workspace root:

```powershell
pnpm --filter rudraloka-dev-mcp run lint
pnpm --filter rudraloka-dev-mcp run test
```

Package scripts:

- `lint`: runs ESLint on `src/**/*.ts` and `tests/**/*.ts`.
- `test`: runs Vitest once.
- `test:unit`: alias for the same Vitest unit suite.
- `typecheck`: remains `tsc --noEmit`.
- `build`: remains `tsc`.

There is no `lint:fix` script yet. Fixing lint automatically can create broad churn before the baseline is stable.

## ESLint Direction

The first lint baseline uses modern ESLint flat config with `typescript-eslint` recommended rules, without type-aware linting.

Why start non-type-aware:

- It is faster for local development.
- It avoids a large noisy migration.
- Strict TypeScript already catches type errors through `typecheck`.
- Typed lint rules can be introduced later as a deliberate hardening step.

Future typed linting should be added only after this baseline is consistently clean.

## Unit Test Direction

The first Vitest suite covers:

- path traversal, secret path, and extension policy
- indexing policy and archive exclusion
- scanner metadata without file contents
- Markdown, TypeScript AST, and fallback chunking
- deterministic mock embedding dimension and repeatability
- exact migration approval text
- retrieval option bounds and filter denial
- planner safety under prompt-injection-like text
- app log and summary sanitization

The suite sets `RUDRALOKA_PROJECT_ROOT` explicitly so package-level test execution uses the workspace root policy.

## What Belongs In Unit Tests

Good unit test targets:

- pure functions
- deterministic policy checks
- bounded output logic
- sanitizer behavior
- parser/chunker fallbacks
- planner classification and recommendation allowlists

Poor unit test targets:

- live Postgres state
- Docker startup
- applied migrations
- current index contents
- end-to-end retrieval quality with DB readiness

Those belong in the MCP eval tools and the final local quality gate runbook.

## Related Docs

- [Final Local MCP Quality Gate](../06-runbooks/final-local-mcp-quality-gate.md)
- [MCP Security Eval Harness](mcp-security-eval-harness.md)
- [Local MCP Context Tools](local-mcp-context-tools.md)
- [Prompt Injection Defense](../05-security/prompt-injection-defense.md)
