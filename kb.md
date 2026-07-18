# kb.md — Orchestrator Knowledge Base

Append-only. One entry per session. Most recent at bottom.

---

## Session — 2026-05-14 (Sessions 0, 1, 2)

- STDIO transport gap closed. LocalStdioMcpRuntimeAdapter.start() returns
  McpServer in RuntimeHandle.server. Generated start.ts wraps startup in
  async main(), connects StdioServerTransport, process.exit(1) on failure.
  stdout reserved for MCP protocol, stderr for diagnostics only.

- EmbeddingProvider interface is provider-agnostic (Option D confirmed).
  MockEmbeddingProvider: SHA-256 deterministic, 64-dim, no network.
  LocalEmbeddingProvider: Ollama/LocalAI/LM Studio HTTP, configurable
  promptField/embeddingField. OpenAI nested-response format requires
  custom EmbeddingProvider implementation by caller.
  PgVectorProvider accepts optional EmbeddingProvider — falls back to
  deterministicVector() with retrieval.mock-embedding warning when absent.

- Chunking pipeline: pure TypeScript, no external libs, stateless.
  MAX_CHUNK_CHARS=2000, CHUNK_OVERLAP_CHARS=200, MAX_CHUNKS_PER_FILE=120.
  dispatchChunker routes by extension: .md → heading, .ts/.tsx → symbol,
  else → fallback sliding window. chunkTypeScriptBySymbols is regex-only,
  no AST dependency.

- Indexer: lstat-only (symlinks rejected), content read after all policy
  checks pass, hash-only reports (never raw content or vectors in summary).
  Two-pass idempotency: fileHash pre-chunking + chunk count+hash post-chunking.
  Force-reindex approval text: "REINDEX_AGENTIC_AI_KNOWLEDGE" (exact match).
  Per-file errors isolated — never abort full run.

- KnowledgeIndexStorageCapability interface not yet in core.
  indexProjectKnowledge() duck-types the storage call — no-ops safely
  when capability absent. Intentional for testability.
  Implementing on PostgresStorageProvider is Batch 2, depends on
  migrations 002 and 003 landing first.

---

## Session — 2026-05-15 (Tasks 5, 6, 7)

- quota.config.json entry in STRUCTURE.md verified accurate. No edit needed.

- templates/ folder was empty (Case B). Deleted. STRUCTURE.md corrected to
  point to templates.ts as sole source of truth. 3 test scanner failures
  fixed via fs.access() guards in bin-and-docs.test.ts.

- PolicyEnforcingToolRegistry implemented in runtime/tools/index.ts.
  Wraps InMemoryToolContractRegistry. Three static checks at register():
  remote-safe predicate for remote modes, critical risk level always blocked,
  shell/command blocked unless local config explicitly allows.
  createRuntimeToolRegistry() accepts optional RuntimeConfig.
  InMemoryToolContractRegistry TSDoc updated to document policy-agnostic intent.

- Test count confirmed 112/112 passing across 19 test files (5 core,
  5 runtime, 2 dashboard, 7 cli). 87 figure was a partial run mid-session.

---

## Open questions

- Batch 2 dependency order: Migration 002 (HNSW) → Migration 003 (search fn)
  → KnowledgeIndexStorageCapability in core → PostgresStorageProvider implements
  it → hybrid retrieval service → memory tools (Phase 7).
- rudraloka reference diff not yet done — planned as separate session
  after architecture recon completes.
- kb.md manual paste will be retired once memory.decisions.record MCP
  tool ships (Phase 7).
---

## v3 Architecture decisions (Stage 0 — 2026-05-16)

### Agreed by ChatGPT + Claude (pending user approval)

- v3 = 14 production layers + 6 internal planes + 4 cross-cutting concerns + 12 engineering disciplines
- Layer numbering is canonical: 0–13. Session=Layer 4. Agent Runtime=Layer 10. LLM SmartRouter=Layer 11.
- 6-plane mapping: Control(0,1,3) | Data(2,5,12) | Knowledge(6,7,8) | Memory/Agent(4,9,10) | Model(11) | Delivery(13)
- 4th cross-cutting concern: Governance & Compliance (model inventory, audit rules, risk register, NIST AI RMF)
- Layer 8 renamed: "Adaptive Retrieval & Context Engineering"
- Universal layer contract: every layer exposes typed contracts, default impl, plugins, profile config, policy, OTel, evals
- Filesystem: knowledge store removed from profiles; artifact store (.agentic-local/) stays built-in
- Graph storage: Postgres relational edges default; Kuzu/AGE/Neo4j as optional plugins
- Storage principle: Postgres-first not Postgres-only. JSONL for audit. Filesystem for procedural source of truth. Redis optional.
- Profile family corrected: minimal/secure-readonly = no DB, no RAG. vectorless-postgres = P1. local-context = Postgres+pgvector. hybrid-rag = P2.
- Fine-tuning: P3 only. Needs eval data first.
- Agent build order: single → session/thread → supervisor multi-agent → specialist agents → swarm later
- AI infra pipeline IS the architecture in motion (Knowledge Plane + 10-step retrieval stack). No separate pipeline discussion needed.
- Stage 4 filesystem cleanup = real code change with tests, not doc-only

### Stage 1–5 sequence locked
1. CI fix + vector(32→64) + migration 003
2. Postgres persistence + mandatory policy registry (no bypass)
3. Live agentic.retrieval.search + agentic.context.build
4. Filesystem profile cleanup (code + profile tests + docs)
5. End-to-end smoke test + v3 docs

### Reference docs
- docs/internal/v3-architecture-snapshot.md — canonical v3 reference
- docs/internal/full-architecture-recon.md — source-verified gap analysis
- docs/internal/reference-rudraloka-mcp-diff.md — reference implementation diff

---

## Session — 2026-05-16 (Stage 5)

- Timestamp format in session-summary.mjs changed to dual format:
  YYYY-MM-DD HH:MM <LocalTZ> (HH:MM UTC). Local timezone detected via
  Intl.DateTimeFormat().resolvedOptions().timeZone. formatDateTime() rewritten
  using Intl.DateTimeFormat.formatToParts() to avoid locale ambiguity.

- hasIndexStorageCapability() exported from runtime/retrieval/indexer.ts.
  TSDoc updated with example. Internal call at indexProjectKnowledge unchanged.

- E2E smoke test added at test-utils/src/e2e-smoke.test.ts (7 assertions).
  Covers: config validates for local-context, MockEmbeddingProvider init,
  hasIndexStorageCapability false for in-memory store, RetrievalRouter empty
  results, ContextBuilder empty context, agentic.retrieval.search not-configured,
  agentic.context.build not-configured. Passes in CI without Postgres.
  test-utils tsconfig excludes *.test.ts from tsc; package.json adds core+runtime
  as devDependencies.

- docs/internal/v3-architecture-snapshot.md created — canonical v3 layer map
  (14 layers, 6 planes, 4 cross-cutting concerns, universal layer contract),
  current state vs target matrix updated to reflect Stages 1–5 (all items ✅),
  Stage 1–5 implementation history table, known gaps table.

- pnpm run ci passes: build ✓ typecheck ✓ 131/131 tests ✓ lint ✓
  (124 prior tests + 7 new smoke tests).

- Stage 1–5 sequence complete. All locked items shipped.

---

## Session — 2026-05-16 (Stages 7 + 8)

- vectorless-local is the 8th built-in profile. Uses type:"memory" storage
  (InMemoryStorageProvider). No Docker, no Postgres, no migrations needed.
  Data lost on restart. Opt-in via --profile flag; default remains minimal.

- Dual-path retrieval design (Stage 8 decision, locked):
  getChunks(filePath?: string): KnowledgeChunk[] added to KnowledgeIndexStorage
  Capability. InMemoryStorageProvider returns from Maps. Postgres returns [].
  Retrieval providers call effectiveCorpus() which calls getChunks() — if non-empty,
  converts to IndexedDocument/IndexedChunk via chunksToCorpus() and scores
  in-memory. If empty or absent, validateInput returns notIndexed.
  This avoids a second SQL-query path inside providers; Postgres retrieval
  remains corpus-based (caller passes pre-built corpus or empty).

- createRuntimeServiceContainer() auto-wires two things for vectorless-local:
  1. InMemoryStorageProvider (from storage config type:"memory")
  2. RetrievalRouter with storage-backed FullTextProvider, DocumentTreeProvider,
     SymbolCodeProvider (when retrieval enabled + getChunks present on storage)
  Explicit options.retrievalRouter always takes precedence over auto-wired.

- CorpusRetrievalProvider.effectiveCorpus() priority: static corpus → storage
  chunks → undefined. validateInput() only fires not-configured when BOTH
  corpus AND storage are absent. Empty storage returns notIndexed.

- All six retrieval providers now use const corpus = this.effectiveCorpus()!
  inside retrieve() instead of this.corpus!. Prevents null crash if storage
  path is ever reached unexpectedly in other providers.

- FullTextProvider, DocumentTreeProvider, SymbolCodeProvider gained explicit
  public constructors (id, corpus?, storage?). Required because base class has
  protected constructor — TypeScript doesn't automatically widen inherited
  implicit constructors to public in all call sites.

- pnpm typecheck ✓ build ✓ test 131/131 ✓ lint ✓ (no new tests added —
  existing corpus-based tests cover all providers; storage-path coverage comes
  from the end-to-end smoke test when vectorless-local profile is active).

<!-- Last updated: 2026-05-16 06:39 IST (01:09 UTC) — Stage 4 complete -->
<!-- Last updated: 2026-05-16 06:56 IST (01:26 UTC) — Stage 5 complete -->
---

## Session — 2026-05-16 (Stage 9)

- execute() made async on both SingleAgentExecutor and TokenEfficientMultiAgentExecutor.
  Required because session/thread lifecycle calls (createSession, openThread, recordToolCall)
  are async. Existing tests updated to await the call — no behaviour change for callers
  that already awaited the result.

- createSessionManager(db | null) uses a null-check, not instanceof, to pick between
  PostgresSessionManager and InMemorySessionManager. Dependency inversion preserved:
  the factory takes a QueryableDatabase interface, not a concrete class. Callers pass
  null when no DB is available; the factory does not import or reference
  PostgresStorageProvider directly.

- InMemorySessionManager is auto-selected for the vectorless-local profile because the
  runtime container duck-type checks storageProvider.db and passes null when the getter
  is absent (InMemoryStorageProvider has no .db). No special-casing of profile names
  anywhere in the wiring path.

- PostgresStorageProvider.db added as a public getter exposing the injected
  QueryableDatabase. Used exclusively for duck-type extraction in
  createRuntimeServiceContainer() — never as a general-purpose escape hatch.

- TokenEfficientMultiAgentExecutor shares ONE AgentSession and ONE AgentThread across
  all sub-agent role executions within a single multi-agent run. The thread remains
  open for the full duration; tool calls from all roles are recorded under the same
  thread. Rationale: the multi-agent run is logically one task, not N independent tasks.

- Session and thread lifecycle failures (createSession, openThread, recordToolCall) are
  non-fatal. Each is wrapped in try/catch; failures emit a console.warn and the agent
  execution result is always returned to the caller. This avoids a bad DB connection
  or a race condition silently dropping an agent response.

<!-- Last updated: 2026-05-16 22:19 GMT+5:30 (16:49 UTC) -->

---

## Session — 2026-05-16 (Stage 10)

- examples package created as @maharudra/agentic-ai-infra-examples (workspace root
  examples/). pnpm-workspace.yaml updated to add "examples" member alongside "examples/*".
  tsconfig.json requires "types": ["node"] explicitly — root @types/node is not
  auto-included without it even when the package is in examples/node_modules.

- vectorless-local end-to-end flow confirmed working:
  DefaultProfileResolver → createRuntimeServiceContainer (auto-wires InMemoryStorage
  Provider + RetrievalRouter + InMemorySessionManager) → LocalStdioMcpRuntimeAdapter
  .start() → indexProjectKnowledge(MockEmbeddingProvider) → SingleAgentExecutor
  .execute() → agentic.retrieval.search handler → stdout JSON → handle.stop().
  7 files indexed, 39 chunks, 10 results for query "example".

- P1 complete. Stages 6–10 shipped. P2 starts with hybrid-rag profile +
  PostgresSessionManager activation + SmartRouter design.

- RESULTS_SUMMARY rule and feedback memory not fired at end of Stage 10 initially
  (user caught it). Rule: always output RESULTS_SUMMARY block after every multi-step
  task, even if the session is closing.

<!-- Last updated: 2026-05-16 22:59 GMT+5:30 (17:29 UTC) -->

---

## Session — 2026-05-17 (Stage 11: CLI profile + config coherence)

- CLI default profile changed from "secure-readonly" to "vectorless-local".
  Rationale: vectorless-local requires no Docker, no Postgres, no migrations —
  it is the correct zero-dependency onramp for new users. Users who need Postgres
  must pass --profile local-context (or a higher profile) explicitly.

- "filesystem" storage type eliminated from CLI output. buildStorageProviders()
  in config-factory.ts now routes: vectorless-local → type:"memory" with
  id:"in-memory-store"; all other retrieval-enabled profiles → type:"postgres"
  with connectionRef. No code path in the CLI can produce type:"filesystem".
  The core DefaultConfigValidator rejects filesystem with
  config.filesystem-storage-not-implemented.

- CLI_PROFILE_NAMES in types.ts now has 8 entries (was 7). "vectorless-local"
  inserted between "controlled-write" and "local-context" to match the ordering
  in core/src/profiles/types.ts BUILT_IN_PROFILE_NAMES.

- profile-config-smoke.test.ts added as anti-drift gate: iterates over every
  CLI_PROFILE_NAMES entry, calls normalizeInitOptions → createProjectConfig →
  DefaultConfigValidator, and asserts result.ok === true. If a future profile is
  added to core but not wired correctly in the CLI, this test catches it.

- vectorless-local-generation.test.ts added as regression guard: asserts no
  filesystem storage type, at least one memory provider, no "filesystem" string
  in any generated file content, no Docker Compose when withDocker is false.

- Test count: 140 → 152 (+12 new tests: 8 profile smoke + 4 vectorless-local).
  pnpm typecheck ✓ build ✓ test 152/152 ✓ lint ✓

<!-- Last updated: 2026-05-17 17:33 GMT+5:30 (12:03 UTC) -->

---

## Session — 2026-05-17 (Stage 12: StorageProvider.close() formal + pg.Pool)

- close() promoted to a formal method on the StorageProvider interface in
  core/src/storage/types.ts. TSDoc specifies: idempotent, must be called before
  process exit, in-memory clears state, Postgres drains pool.

- InMemoryStorageProvider: #closed private class field added; close() checks
  the flag and returns early on second call. Functionally idempotent before
  this change (Map.clear() on empty map is a no-op), but now formally guarded.

- PostgresStorageProvider migrated from bare pool creation to configurable pool:
  - Pool defaults: min:2, max:10, idleTimeoutMillis:30000, connectionTimeoutMillis:5000
  - Constructor params gains optional pool?: PoolConfig — merged over defaults;
    connectionString always taken from top-level param, never from pool overrides
  - #closed flag added; close() sets flag before calling pool.end(), second call
    returns immediately
  - healthCheck() now uses pool.connect() / client.query("SELECT 1") /
    client.release() pattern for the lazy-pool path; injected-database path
    unchanged (direct query on injected adapter)

- NOTE: PostgresStorageProvider already used pg.Pool (not pg.Client) from prior
  stages — the Stage 12 spec's "replace pg.Client with pg.Pool" referred to the
  original design intent. The actual change in this stage was adding pool config
  options, defaults, and idempotent close().

- RuntimeHandle.stop() shutdown path: storageProvider?.close() was NOT already
  wired. Added in this stage. LocalStdioMcpRuntimeAdapter.start() now returns a
  custom handle (not stoppedHandle()) whose stop() calls storageProvider?.close()
  before returning ok(undefined). stoppedHandle() is unchanged (still used by
  remote adapters which manage their own lifecycle).

- examples/src/vectorless-local/index.ts: duck-typed close workaround removed.
  handle.stop() now handles storage cleanup via the formal interface.

- IMPORTANT correction from Stage 11 RESULTS_SUMMARY next_steps:
  Stage 11b/11c/11d (hybrid-rag, SmartRouter) are NOT P2 work.
  Per p2-p6-complete-design.md, hybrid-rag is Stage 18 (P3) and SmartRouter
  is Stage 19 (P3). P2 continues with Stage 13: SQL-backed retrieval.

- pnpm typecheck ✓ build ✓ test 152/152 ✓ lint ✓

<!-- Last updated: 2026-05-17 17:56 GMT+5:30 (12:26 UTC) -->

---

## Session — 2026-05-17 (Stage 13: SQL-backed retrieval)

### DECISION — getChunks() interface changed to async (Promise<KnowledgeChunk[]>)

The interface was synchronous. PostgreSQL queries are inherently async; Node.js
has no synchronous Postgres driver. Options evaluated:

1. Keep sync (return []) + duplicate SQL inside each provider → code duplication,
   harder to maintain, providers with no SQL path (DocTree, SymbolCode) still
   don't work with Postgres.
2. Change interface to async → one SQL implementation in getChunks() serves all
   6 providers. In-memory path wraps with Promise.resolve() (trivial overhead).
   All call sites are inside async retrieve() methods so await adds no complexity.

Decision: option 2 chosen. Interface changed; both providers updated.

### Providers that gained SQL paths

- FullTextProvider: SQL path using `search_vector @@ plainto_tsquery('english', $1)`
  + `ts_rank` when `storage.db` is non-null. GIN index on search_vector used.
- PgVectorProvider: SQL path using pgvector `<=>` cosine operator + HNSW index
  when `storage.db` is non-null AND `EmbeddingProvider` is injected.
  Returns `retrieval.not-configured` when Postgres is detected but no
  EmbeddingProvider is present — no mock-embedding fallback for SQL path.

Providers without SQL paths (DocTree, SymbolCode, PageIndex, Graph) use
`getChunks()` bulk SQL fetch for Postgres, then score in memory. Correct but
less efficient — native SQL paths planned for future stages.

### Schema column mismatches (task SQL vs actual migrations.ts)

Task spec SQL used column names that don't match the actual schema:
- `file_path` → actual: `source_id` (holds file path value; aliased in queries)
- `chunk_index` → actual: `ordinal`
- `chunk_type` → no such column; source_type comes from JOIN to agentic_sources
- `source_hash` → no such column; content_hash from JOIN to agentic_sources
- `contentHash` is not persisted; recomputed from content in getChunks() SQL path

All queries use the actual column names with aliases where needed.

### recordIndexRun() status: ADDED in this stage

indexProjectKnowledge() did not call recordIndexRun() before Stage 13. The
function returned the summary directly without recording the run. Fixed: a
`KnowledgeIndexSummary` is now constructed before returning, and
`recordIndexRun(summary)` is called when `canPersist` is true. Failure is
silently swallowed so a bad DB connection never invalidates the index run.

### validateInput() signature change

Base class `validateInput()` was `sync → FrameworkResult<void>`. Changed to
`async → Promise<FrameworkResult<RetrievalCorpus>>`. Returns the resolved corpus
on success so providers call effectiveCorpus() exactly once (not twice). Type
narrowing in TypeScript allows `return validated` in the error case because the
error shape `{ ok: false; error: FrameworkError }` is structurally compatible
with any `FrameworkResult<T>`.

### Test counts

152 → 159 (+7 in packages/agentic-ai-infra-runtime/test/sql-retrieval.test.ts)

pnpm typecheck ✓ build ✓ test 159/159 ✓ lint ✓

<!-- Last updated: 2026-05-17 21:43 GMT+5:30 (16:13 UTC) -->

---

## Session — 2026-05-17 (Stage 14: Real Postgres activation + migration verification)

### Schema mismatch corrections: NONE

All Stage 13 SQL queries already use correct column names from migrations.ts:
- `agentic_chunks`: `source_id` (not file_path), `ordinal` (not chunk_index),
  `search_vector` (generated tsvector), `heading_path`, `content`, `token_estimate`
- `agentic_sources` (via JOIN): `source_type`, `content_hash`, `source_version`
- `agentic_embeddings`: `embedding` (vector(64) after migration 003), `chunk_id`
- getChunks() uses `c.source_id AS file_path`, `c.ordinal AS chunk_index` — aliases correct
- FullTextProvider SQL: `c.source_id AS file_path`, `c.search_vector` — correct
- PgVectorProvider SQL: `c.source_id AS file_path`, `e.embedding <=> $1::vector` — correct

### PostgresSessionManager.db getter after Stage 12: VERIFIED

Stage 12 did not change the `db` getter. Returns `this.params.database` (injected
QueryableDatabase only). For connectionString-only providers, `db` returns `undefined`
and `InMemorySessionManager` is selected. This is intentional per Stage 9 design —
documented in kb.md Stage 9 entry. verify-postgres.ts explicitly injects the pool as
a `QueryableDatabase` to exercise `PostgresSessionManager` in the script context.

### Migration startup sequence (CHANGE 4)

Sequence in `startLocalRuntime()` after CHANGE 4:
1. `createRuntimeServiceContainer(config, options)` → resolves profile + auto-wires providers + session manager
2. `storageProvider.runMigrations(RUN_AGENTIC_AI_INFRA_MIGRATIONS)` — IFF provider.type === "postgres" AND env var set
   - On failure: returns `fatal("storage.migration-failed", ...)` — never swallowed
   - On success: logs applied/skipped counts
   - Env var absent + Postgres: `console.warn("Migrations not run...")` advisory
   - In-memory provider: silently skipped (type !== "postgres")
3. `storageProvider.assertEmbeddingDimension(MOCK_EMBEDDING_DIMENSION)` — duck-typed
4. `LocalStdioMcpRuntimeAdapter.start()` — registers tools, creates MCP server

### Docker-on-Windows notes

- Port 5433 (not 5432) avoids conflict with any system Postgres installation
- pgvector/pgvector:pg16 image has pgvector pre-installed — no manual extension install needed
- Named volume `agentic_postgres_data` survives `docker compose down` (data persists)
- Healthcheck: `pg_isready -U agentic_ai -d agentic_ai_local` — required for scripts that wait for ready state
- PowerShell env vars: `$env:RUN_AGENTIC_AI_INFRA_MIGRATIONS = "true"` (string, not boolean)

### New error code: `"storage.migration-failed"`

Added to `ErrorCode` in `packages/agentic-ai-infra-core/src/errors/index.ts`.
Used by `startLocalRuntime()` when `runMigrations()` returns a failure result or throws.

### verify-postgres.ts design notes

- Uses injected pool (`new pg.Pool(...)` wrapped as `QueryableDatabase`) for both
  `PostgresStorageProvider` and `createSessionManager` — this activates `PostgresSessionManager`
- Imports from built packages (`@maharudra/agentic-ai-infra-runtime`) via workspace symlinks
- Step 4 (indexing) creates and cleans up a temp directory — no test artifacts left behind
- Step 6 (retrieval) accepts both ok and not-indexed codes — tsvector may not match "test"
- NOT part of pnpm run ci — run manually after `docker compose up -d postgres`

pnpm typecheck ✓ build ✓ test 159/159 ✓ lint ✓

<!-- Last updated: 2026-05-17 22:04 GMT+5:30 (16:34 UTC) -->

---

## Session — 2026-05-17 (Stage 15: local-context example end-to-end)

### local-context profile auto-wiring: CONFIRMED (with one key caveat)

`createRuntimeServiceContainer(resolvedConfig, { storageProvider })` auto-wired the
`RetrievalRouter` correctly for `local-context`. When `PostgresStorageProvider` is passed
via options, the container detects `getChunks` present on the provider and auto-creates
`FullTextProvider`, `DocumentTreeProvider`, `SymbolCodeProvider` all backed by Postgres.

**Caveat — session manager path:** `PostgresStorageProvider` constructed with
`connectionString` only has `.db === undefined`. The duck-type check in
`createRuntimeServiceContainer` finds no `QueryableDatabase` and selects
`InMemorySessionManager`, NOT `PostgresSessionManager`. This is intentional per Stage 9
design — `PostgresSessionManager` requires an injected `QueryableDatabase`. The example
documents this in TSDoc and notes the `verify-postgres.ts` injection pattern as the
upgrade path. For the Stage 15 example, `InMemorySessionManager` is correct since
the goal is to prove Postgres-backed RETRIEVAL (chunks), not Postgres-backed SESSIONS.

### runMigrations pattern: EXACT MATCH with startLocalRuntime()

The migration block in the example matches `startLocalRuntime()` exactly:
1. Check `storageProvider.type === "postgres"` AND `envMigrations` set
2. Call `storageProvider.runMigrations(RUN_AGENTIC_AI_INFRA_MIGRATIONS)` directly
3. Fatal on failure — process exits before indexing begins
4. Advisory tip when env var absent (parallel to the console.warn in startLocalRuntime)

No adaptation was needed. The pattern transfers cleanly because the example owns the
concrete `PostgresStorageProvider` type (not the `StorageProvider` interface), so
`runMigrations` is directly callable without duck-typing.

### session_id and thread_id visibility

`SingleAgentRunReport` does NOT expose session_id or thread_id. The example works around
this by passing a known `sessionId = randomUUID()` to the `SingleAgentExecutor`
constructor. The executor calls `resumeOrCreateSession(sessionId, ...)` internally,
which means `sessionId` IS the live session identifier. This ID is printed to stdout.

`thread_id` is internal to the executor (opened and closed inside `execute()`). The
example uses `run_id` from `SingleAgentRunReport` as the proxy run identifier. Both IDs
appear in the stdout JSON, proving that session tracking fired for this run.

### Postgres connection error handling edge cases

- Missing `DATABASE_URL`: exits 0 (not 1) — configuration gap, not a crash
- Migration failure: exits 1 after calling `storageProvider.close()` to drain pool
- Container creation failure: exits 1 after pool drain
- Adapter start failure: exits 1 after pool drain
- All other errors inside try block: finally always calls `storageProvider.close()`

The `#closed` flag in `PostgresStorageProvider` ensures that multiple close() calls
(e.g., from an error path + the finally block) are safe and idempotent.

### No new tests

Stage 15 adds no test files. The example requires a live Postgres instance and is
verified manually with `docker compose up -d postgres`. CI (pnpm run ci) remains at
159/159 — no Postgres dependency in the test suite.

<!-- Last updated: 2026-05-17 23:23 GMT+5:30 (17:53 UTC) -->

---

## Session — 2026-05-17 (Stage 16: Generated project smoke coverage)

### Stage 11 assertions already present — not duplicated

- `normalizeInitOptions(...)` returns `ok: true` per profile — present in
  `profile-config-smoke.test.ts` (Stage 11). Not repeated.
- `DefaultConfigValidator.validate()` returns `ok: true` per profile — present
  in `profile-config-smoke.test.ts` (Stage 11). Not repeated.
- No filesystem storage type in vectorless-local config — present in
  `vectorless-local-generation.test.ts` (Stage 11). Stage 16 adds per-profile
  and per-plan-item variants covering all 8 profiles and all WritePlan items.
- No docker-compose when withDocker is false — present in
  `vectorless-local-generation.test.ts` (Stage 11). Stage 16 adds plan-item
  variant asserting on WritePlan item content directly.

### New assertions added by Stage 16

CHANGE 1 — profile-config-smoke.test.ts (extended, no new test count):
- (a) Explicit `not.toBe("filesystem")` assertion on each storage provider per
  profile. Added inside existing `it()` blocks — surfaces the regressing
  provider by name if the validator path is ever bypassed.
- (c) `(config.project as { name: string }).name` is non-empty — regression
  guard for `slugifyProjectName` and `projectName` default logic.
- (b) Per-profile retrieval/storage expectations:
  — NO_RAG_PROFILES: retrieval providers empty or all non-pgvector.
  — vectorless-local: at least one memory provider; no pgvector provider.
  — POSTGRES_PROFILES: second normalization with retrieval:["full-text"]
    asserts postgres storage provider + at least one retrieval provider.

CHANGE 2 — generated-project-smoke.test.ts (Stage 16 describe block, +9 tests):
- Uses `createWritePlan({ files, options, cwd: tempRoot })` directly without
  `executeWritePlan`. All items get `action: "create"` since tempRoot is fresh.
- 5 tests for vectorless-local (a, b+c, d, e, f).
- 4 tests for local-context with retrieval:["full-text"] (g-b+c, g-d, g-e, g-f).

### Planner API adaptation note

`createWritePlan` required no adaptation. The function is already fully
synchronous-safe for test use: it reads existing files via `readExistingFile`
(returns `undefined` for fresh temp dirs → `action: "create"` for all items)
and returns a `CliResult<WritePlan>` without writing anything. `dryRun: true`
in options is propagated into `plan.dryRun` — tests assert this flag is set.

### Open gaps carried forward to Stage 17

(1) PostgresSessionManager not proven with real DB in CI:
    connectionString-only PostgresStorageProvider has `.db = undefined`, so
    the duck-type check in createRuntimeServiceContainer selects
    InMemorySessionManager. Blocks P2 checklist item. Fix in Stage 17.
(2) thread_id not in SingleAgentRunReport — run_id used as proxy in Stage 15
    example. Trajectory persistence in Stage 17 requires thread_id to link tool
    calls to threads. Must add thread_id to SingleAgentRunReport or expose via
    executor options.

pnpm typecheck ✓ build ✓ test 168/168 ✓ lint ✓
Total: 159 → 168 tests (+9)

<!-- Last updated: 2026-05-17 23:54 GMT+5:30 (18:24 UTC) -->

---

## Architecture Note — Needle in a Haystack Mitigation

Problem: LLMs recall information reliably from the start and end of a
context window but poorly from the middle, even when the content is present.
This affects RAG pipelines at two layers:
  1. Retrieval layer — wrong chunks retrieved (needle never enters context)
  2. Context placement — right chunks retrieved but buried in prompt middle

Mitigations already designed into the roadmap:
  - Stage 18: HeuristicReranker (exact match boost, recency, source priority)
    addresses retrieval layer recall
  - Stage 18: ReciprocalRankFusion across pgvector + full-text ensures
    needle surfaces even if one provider misses it

Mitigation NOT yet designed — add when ContextBuilder depth work begins:
  ContextBuilder.build() must order output chunks so that highest-score
  chunk is at index 0 (start) and second-highest is at index N (end).
  Never emit chunks in flat score-descending order into the prompt.
  This is a Stage 18+ concern — do not implement before HeuristicReranker
  exists to produce meaningful scores.

<!-- Added: 2026-05-17 — from architecture review session -->

---

## Session — 2026-05-18 (Stage 17: Trajectory persistence + OTel — P2 Complete)

### Fix A outcome — PostgresSessionManager now activates via pool path

`PostgresStorageProvider.db` getter previously returned `this.params.database` only.
For connectionString-only construction, `this.params.database` is `undefined`, so the
duck-type check in `createRuntimeServiceContainer` fell back to `InMemorySessionManager`.

Fix: `pg` is now statically imported (`import pg from "pg"`). Constructor creates a
`pg.Pool` eagerly when `connectionString` is provided and no `database` is injected.
Pool construction is side-effect-free — no connections are opened at that point.
The `db` getter now returns `this.params.database ?? this.pool ?? undefined`.

The `database()` private method simplified: if pool is already set (by constructor),
it just returns `ok(this.pool)` directly — no dynamic import path needed.

After Fix A: `createRuntimeServiceContainer()` with a connectionString-only
`PostgresStorageProvider` selects `PostgresSessionManager`, not `InMemorySessionManager`.

### Fix B outcome — threadId in SingleAgentRunReport

`SingleAgentRunReport` gains `readonly threadId?: string`.
`SingleAgentExecutor.execute()` sets `threadId: activeThreadId` in the returned
report object. `activeThreadId` is the value captured from `sessionManager.openThread()`
result — same thread that session manager used.

`SafeTrajectoryEvent` in core/src/observability/types.ts also gains `readonly threadId?: string`.
Executors pass `threadId: activeThreadId` in the `record()` call so
`PostgresTrajectoryRecorder` has the FK value for the INSERT.

### Trajectory recorder design — field mapping to agentic_tool_calls

```txt
  SafeTrajectoryEvent field          agentic_tool_calls column
  ─────────────────────────────────  ──────────────────────────
  (randomUUID() generated)           call_id       TEXT PK
  event.threadId                     thread_id     TEXT NOT NULL FK
  event.toolName ?? event.stepType   tool_name     TEXT NOT NULL
  SHA-256({taskHash, toolName})[64]  input_hash    TEXT NOT NULL
  SHA-256({status, tokenEstimate})[64]  output_hash TEXT
  event.status                       status        TEXT
  now()                              started_at    TIMESTAMPTZ
  now()                              completed_at  TIMESTAMPTZ
  event.errorCode                    error_code    TEXT
  event.tokenEstimate                token_estimate INTEGER
```

When `event.threadId` is absent, the INSERT is skipped (non-fatal). Thread FK is
NOT NULL in the schema so inserting without it would cause a constraint violation.

`PostgresTrajectoryRecorder.recordStep()` fire-and-forgets `record()` via `.catch()`.
`PostgresTrajectoryRecorder.summary()` returns an empty `TrajectorySummary` (no in-memory
event list in the Postgres implementation — the dashboard can query `agentic_tool_calls`
directly for richer data).

### OTel dynamic require pattern — CJS/ESM compatibility

`OtelTraceSink.create()` uses `require("@opentelemetry/api")` inside a try/catch.
This is synchronous (needed because `startSpan()` is synchronous — can't await).
In Node.js ESM modules, `require` is not available by default. However:

- If `@opentelemetry/api` is not installed, the `require` throws → fallback to `StderrTraceSink`.
- If running in a context where `require` is available (e.g., via a CJS wrapper or
  explicit `createRequire`), OTel is loaded and used.
- If `require` itself is not defined (pure ESM with no CJS interop), the `require(...)` 
  call throws a ReferenceError → caught by the try/catch → fallback to `StderrTraceSink`.

In practice, Node.js ESM modules can access `require` when running under certain toolchains
(tsx, ts-node, etc.) that add CJS compatibility. The fallback is always safe.

For production OTel, the recommended pattern is: set `traces.sink = "remote"` in the
config and install `@opentelemetry/api`. The OTel SDK initializes before the runtime
starts (in the entrypoint), and `OtelTraceSink.create()` will pick it up via `require`.

### P2 complete checklist

```txt
  cli_vectorless_local             ✅ Stage 11 — profile-config-smoke passes
  no_filesystem_storage            ✅ Stage 11 + 16 — buildStorageProviders never emits filesystem
  all_profiles_pass_validator      ✅ Stage 11 + 16 — 168→181 tests all passing
  getChunks_real_sql               ✅ Stage 13 — SQL JOIN on agentic_chunks + agentic_sources
  fulltext_tsvector                ✅ Stage 13 — tsvector plainto_tsquery when storage.db non-null
  migrations_verified              ✅ Stage 14 — docker-compose + verify-postgres.ts
  postgres_session_manager         ✅ Stage 17 (Fix A) — connectionString-only now activates PostgresSM
  local_context_example            ✅ Stage 15 — examples/src/local-context working
  trajectory_postgres              ✅ Stage 17 — PostgresTrajectoryRecorder INSERTs to agentic_tool_calls
  otel_sink                        ✅ Stage 17 — NoopTraceSink + StderrTraceSink + OtelTraceSink
```

P3 begins at Stage 18: hybrid-rag profile, ReciprocalRankFusion, HeuristicReranker.
Needle-in-haystack mitigation (ContextBuilder.build() chunk ordering) is a Stage 18+
concern — do not implement before HeuristicReranker exists to produce meaningful scores.

<!-- Last updated: 2026-05-18 08:35 GMT+5:30 (03:05 UTC) -->

---

## Session — 2026-05-18 (Stage 18 — P3 begins: hybrid-rag + RRF + HeuristicReranker)

### Stage 18 shipped

- ReciprocalRankFusion (k=60): multi-provider result dedup and merge. Formula
  `score = Σ 1/(k + rank)`. Dedup by sourceId + preview[:100]. k=0 guard throws.
- HeuristicReranker: 4 additive components (exactMatch 0.3, recency 0.2,
  sourceTypePriority 0.3, headingDepth 0.2). Absent fields contribute 0.
  Does not mutate input. Stable sort preserves order for equal scores.
- hybrid-rag built-in profile: pgvector + full-text + pageIndex + symbol,
  router merger:"rrf" reranker:"heuristic" maxResults:12. Requires Postgres.
- CLI_PROFILE_NAMES updated: "hybrid-rag" added (position 9, before "hybrid-all").
- ContextBuilder needle-in-haystack ordering: highest score at index 0,
  second-highest at index N, middle filled descending. Implemented because
  HeuristicReranker now exists to produce meaningful scores.
- RetrievalRouterOptions: new backward-compatible second param on RetrievalRouter
  constructor — existing callers with one arg are unaffected.
- PageIndexProvider: explicit public constructor added (was protected-only).
  Required so runtime/index.ts can instantiate it via `new PageIndexProvider(...)`.
- MockRetrievalMerger + MockReranker added to test-utils.
- Test count: 181 → 204 (+23: 11 RRF + 11 heuristic + 1 hybrid-rag smoke).
- pnpm typecheck ✓ build ✓ test 204/204 ✓ lint ✓

### DECISIONS

- score field — ALREADY EXISTED in RetrievalResult (`readonly score: number`).
  No new field needed.
- updatedAt/sourceType/headingPath added as optional fields to RetrievalResult
  in core. Required for HeuristicReranker recency, source-priority, and
  heading-depth scoring components.
- merger/reranker config fields added to RetrievalRouterConfig in core as
  `"rrf"|"none"` and `"heuristic"|"none"` literals. They did not exist before.
- ContextBuilder needle-in-haystack ordering: IMPLEMENTED. HeuristicReranker
  now exists; ContextBuilderInput.retrievalResults carries scored chunks.
- RRF provider execution: SEQUENTIAL (existing behavior preserved; parallel
  Promise.all is a future optimization).

### DECISIONS

- DECISION: headingPath separator is " > " (space-greater-than-space).
  Confirmed from FullTextProvider and PgVectorProvider join at
  index.ts lines 352 and 1121: (row.heading_path ?? []).join(" > ").
  HeuristicReranker now uses " > " as the canonical separator (Stage 18-patch).

### known_gaps

- RetrievalRouter provider execution is sequential. For hybrid-rag
  (4 providers: full-text, pgvector, PageIndex, symbol) this is a 4×
  latency tax vs parallel execution. Convert to Promise.all in a P3
  follow-up task between Stage 21 and Stage 22. Deferred to preserve
  existing RetrievalRouter behaviour during Stage 18.

### Next

Stage 19 — LLM SmartRouter basic (LlmProvider interface, SmartRouter,
OllamaLlmProvider, SmartRouterConfig, profile wiring).

---

## Stage 17B — PDF extractor + OCR integration (2026-05-20)

### DECISIONS

- D9 — `parsePdf` injected via constructor (DI over module import). `PdfExtractor`
  accepts a `ParsePdfFn` parameter so tests supply a mock without module-patching.
  The real `pdf-parse` default export satisfies the type in production callers.

- D10 — `rasterizePage` is an optional callback, not a required dep. When absent,
  scanned pages (text < threshold) produce empty text and a `warnings[]` entry.
  CI stays clean without any image rasterization library installed.

- D11 — `warnings: readonly string[]` added to `PdfExtractionResult`. Non-breaking
  addition to the Stage 17A type — callers that destructure the result can ignore
  the field; callers that check exhaustively must add it to their match.

### known_gaps

- Page rasterization deferred to Stage 17D example. Neither `pdf2pic` nor
  `pdfjs-dist` canvas was added to deps — neither is safe to mandate in CI.
  Stage 17D's example can inject a real `rasterizePage` callback.

- Table detection deferred to Stage 17C (PDF-aware chunker + indexer routing).

- HeuristicReranker `"pdf"` sourceTypePriority weight (0.75) already present in
  DEFAULT_SOURCE_PRIORITY_MAP from Stage 22 — no change needed in Stage 17B.

<!-- Last updated: 2026-05-20 (Stage 17B complete — 311/311 tests) -->

---

## Session — 2026-05-19 (Stage 19 — LLM SmartRouter basic)

### Stage 19 shipped

- LlmProvider, LlmRequest, LlmResponse, LlmRoutingPolicy, CostCatalog, BudgetGate,
  LlmConfig interfaces in core/src/llm/types.ts
- MockLlmProvider, OllamaLlmProvider, AnthropicLlmProvider implementations
- SmartRouter: local-first routing, fallback chain, budget gate (fail-fast hard stop)
- DefaultCostCatalog: known Anthropic model prices as of 2025-Q2
- DefaultBudgetGate + NoopBudgetGate
- createRuntimeServiceContainer: auto-wires SmartRouter when config.llm set
- 3 new error codes: llm.provider-unavailable, llm.budget-exceeded, llm.fallback-exhausted
- Test count: 204 → 239 (+35: 30 runtime LLM + 5 core types)

### DECISIONS

DECISION: BudgetGate is a new interface (not PermissionGate extension).
  Reuses PermissionDecision. ApprovalService not introduced.
DECISION: Both HTTP providers use fetch — no vendor SDK. Rationale: no paid
  install in CI, no vendor lock-in, small stable surface.
DECISION: budget-exceeded is a hard stop — no fallback on budget block.
  Rationale: budget limits must be predictable; silently falling through
  would make cost control meaningless.
DECISION: AnthropicLlmProvider.fromEnv() skips gracefully in container if
  env var absent; other providers in the list still wired.
DECISION: countTokens() is heuristic (ceil(length/4)) for all providers in
  Stage 19. Exact counting deferred to Stage 24+.
DECISION: DefaultCostCatalog unknown models return 0 (safe open default —
  unknown model cost = 0 → budget gate allows the call; treat as "unknown,
  allow" not "free").

### known_gaps

- SmartRouter not yet called by any framework feature (Stage 21: query rewrite)
- Streaming not yet supported (Stage 26+)
- Token counting is heuristic for all providers (Stage 24+)
- CostCatalog prices are approximate, not live-fetched
- AnthropicLlmProvider not tested against live API in CI

### next_stage

Stage 20 — LocalEmbeddingProvider wiring
  (Ollama embedding endpoint, mxbai-embed-large, OpenAI-compatible format,
   createEmbeddingProvider factory, hybrid-rag + full-agentic-context profiles)

<!-- Last updated: 2026-05-19 03:41 GMT+5:30 (22:11 UTC) -->

---

## Session — 2026-05-19 (Stage 20 — Local embedding provider wiring)

### Stage 20 shipped

- `embedding-config.ts`: MOCK_EMBEDDING_DIMENSION 64→1024, MOCK_EMBEDDING_VERSION v1→v2,
  MOCK_EMBEDDING_HNSW_M 8→16, MOCK_EMBEDDING_HNSW_EF_CONSTRUCTION 32→64
- `storage/migrations.ts`: migration 005 added — DELETE + ALTER vector(1024) + HNSW rebuild
- `retrieval/index.ts`: LocalEmbeddingProvider.embedText() — transparent OpenAI-compat
  format detection (flat body[field] checked first, nested body.data[0][field] second);
  MockEmbeddingProvider.computeEmbedding() updated to 32-pass chained SHA-256 for 1024 dims
- `retrieval/embedding-factory.ts` (NEW): createEmbeddingProvider(config) factory — single
  construction point for all config-driven EmbeddingProvider instances
- `core/src/config/types.ts`: `readonly embedding?: EmbeddingProviderConfig` added to
  AgenticInfraProjectConfig and ResolvedProjectConfig
- `runtime/src/runtime/index.ts`: embeddingProvider resolved (options.embeddingProvider →
  config.embedding factory → MockEmbeddingProvider auto-fallback for pgvector profiles);
  PgVectorProvider wired with the resolved embeddingProvider; assertEmbeddingDimension now
  uses `container.value.embeddingProvider?.dimension ?? MOCK_EMBEDDING_DIMENSION`
- `e2e-smoke.test.ts`: literal 64 replaced with MOCK_EMBEDDING_DIMENSION constant
- NEW TEST FILES: embedding-factory.test.ts (7), local-embedding-provider.test.ts (6)
- DOCS: embedding-providers.md (new public), ollama-embeddings-setup.md (new runbook),
  embedding-provider-design.md (Stage 20 section appended), embedding-dimension-decision.md (new)
- Test count: 239 → 252 (+13)

### DECISIONS

DECISION D1: vector dimension — Option B implemented (migration 005, MOCK_EMBEDDING_DIMENSION=1024).
  Option A (truncation to 64) rejected: cosine similarity over 64 values from a model trained at
  1024 dims is geometrically meaningless. Option C (dual schema) not needed: mock at 1024 covers CI.

DECISION D2: OpenAI-compat response format — transparent auto-detection in embedText().
  Overrides 2026-05-14 kb.md decision that stated "OpenAI nested-response format requires
  custom EmbeddingProvider implementation by caller." Stage 20 makes detection automatic:
  body[field] checked first (Ollama flat), then body.data[0][field] (OpenAI-compat).
  Non-breaking: existing flat-format callers are unaffected. Eliminates friction for
  LocalAI/LM Studio users who use the OpenAI-compat API surface.

### known_gaps

- migration 005 in code; requires pnpm verify:postgres re-run against running Postgres
- SmartRouter not yet called by any framework feature (Stage 21)
- RetrievalRouter provider execution is still sequential (Stage 21)
- Exact token counting still heuristic for all providers (Stage 24+)
- AnthropicLlmProvider not tested against live API in CI

### next_stage

Stage 21 — Retrieval quality evals + RetrievalRouter Promise.all parallelism fix +
SmartRouter first usage (query rewrite before retrieval providers run)

<!-- Last updated: 2026-05-19 10:44 GMT+5:30 (05:14 UTC) -->

---

## Session — 2026-05-19 (Stage 21 — Retrieval quality evals + parallelism + query rewrite)

### Stage 21 shipped

- RetrievalRouter.retrieve() sequential for-loop → Promise.allSettled (all providers concurrent)
- SmartRouter query rewrite wired in agentic.retrieval.search tool handler (Layer 5)
- 6 retrieval quality eval functions: checkGroundedness, checkRetrievalRecall,
  checkPolicyRefusal, checkBudgetCompliance, checkRetrievalPrecision, checkSourcePriority
- runRetrievalQualityEvals() suite runner — QualityReport suiteName "retrieval-quality"
- agentic.evals.run MCP tool contract + handler — 7th framework tool
- evals/index.ts: export * from "./retrieval-evals.js" added
- 4 new test files: retrieval-router-parallel, retrieval-evals, tools-query-rewrite, tools-evals-handler
- Test count: 252 → 285 (+33)

### DECISIONS

DECISION D1: query rewrite in tool handler (Layer 5), not RetrievalRouter (Layer 8).
  Layer 11 (Model) must not be called from Layer 8 (Knowledge) — upward dependency violation.
  Tool handlers are orchestration; they compose services from multiple layers.

DECISION D2: mock guard for query rewrite — rewritten query rejected if:
  - starts with "[mock]" (MockLlmProvider test artifact)
  - length < 6 (empty or trivially short)
  - length > 300 (hallucination or unexpected output)
  On SmartRouter failure (result.ok === false): silently use original query.

DECISION D3: agentic.evals.run runs with empty input in Stage 21 → all 6 checks skipped.
  Real data wiring deferred to Stage 24 (AgentEvaluator).

DECISION D4: createFrameworkToolHandlers() called at runtime/index.ts line 453 inside
  `return ok({...})` — updated from `createFrameworkToolHandlers(retrievalRouter)` to
  `createFrameworkToolHandlers(retrievalRouter, smartRouter)`. smartRouter was already
  declared and resolved earlier in the same function (Stage 19 wiring).

DECISION D5: runAgentRuntimeEvals() sets suiteName: "agent-runtime-safety" (confirmed from
  evals/index.ts line 37). Test assertion (d) in tools-evals-handler.test.ts checks this.

DECISION D6: pass()/failed()/skipped() are unexported private functions in evals/index.ts.
  retrieval-evals.ts re-implements them inline with identical signatures.
  IDs use dots (e.g. "retrieval.groundedness") not dashes → replaceAll("-", " ") is a no-op.

### known_gaps

- agentic.evals.run returns "skipped" for all 6 checks without real retrieval data (Stage 24)
- agentic.context.build query rewrite deferred (Stage 22+)
- Exact token counting still heuristic for all providers (Stage 24+)
- AnthropicLlmProvider not tested against live API in CI
- migration 005 requires pnpm verify:postgres re-run against running Postgres

### next_stage

Stage 22 — Source priority + weighted retrieval:
  RetrievalResult.sourcePriority field, ContextBuilder source weighting,
  HeuristicReranker source priority component, configurable sourcePriorityMap

---

## Session — 2026-05-20 (Stage 22)

Stage 22 — Source priority + weighted retrieval. 285 → 294 tests (+9).

DECISION D7: sourcePriority stamped by RetrievalRouter Step 4 (not by providers).
  Providers cannot know the profile's priority map at retrieval time — the router has
  it. Stamping in Step 4 ensures every result carries a consistent resolved priority
  regardless of which provider produced it.

DECISION D8: ContextOptimizer pre-sorts by sourcePriority desc + score desc before
  budget loop (not post-filter). Post-sort would still admit low-priority chunks if
  they happen to arrive early in the input; pre-sort guarantees the budget loop always
  sees highest-priority chunks first and fills the window with them.

P2.5-hook: "pdf":0.75 included in DEFAULT_SOURCE_PRIORITY_MAP as a reserved slot.
  Stage 17B PDF indexing can activate it without modifying the constant. Do not
  remove the slot before P2.5 Stage 17A lands.

### known_gaps

- agentic.evals.run returns "skipped" for all 6 checks without real retrieval data (Stage 24)
- agentic.context.build query rewrite deferred (Stage 22+) — still deferred
- Exact token counting still heuristic for all providers (Stage 24+)
- AnthropicLlmProvider not tested against live API in CI
- migration 005 requires pnpm verify:postgres re-run against running Postgres
- HeuristicReranker table fallback still needed for legacy providers without sourcePriority
- sourcePriorityMap not yet exposed as a built-in profile option in CLI generator

### next_stage

Stage 22-complete → P2.5 Stage 17A (PDF scaffold)

<!-- Last updated: 2026-05-20 17:26 GMT+5:30 (11:56 UTC) -->

---

## Session — 2026-05-20 (P2.5 Stage 17A — PDF package scaffold)

### Stage 17A shipped

- `"pdf"` added to `KNOWLEDGE_SOURCE_TYPES` in `core/src/retrieval/types.ts` as last entry.
  `KnowledgeSourceType` union picks it up automatically — no other core changes needed.

- `@maharudra/agentic-ai-infra-pdf` package created (private, scaffold only):
  - `package.json`: ESM, Node>=20, workspace dep on core, `pdf-parse@^1.1.1`,
    `tesseract.js@^5.0.0` optional peer dep.
  - `tsconfig.json`: extends base, adds `"types": ["node"]` (required for `Buffer`).
  - `src/types.ts`: `ExtractedPage`, `MarkdownTable`, `PdfExtractionResult`,
    `OcrProvider` interface, `PDF_SOURCE_TYPE` constant typed as `KnowledgeSourceType`.
  - `src/index.ts`: public barrel re-export.

- No runtime tests added yet — `"test": "vitest run --passWithNoTests"` intentional.
  294/294 existing tests unchanged.

### DECISIONS

CONFIRMED: `pnpm-workspace.yaml` `"packages/*"` already covers the new package — no change needed.

DECISION: `pdf-parse` chosen over alternatives (pure JS, no native deps, no Python sidecar,
  no binary install). Alternatives (pdfjs-dist, poppler, mutool) all have heavier dependency
  trees or require external tooling.

DECISION: `tesseract.js` as optional peer dep — stage 17A scaffold only. Implementations in
  stage 17B will import it dynamically and return `""` + `console.warn` when absent.

DECISION: `PDF_SOURCE_TYPE = "pdf"` typed as `KnowledgeSourceType` directly (not `as const`).
  Safe because `"pdf"` was added to `KNOWLEDGE_SOURCE_TYPES` in the same stage, so the union
  already includes it. TypeScript verifies this at compile time.

DECISION: `"types": ["node"]` added to pdf package tsconfig. Required because `OcrProvider.
  recognize()` parameter is `Buffer` — root `@types/node` is not auto-included without
  explicit `types` field (same pattern as `examples/tsconfig.json`).

### known_gaps

- `PdfExtractor` implementation deferred to Stage 17B
- `OcrProvider` implementation deferred to Stage 17B
- No runtime test coverage yet (intentional — Stage 17B adds tests)
- `tesseract.js` graceful fallback not yet implemented

### next_stage

P2.5 Stage 17B — PDF text extraction + OCR integration

---

## Session — 2026-05-20 (P2.5 Stage 17C — PDF chunker + table detection + indexer routing)

### Stage 17C shipped

- `packages/agentic-ai-infra-pdf/src/table-detector.ts` — `detectTables()` with
  Heuristic A (pipe-grid GFM tables) and Heuristic B (tab-separated tables).
  Returns `TableDetectionResult { tables, remainingText }`.
- `packages/agentic-ai-infra-pdf/src/chunker.ts` — `pdfPageChunker()` that splits
  concatenated page-marker text into `KnowledgeChunk` records. Tables → single
  preserved chunks (`chunkingStrategy:"fallback"`, `isTable:true`). Prose →
  `chunkMarkdownByHeadings` with page prefix. Default `maxChunks: 500` (D-17C-4).
- `packages/agentic-ai-infra-pdf/src/register.ts` — `registerPdfExtension()` that
  calls `_enablePdfSupport()` from runtime (static import — D-17C-1).
- `packages/agentic-ai-infra-pdf/src/extractor.ts` — `parsePdf` constructor param
  made optional (dynamic import of pdf-parse when absent); `fileBuffer` param made
  optional (reads file from `filePath` when absent). Backward compatible.
- `packages/agentic-ai-infra-pdf/src/index.ts` — exports added for all new modules.
- `packages/agentic-ai-infra-pdf/package.json` — `@maharudra/agentic-ai-infra-runtime`
  added as workspace dependency (pdf → runtime, never the reverse).
- `packages/agentic-ai-infra-runtime/src/retrieval/indexer.ts` — `_pdfSupported` flag
  + `_enablePdfSupport()` function after `ALLOWED_EXTENSIONS` declaration. PDF branch
  added inside `indexProjectKnowledge` per-file loop before Step 3: dynamic import
  of pdf package, freshness check, extract pages, `pdfPageChunker`, embed, persist.
- `packages/agentic-ai-infra-pdf/test/chunker.test.ts` — 11 new tests.

### DECISIONS

| ID | Decision |
|---|---|
| D-17C-1 | `register.ts` uses a static import of `_enablePdfSupport` from runtime — `registerPdfExtension()` is synchronous. No dynamic import in the registration path. |
| D-17C-2 | `indexer.ts` uses string literal `"pdf"` for sourceType in the pdf branch — NOT imported from the pdf package — avoids forbidden static runtime→pdf dependency. |
| D-17C-3 | Table chunks use `chunkingStrategy: "fallback"` — no new `ChunkingStrategy` value added to core. Core modification constraint (except KNOWLEDGE_SOURCE_TYPES) holds. |
| D-17C-4 | `pdfPageChunker` defaults `maxChunks: 500`, not 100. The 500 limit is also passed explicitly from the indexer call site for defense-in-depth. |
| D-17C-5 | `classifySourceType` not modified — pdf branch in indexer overrides sourceType to `"pdf"` directly, bypassing path-based classification. |
| D-17C-6 | `PdfChunkerParams` defined locally in `chunker.ts` (structural copy of `ChunkerParams`) — `ChunkerParams` is not exported from runtime. |
| D-17C-7 | Dynamic import in indexer uses `// @ts-ignore` + local minimal interface — standard NodeNext pattern for optional peer deps. Runtime has NO static dep on pdf package. |
| D-17C-8 | `PdfExtractor` constructor made optional (`parsePdf?: ParsePdfFn`); `extractPages` second param made optional (`fileBuffer?: Buffer`). Backward compatible with Stage 17B tests. |

### known_gaps

- End-to-end: PDF → extract → chunk → index → retrieve not yet tested with a real PDF (Stage 17D).
- Page rasterization for scanned PDFs deferred to Stage 17D example.

### next_stage

P2.5 Stage 17D — End-to-end PDF indexing example

<!-- Last updated: 2026-05-20 23:35 GMT+5:30 (18:05 UTC) -->

---

## Stage 17D — 2026-05-20 — PDF RAG example + smoke test + docs (P2.5 complete)

**Layer:** Cross-cutting. **Size:** Small.

### What shipped

- `examples/src/pdf-rag/index.ts` — end-to-end PDF ingestion example using
  pdf-lib (in-memory buffer), PdfExtractor, pdfPageChunker, MockEmbeddingProvider,
  InMemoryStorageProvider, and RetrievalRouter. No disk writes.
- `packages/agentic-ai-infra-pdf/test/smoke.test.ts` — 7 tests covering
  extract → chunk → store → retrieve using mock parsePdf.
- `docs/08-examples/pdf-rag.md` — step-by-step walkthrough.
- `docs/00-start-here/product-overview.md` — pdf-rag added to Quick Start table
  and section.
- `examples/package.json` — pdf-lib (devDep), pdf-parse, @types/pdf-parse,
  @maharudra/agentic-ai-infra-pdf (workspace dep) added. start:pdf-rag script added.

### P2.5 complete checklist

- [x] pdf-parse extracts text per page from .pdf files
- [x] Scanned pages detected (text < 50 chars heuristic)
- [x] tesseract.js OCR runs when installed, graceful fallback when absent
- [x] Tables preserved as single chunks (not split mid-table)
- [x] Page numbers in headingPath (page-1, page-2, etc.)
- [x] MAX_CHUNKS_PER_FILE = 500 for .pdf source type
- [x] Runtime skips .pdf files gracefully when pdf package not installed
- [x] End-to-end: PDF → extract → chunk → index → retrieve works     ← THIS STAGE

### Decisions

- pdf-lib drawText joins text items with spaces via pdf-parse getTextContent().
  Table rows drawn at discrete y positions may not preserve newlines in extracted
  text → table detection may produce 0 table chunks for in-memory generated PDFs.
  The smoke test (mock parsePdf) correctly validates table detection because mock
  returns text as a single item preserving newlines.
- `pdf-lib` is a devDependency in examples (not a runtime dep). tsx runs the
  example source directly without building first.
- `pdf-parse` and `@types/pdf-parse` are regular dependencies (not devDeps) because
  the example imports them at runtime.

### Next

Stage 23 — ContextOptimizer dedup + compression passes (Layer 8, 9).
Prereq: Stage 22 ✅ (ContextOptimizer pre-sort already implemented).

---

## Stage 23 � Context dedup + compression (2026-05-21)

**What shipped:**
- `RetrievalResult.embedding?: readonly number[]` added to core (non-breaking)
- `ContextOptimizerPolicy.dedupThreshold?: number` (default 0.95)
- `ContextOptimizerPolicy.compressionEnabled?: boolean` (default false)
- `ContextConfig` type added to `AgenticInfraProjectConfig`
- `ContextOptimizer.optimize()` � four-pass pipeline:
  (1) pre-sort by sourcePriority DESC, score DESC (D8 preserved)
  (2) cosine dedup via result.embedding or lazy EmbeddingProvider embed
  (3) Jaccard fallback when no embeddings available
  (4) sentence-level compression (opt-in)
  (5) budget loop (unchanged)
- `ContextBuilder.build()` -> async (consequence of async optimize())
- `PgVectorProvider.retrieve()` � attaches `chunk.vector` as `result.embedding`
- `createFrameworkToolHandlers()` � gains optional `embeddingProvider` param
- `createRuntimeServiceContainer()` � threads `embeddingProvider` to handlers
- `agents/index.ts` � await added to ContextBuilder.build() call

**Decisions locked:**
- D8 invariant PRESERVED: pre-sort is inside optimize() at step 1 before dedup/compression
- D2 invariant PRESERVED: heuristic token counting unchanged (Stage 24 item)
- Compression is opt-in (default false) � preserves exact retrieved content
- Jaccard threshold = max(0.7, cosineThreshold - 0.1) � coarser fallback

**Call sites updated for async build():**
- runtime/tools/index.ts
- runtime/agents/index.ts
- runtime/test/retrieval-context-cache.test.ts
- test-utils/src/e2e-smoke.test.ts
- runtime/test/retrieval/source-priority.test.ts (x3 optimize() calls)

**Tests:** 329 -> 341 (+12)
`pnpm typecheck ? build ? test 341/341 ? lint ?`

---

## Stage 24 — Eval architecture (2026-05-23)

### Decisions D11–D17 (locked)

- **D11** `EvalsConfig` on `AgenticInfraProjectConfig` and `ResolvedProjectConfig`,
  not on profiles. Profiles are for runtime mode / storage / network; eval config
  is project-level.
- **D12** `EvalHarness` lives in `runtime/src/harness/eval-harness.ts` — same
  directory as `AgentHarness`. `EvalStore` interface in core; `InMemoryEvalStore`
  in runtime.
- **D13** Both MCP eval tools return `AggregateQualityReport` — single normalized
  shape forever. No union, no v2.
- **D14** Suites needing dynamic input accept a lazy options provider
  (`() => Options`) in their constructor. `EvalSuiteContract.run()` stays as
  `() => Promise<FrameworkResult<QualityReport>>` — no arguments.
- **D15** `LlmJudgeEvaluator` is registered only when
  `config.evals.llmJudge.enabled === true` AND `smartRouter` is wired.
- **D16** `RuntimeServiceContainer.evalStore` and `.evalHarness` are NON-OPTIONAL
  fields. Always wired in-memory.
- **D17** Executor constructors use an options object (not positional). Only
  `TokenEfficientMultiAgentExecutor` pushes to `EvalStore`; `SingleAgentExecutor`
  accepts the option for forward compat but does not push — the eval input shape
  requires `RuntimeMultiAgentRunReport`.

### Key files (new in Stage 24)

- `core/src/evals/types.ts` — EvalStore, EvalRunRecord, AggregateQualityReport, EvalSuiteContract, EvalDataset types
- `core/src/evals/validator.ts` — validateEvalDataset()
- `core/src/config/types.ts` — EvalsConfig, EvalStoreConfig, LlmJudgeConfig (project-level)
- `runtime/src/evals/eval-store.ts` — InMemoryEvalStore ring buffer
- `runtime/src/evals/retrieval-quality-suite.ts` — RetrievalQualitySuite adapter
- `runtime/src/evals/agent-evaluator.ts` — AgentEvaluator (store history + re-eval)
- `runtime/src/evals/dataset-loader.ts` — DatasetLoader (path-safe, traversal guard)
- `runtime/src/evals/dataset-evaluator.ts` — DatasetEvaluator (substring/exact/semantic)
- `runtime/src/evals/llm-judge-evaluator.ts` — LlmJudgeEvaluator seam (disabled by default)
- `runtime/src/harness/eval-harness.ts` — EvalHarness + aggregateReports()
- `examples/eval-data/retrieval-quality.json` — 3-item retrieval quality dataset
- `examples/eval-data/agent-runtime.json` — 3-item agent runtime dataset
- `examples/eval-data/README.md` — dataset schema + addition policy
- `docs/04-core-framework/evaluation-architecture.md` — public eval architecture doc
- `docs/internal/learning-notes/stage-24-eval-architecture.md` — D11–D17 rationale

### Test count

341 → 429 (+88). `pnpm typecheck ✓ build ✓ test 429/429 ✓ lint ✓`

<!-- Last updated: 2026-06-25 13:41 GMT+5:30 (08:11 UTC) -->

---

## Session: Stage 25 — AgentDefinition + AgentDefinitionRegistry (2026-06-01)

**Scope:** P4 Layer 10 foundation — per-agent declarative configuration with planning-time enforcement.

**Phases:**

- 25-01 core-types (+8 tests)
- 25-02 registry-impl (+12 tests)
- 25-03 container-wiring (+5 tests)
- 25-04 executor-enforcement (+10 tests)
- 25-05 single-agent-evals (+8 tests)
- 25-06 validator-and-docs (+3 tests)

**Total:** ~475/475 tests passing, CI green.

**Locked decisions:**

- **D18** Legacy `AgentRegistry` and `AgentRouter` interfaces deprecated, kept for backwards compat; superseded by `AgentDefinitionRegistry`.
- **D19** `AgentDefinition = AgentProfile & PolicyFields` via TypeScript intersection.
- **D20** `allowedTools` is a TIGHTENING filter on top of `roleAllowsTool()`; planning-time only in Stage 25.
- **D21** `AgentDefinitionRegistry` interface is read-only; mutation on concrete `InMemoryAgentDefinitionRegistry` class.
- **D22** `agentRegistry: AgentDefinitionRegistry` is non-optional on `RuntimeServiceContainer` (D16 precedent).
- **D23** Default definitions carry NO policy fields — backwards-compatibility is non-negotiable.
- **D24** `runSingleAgentEvals()` is separate from `runAgentRuntimeEvals()`; single-agent push only when `evalRules` is set.

**Deferred to Stage 26+:** `AgentOrchestrator`, `SupervisorPolicy`, `HandoffPolicy`, `ResultMerger`, execution-time enforcement, `modelPolicy`/`retrievalPolicy` enforcement, rich config schema for definitions, MCP tools exposing the registry.

**Files added:**
- `core/src/agents/types.ts` (extended)
- `core/src/errors/index.ts` (3 new codes)
- `runtime/src/agents/registry.ts` (new)
- `runtime/src/evals/single-agent-evals.ts` (new)
- `docs/04-core-framework/agent-definition-and-registry.md` (new)
- `docs/internal/learning-notes/stage-25-agent-definition.md` (new)

**Verification command:**
```powershell
pnpm.cmd run ci
```
Returns `build ✓ typecheck ✓ test ✓ lint ✓` with ~475/475 passing.

---

## Stage 25.5 Phase 01 — Input Guard wiring (Guardrails umbrella)

**Date:** 2026-06-02
**Status:** Done
**Tests:** 480/480 → 490/490 (+10)

### What shipped

- `runtime/src/guardrails/input-guard.ts` — `InputGuard` interface,
  `NoopInputGuard`, `DefaultInputGuard`, `createInputGuard` factory.
- `RuntimeServiceContainer.inputGuard` — non-optional slot, D22 pattern.
- `createFrameworkToolHandlers(..., inputGuard?)` — additive parameter,
  defaults to `NoopInputGuard` for D23 compat.
- `agentic.retrieval.search` and `agentic.context.build` handlers now
  inspect retrieved content after `RetrievalRouter.retrieve()`.

### Decisions locked

- **D25** — Project umbrella vocabulary: "Guardrails" and "Feedback Loops"
  used in folder names, TSDoc tags, and public docs. `AgentDefinition`
  stays FLAT (D23-safe).
- **D26** — Input Guard wires existing `SecurityConfig.promptInjectionDefense`;
  no new core type fields. Non-fatal: warns via observability sink.

### What is intentionally not done

- No new SecurityConfig fields.
- No blocking behavior (warn-only). Stage 27 may add blocking under policy.
- No LLM-judge inspection (Stage 21 D1 forbids Layer 8 → Layer 11 calls).
  Heuristic patterns only.
- No coverage for novel jailbreaks — Stage 43 (adversarial robustness) extends.

### Files touched

- `packages/agentic-ai-infra-runtime/src/guardrails/input-guard.ts` (NEW)
- `packages/agentic-ai-infra-runtime/src/guardrails/index.ts` (NEW)
- `packages/agentic-ai-infra-runtime/src/tools/index.ts`
- `packages/agentic-ai-infra-runtime/src/runtime/index.ts`
- `packages/agentic-ai-infra-runtime/src/index.ts`
- `packages/agentic-ai-infra-runtime/test/guardrails/input-guard.test.ts` (NEW)
- `docs/internal/learning-notes/stage-25-5-input-guard.md` (NEW)
- `docs/internal/v3-architecture-snapshot.md`
- `kb.md`
- `STATUS.md`

---

## Stage 25.5 Phase 02 — ResponsePacket + citation propagation (Guardrails umbrella)

**Date:** 2026-06-02
**Status:** Done
**Tests:** 490/490 → 500/500 (+10)

### What shipped

- `AgentOutputCitation` new core type in `core/src/agents/types.ts` — `sourceId` required, `label?` and `providerId?` optional.
- `DeterministicAgentOutput` gains 4 optional guardrail fields: `citations`, `evidenceCoverage`, `confidence`, `abstainReason`.
- `createRoleOutput()` in `runtime/src/agents/index.ts` populates `citations` from `slice.includedSourceIds`.
- `TokenEfficientMultiAgentExecutor.roleOutputs` inherits `citations` automatically via spread `{ ...baseOutput, ... }`.
- New test file `runtime/test/agents/response-packet.test.ts` — 10 tests.

### Decisions locked

- **D27** — `DeterministicAgentOutput` gains 4 optional fields: `citations`, `evidenceCoverage`, `confidence`, `abstainReason`. All optional (D23-safe).
- **D28** — Citation propagation lives in executors (not core types). Core declares shape; executors populate.
- **D29** — Single-agent `ResponsePacket` extension deferred to Phase 03 (depends on `responsePolicy`). Phase 02 is multi-agent-only.

### What is intentionally not done

- No `evidenceCoverage` computation (Phase 03 populates via OutputGuard).
- No `confidence` population (Stage 42 Constitutional AI judge writes it).
- No `label`/`providerId` enrichment on citations (Phase 03 enriches from ContextPackage.sources lookup).
- No single-agent citation wiring (D29 — Phase 03 with responsePolicy).
- `AgentOutputCitation` NOT exported from `runtime/src/index.ts` — only core types are public contract.

### Files touched

- `packages/agentic-ai-infra-core/src/agents/types.ts` (modified — `AgentOutputCitation` type + 4 fields on `DeterministicAgentOutput`)
- `packages/agentic-ai-infra-runtime/src/agents/index.ts` (modified — `createRoleOutput` populates citations)
- `packages/agentic-ai-infra-runtime/test/agents/response-packet.test.ts` (NEW — 10 tests)
- `docs/internal/v3-architecture-snapshot.md` (modified)
- `kb.md` (this entry)
- `STATUS.md` (modified)

---

## Engineering Hygiene — Per-phase changelog discipline (D45)

**Date:** 2026-06-02
**Status:** Done
**Tests:** unchanged (no test changes in this prompt)

### What shipped

- New folder `changelog/` with README documenting the Keep-a-Changelog format
- Backfilled 6 entries for Stage 25 phases 01–06 from kb.md narrative
- AGENTS.md gained a new section "Per-Phase Changelog Discipline" locking D45
- CHANGELOG.md and STATUS.md note the new system

### Decisions locked

- **D45** — Every stage/phase Claude Code prompt MUST create one structured
  changelog entry under `changelog/`. Format: Keep-a-Changelog with mandatory
  sections (Added/Changed/Deprecated/Removed/Renamed/Fixed/Documentation/Notes).
  Filename: `stage-{N}[-{sub}]-phase-{NN}-{YYYY-MM-DD-HHMM}.md`. Immutable
  once committed. Internal-only helpers may be omitted; every exported symbol
  must be listed.

### What is intentionally not done

- No CI lint enforcing the rule (reviewer discipline only today)
- No backfill of Stages 1–24 (narrative kb.md remains the source)
- No automatic CHANGELOG.md aggregation script (manual curation today;
  scripting deferred to a future engineering-hygiene prompt)
- No machine-readable changelog (markdown-only today; YAML/JSON form deferred)

### Files touched

- `changelog/README.md` (NEW)
- `changelog/stage-25-phase-01-2026-05-28-1200.md` (NEW)
- `changelog/stage-25-phase-02-2026-05-28-1200.md` (NEW)
- `changelog/stage-25-phase-03-2026-05-28-1200.md` (NEW)
- `changelog/stage-25-phase-04-2026-05-28-1200.md` (NEW)
- `changelog/stage-25-phase-05-2026-06-01-1200.md` (NEW)
- `changelog/stage-25-phase-06-2026-06-01-1200.md` (NEW)
- `changelog/engineering-hygiene-changelog-discipline-2026-06-02-1200.md` (NEW)
- `AGENTS.md`
- `CHANGELOG.md`
- `STATUS.md`
- `kb.md` (this entry)

---

## Session — 2026-06-03 (Stage 25.5 Phase 03 — Output Guard)

### D30 — AgentResponsePolicy closed taxonomy
Four modes: `freeform`, `grounded`, `strict-cited`, `json-schema` (Stage 26 reserved).
Three onWeakEvidence values: `abstain`, `ask`, `warn`.
Two guard timings: `per-orchestrator` (default), `per-agent`. `per-tool` excluded — Stage 21 D1
forbids Layer 9 from calling Layer 11 for LLM-judge guards.

### D31 — AgentBudgetPolicy expanded (3 new optional fields)
`maxToolCalls`: default 8 when budgetPolicy present, Infinity when absent.
`maxRuntimeMs`: default 120000 ms when budgetPolicy present, undefined when absent.
`maxIterations`: no default — Stage 48 SelfCritiqueLoop consumes it.
D23 honored: absent budgetPolicy means no enforcement.

### D32 — Guard timing levels (per-orchestrator / per-agent)
`per-orchestrator` (default): Stage 26's AgentOrchestrator calls evaluateResponsePolicy once.
`per-agent` (opt-in): TokenEfficientMultiAgentExecutor runs after each role output.
Single-agent: SingleAgentRunReport.response populated at SingleAgentExecutor return.

### D33 — Three new error codes in core/src/errors/index.ts
`agent.weak-evidence`, `agent.tool-call-exceeded`, `agent.timeout`.
Phase 04 adds retry-related codes separately.

### D34 — AbortController race-then-mark-as-orphan (locked pattern)
Mirrors `runtime/src/llm/anthropic-llm-provider.ts:118`. Signal not threaded into handlers
this phase. Wall-clock check at sync boundary before final return. Stage 26/27 extend.

### Implementation notes
- `evaluateResponsePolicy()` is the pure unit of correctness. `HeuristicOutputGuard` wraps it.
- Per-role maxToolCalls violations in multi-agent are WARNINGS (not failures) — Stage 26 adds isolation.
- `maxToolCalls` for single-agent fails the run (hard stop); for multi-agent roles it's soft (warning).
- Tests: 500 → 512 (+12). `pnpm typecheck ✓ build ✓ test 512/512 ✓ lint ✓`.

---

## Session — 2026-06-03 (Stage 25.5 Phase 04 — Retry Loop + Refusal Taxonomy)

### D35 — RefusalReason closed taxonomy (8 codes)
`PermissionDecision.refusalReason?: RefusalReason` — optional typed code (D23 preserved).
8 values: `role-floor`, `remote-safe`, `shell-blocked`, `network-blocked`,
`arbitrary-sql-blocked`, `mode-not-allowed`, `approval-required`, `agent-allowlist`.
Phase 04 wires 6 `DefaultPermissionGate` branches. `approval-required` and `agent-allowlist`
wired in Stage 26.

### D36 — AgentRetryPolicy allowlist model
`retryableErrorCodes` is an ALLOWLIST — default "retry nothing". `maxAttempts?: number`,
`backoffMs?: number`, `retryableErrorCodes?: readonly string[]`. All optional. When policy
absent, one attempt (D23 compat).

### D37 — RetryLoop is feedback-loop primitive, not harness state
`runWithRetry()` is a pure async closure. Harness remains stateless. Executors compose it.
`runtime/src/feedback-loops/retry-loop.ts` — new module.

### D38 — Two new error codes
`agent.retry-exhausted` (all attempts failed), `agent.retry-blocked` (code not retryable).

### D39 — NEVER_RETRY hard-coded (non-negotiable safety floor)
7 codes: `runtime.permission-denied`, `runtime.approval-required`,
`agent.tool-not-in-allowlist`, `token.budget-exceeded`, `agent.tool-call-exceeded`,
`llm.budget-exceeded`, `agent.weak-evidence`. User policy cannot override.

### Implementation notes
- `satisfies RefusalReason` type assertion used at each deny branch for narrowing without cast.
- `feedback-loops/index.ts` barrel created; exported from `runtime/src/index.ts` next to `guardrails`.
- Tests: 512 → 523 (+11 = 4 refusal + 7 retry). `pnpm typecheck ✓ build ✓ test 523/523 ✓ lint ✓`.

---

## Session — 2026-06-03 (Stage 25.5 Phase 05 — ContentGuard, FeedbackHook seams, episodic memory)

### D40 — ContentGuard interface (content-safety contract)
`ContentGuard` lives in `core/src/guardrails/types.ts`. `ContentGuardInput = { direction, text, metadata? }`.
`SafetyVerdict = { safe, action: "pass"|"block"|"rewrite"|"warn", reason?, rewrittenText? }`.
Deliberately separate from `HeuristicOutputGuard` (response-policy, closed-taxonomy, deterministic).
ContentGuard may call LLMs (Stage 42 Constitutional AI guard). Conflating them would violate Stage 21 D1.

### D41 — FeedbackHook interface with FeedbackAction closed taxonomy
`FeedbackHook` in `core/src/feedback/types.ts`. `FeedbackAction ∈ {"accept"|"retry"|"escalate"|"revise"}`.
`FeedbackVerdict = { action: FeedbackAction, reason? }`. `FeedbackHookInput = { runId, traceId, outputText, metadata? }`.
Serves both in-run critique (Stage 48) and cross-run RLHF (Stage 49).

### D42 — NoopContentGuard, NoopCritiqueLoop, NoopEvalFeedbackLoop always-pass defaults
Three no-op classes in runtime. All return `{ safe: true, action: "pass" }` or `{ action: "accept" }`.
Two separate no-op feedback classes ready for Stage 49's potential container-slot split.

### D43 — RuntimeServiceContainerOptions single-object signature
`createRuntimeServiceContainer` changed from `(config, options?)` to `(options: RuntimeServiceContainerOptions)`.
`RuntimeServiceContainerOptions = RuntimeStartOptions & { config, contentGuard?, feedbackHook? }`.
Internal wrappers (`startLocalRuntime`, etc.) keep `(config, options)` signatures; call new form via `{ config, ...options }`.
All callers updated: runtime.test.ts, 3 examples, 3 templates in create package.

### D44 — AgentMemoryPolicy.episodic gap-fill
`AgentMemoryPolicy.episodic?: "read" | "read-write" | "none"` added to core agents/types.ts.
Same shape as `.semantic`. Enforcement deferred to Stage 27 MemoryStore design.
Added now to keep Stage 27's surface clean — adding it later would require coordination.

### Implementation notes
- Dual-module instanceof issue: Vitest resolves barrel `@maharudra/agentic-ai-infra-runtime` → `dist/`;
  tests importing source-level `createRuntimeServiceContainer` hold source-level class instances.
  Fix: always import concrete classes from `../../src/...` not from barrel. Matches `test/guardrails/input-guard.test.ts`.
- New test subdirectory `test/runtime/` created for container-seams tests.
- Tests: 523 → 529 (+6 container-seam tests). `pnpm typecheck ✓ build ✓ test 529/529 ✓ lint ✓`.

---

## STAGE 25.5 CLOSEOUT — 2026-06-03

Stage 25.5 is complete across 5 phases. All 20 decisions D25–D44 locked.

| D# | Decision |
|---|---|
| D25 | `HeuristicOutputGuard` contract — citation count, evidence coverage |
| D26 | `NoopOutputGuard` auto-wired default; `OutputGuard` non-optional in container |
| D27 | `OutputGuard.enforce()` returns `OutputPolicy` verdict (pass/revise/block) |
| D28 | `AgentRegistry` closed-shape contract — `register()`, `resolve()`, `list()` |
| D29 | `DefaultAgentRegistry` Map-backed; `AgentHandle` carries capabilities |
| D30 | `AgentCapability` closed taxonomy — 8 strings; open extension deferred |
| D31 | `PermissionGate` contract — `decide()` returns `PermissionDecision` |
| D32 | `DefaultPermissionGate` wired in container; `PermissionGate` non-optional |
| D33 | `PermissionDecision.deniedReason?: string` freeform field |
| D34 | `AuthContext` shape — `{ userId, roles, agentId?, sessionId? }` |
| D35 | `RefusalReason` closed taxonomy — 8 codes; `deniedReason` typed to it |
| D36 | `AgentRetryPolicy` allowlist model — retry nothing by default |
| D37 | `RetryLoop` is feedback-loop primitive, not harness state |
| D38 | Two new error codes: `agent.retry-exhausted`, `agent.retry-blocked` |
| D39 | `NEVER_RETRY` hard-coded set — 7 non-negotiable safety codes |
| D40 | `ContentGuard` content-safety interface — separate from response-policy guard |
| D41 | `FeedbackHook` interface — `FeedbackAction ∈ {"accept"|"retry"|"escalate"|"revise"}` |
| D42 | `NoopContentGuard`, `NoopCritiqueLoop`, `NoopEvalFeedbackLoop` always-pass defaults |
| D43 | `RuntimeServiceContainerOptions` single-object signature |
| D44 | `AgentMemoryPolicy.episodic` gap-fill — same shape as `.semantic` |

**Final CI**: `pnpm typecheck ✓ build ✓ test 529/529 ✓ lint ✓`
**Frontier**: Stage 26 — Agent Harness Phase 01

---

## Session — 2026-06-23 (Stage 26 Phase 01 — SupervisorPolicy)

**Status:** Implementation complete; final verification and commit blocked by workspace dependency recovery.

### D-B1 honored — core contract, runtime implementation

`SupervisorPolicy` is defined in `core/src/orchestrator/types.ts`, while
`DefaultSupervisorPolicy` lives in `runtime/src/orchestrator/supervisor-policy.ts`.
This preserves dependency inversion: callers depend on the small core interface
and can replace the runtime default without importing runtime details.

### Routing behavior

The default policy is synchronous and pure. It first resolves the reserved
`manager` id, then falls back to the first `manager` role. If neither exists,
it returns fatal `agent.no-manager-registered`; it does not throw, select a
different role, or mutate the registry. The input accepts `SafeTaskMetadata`,
not raw task text.

### Test-fixture constraint

`createAgentDefinitionRegistry()` always installs its six defaults, including
the canonical `manager`. It therefore cannot construct a genuine role-fallback
or no-manager case. Those two tests use the real
`InMemoryAgentDefinitionRegistry` implementation, not a stub; the canonical
and determinism tests use the factory.

### Verification state

The 529-test baseline passed before implementation. The required CI command
compiled core and runtime successfully but stopped at the PDF package because
its local `@types/node` link was missing. Two lockfile-frozen pnpm repair
attempts stalled while recreating `node_modules`; their external child processes
could not be terminated from this environment. Restore workspace dependencies,
run `pnpm.cmd run ci` (expected 533 tests), then commit the phase.

### Debugger follow-up — 2026-06-23

Read-only process diagnostics identified four near-idle Node processes created
at the times of the failed pnpm attempts: 15512, 22648, 36460, and 15332.
The root `node_modules` directory has no `.modules.yaml`; the PDF package lacks
its `@types/node` link; and the effective local pnpm store lacks locked metadata
needed for offline restoration. An online frozen install is therefore required.

The process owner is outside this agent's Windows security context. Direct
`taskkill` returns `Access denied`, and an elevated process-query attempt did
not complete in this environment. Do not manually link packages or delete the
virtual store. An administrator must release the four stale processes, then run
`pnpm.cmd install --frozen-lockfile` followed by `pnpm.cmd run ci`.

### Verification resolved — 2026-06-23

The user completed `pnpm.cmd install --frozen-lockfile` and supplied a full
successful `pnpm.cmd run ci` transcript: build, strict typecheck, test, and
lint all passed. The workspace total is 533 tests: core 63, runtime 363,
dashboard 11, PDF 35, test-utils 7, and create package 54. The four new
supervisor-policy tests passed within runtime.

This project intentionally has no Git repository yet. Commit creation is out
of scope by user direction and is not a release-gate failure for this phase.

---

## Session — 2026-06-23 (Stage 26 Phase 02 — Orchestrator report contracts)

**Status:** Implementation complete; final combined CI verification blocked by
the PDF package's missing workspace `@types/node` link.

### D-A1 — aggregate reports are sibling contracts

`OrchestratorReport` is a runtime sibling of `RuntimeMultiAgentRunReport`, not
an extension or intersection. A composed run may build context per sub-run and
may later use routing services, so it cannot claim the executor-only literal
invariants `contextBuildCount: 1` and `noNetworkCalls: true`.

### Executor-report and retry visibility

`OrchestratorSubRun.executorReport` is discriminated by `kind: "single" |
"multi"`. This preserves each executor's native report shape for dashboards
and evals. Retry visibility is the single `attemptCount` number: one means no
retry and two or more means the invocation retried. No additional retry-result
contract was introduced.

### Verification state

The focused type-contract test passed 4/4, runtime strict typecheck passed,
and the complete workspace test suite passed 537/537. `pnpm.cmd run ci` built
core, dashboard, and runtime successfully but stopped at the PDF package before
the typecheck/test/lint stages because its local `@types/node` link is missing.
The frozen-lockfile repair made no progress for five minutes and was stopped to
avoid adding another stalled recovery process. Git remains unavailable because
the repository has no Git metadata.

---

## Session — 2026-06-23 (Stage 26 Phase 03 — AgentOrchestrator single-agent composition)

### B-i — Agent registry remains an explicit construction dependency

`AgentOrchestratorOptions.agentRegistry` supplies the `SupervisorPolicy.route()`
registry input. The orchestrator does not reach into the executor: the executor
intentionally exposes no registry accessor, and an explicit dependency keeps
routing testable and avoids a hidden composition-layer coupling.

### Runtime composition behavior

`AgentOrchestrator.run()` classifies raw task text, routes from the safe
metadata, invokes the injected single-agent execution port, then awaits both
`ContentGuard.inspect()` and `FeedbackHook.evaluate()` before returning an
`OrchestratorReport`. Route, executor, invalid-route, and unexpected seam
failures stay inside `FrameworkResult`; no model, router, network, filesystem,
retry, response-policy, or eval-store work was added.

The concrete `SingleAgentExecutor` has private state, so the constructor takes
`Pick<SingleAgentExecutor, "execute">` rather than the full class. This keeps
the public dependency to exactly the required execution capability and permits
minimal structural failing stubs in tests.

### ID and trace boundary

Executor report ids are currently built by its private deterministic `runIds()`
helper, which cannot accept a caller trace id. The orchestrator therefore owns
fresh outer ids with the existing runtime `node:crypto` `randomUUID` primitive:
the caller's optional trace id is preserved in the outer report and feedback
input, while the nested executor report retains its own identity. No executor
contract expansion was made in this phase.

### Deferred composition behavior

The default supervisor returns `"single"`. For a valid custom `"sequential"`
or `"parallel"` route, the orchestrator runs only `agents[0]`, retains the full
planned role list, and adds the explicit deferred-composition warning. This is
total and observable rather than failing a valid plan or misrepresenting the
unrun plan entries. Multi-agent composition and retry remain later work.

### Verification

Ten tests raised the workspace total from 537 to 547. Runtime build and strict
typecheck passed; workspace tests passed 547/547 and lint passed. The aggregate
CI command still stops in the unrelated PDF package build because its local
`@types/node/index.d.ts` workspace link is absent. The repository has no Git
metadata, so the requested commit cannot be created.

---

## Session — 2026-06-24 (D46 — per-stage verification summaries)

### Decision D46 — one living summary per stage prompt folder

Each completed phase now updates
`prompts/stage-{N}[-{sub}]/verification-summary.md` before it claims
completion. This file is intentionally a living, detailed stage handoff: it
holds the phase ledger, actual verification evidence, blockers, compatibility
decisions, and the next phase's context. It complements rather than replaces
the immutable per-phase changelog entry.

### Why this is separate from the changelog

The changelog records code-shape changes at one completed phase and must not be
rewritten after shipment. A stage needs a different reader experience: one
place that answers what is done, what remains, and which verified boundaries a
future phase must preserve. Editing the stage summary after every phase keeps
that handoff current without corrupting historical changelog evidence.

### Initial Stage 26 record

`prompts/stage-26/verification-summary.md` backfills the completed Phase 01
through 03 work from the existing immutable records and marks Phase 04 through
06 as not started. The record preserves the PDF workspace Node type-link issue
as a cross-phase verification blocker and calls out the Phase 03 temporary
single-agent fallback that Phase 05 must replace.

### Enforcement and scope

The rule binds both Codex and Claude Code. New phase prompts must list the
stage summary in their files to change, while keeping the per-phase changelog
as the final phase artifact. No automated enforcement was added; the phase
completion review enforces D46 alongside D45 today.

---

## Session — 2026-06-24 (D47 — LIFO stage-summary handoff)

### Decision D47 — one detailed handoff, ordered newest first

The active stage verification summary is the only operational handoff. Its
completed phase records form a LIFO stack: the most recently verified phase is
first and carries the immediate next-step context, while older verified phases
remain below it as evidence. Future phases remain a short plan until they
start.

### Why `handover.md` was removed

A root-level handover duplicated `STATUS.md`, `kb.md`, and the stage summary,
then became stale as soon as another phase ran. The records now have distinct
ownership: `STATUS.md` is the compact frontier, `kb.md` contains durable
reasoning, the stage summary holds detailed verified phase state, and
`changelog/` remains immutable code-shape history. No root handover is needed.

### Operational effect

Quota warnings and agent switches now direct the next agent to read the shared
rules, `STATUS.md`, `kb.md`, and the active LIFO verification summary. The
Claude `/handover` command and all live instructions that created
`handover.md` were removed. This change does not alter any framework runtime
contract or Stage 26 implementation behavior.

---

## Session — 2026-06-25 (D50 sub-agent normalization-of-deviance closure)

This session ran a director-routed multi-agent chain: director → planner → design-architect → implementor (×2) → clean-coder → security-reviewer → documentation → validator. The chain delivered the full D50 closure: five previously missing signal detectors (signals 1, 4, 6, 7, 8) landed in `subagent-deviance-check.mjs`; a toggle CLI (`subagent-deviance.mjs`) was added for the new `deviance_mode` field in `subagent-routing.json`; the upfront-permissions contract (D50) and mid-chain re-routing rule (D51) were codified as binding clauses in `AGENTS.md` and mirrored in `CLAUDE.md`; the security-reviewer found three path-handling defects (unresolved CWD, missing `mkdirSync` guard, destructive overwrite in routing-toggle script) which the second implementor pass fixed; the clean-coder collapsed duplicated `readJson` helpers across the script family from three to one; the documentation agent completed the public CLI doc, internal learning-note extensions, verification summary, changelog, and project-state updates.

The durable rationale for D50 and D51 is prevention of normalization of deviance — Diane Vaughan's term for the gradual acceptance of small rule violations as routine, eventually producing catastrophic failure. D48 and D49 specified *who* owns a turn and *how* the director gets triggered; D50 adds the guardrail (machine-readable schema + nine-signal detection + upfront-permissions contract) so small violations are visible immediately rather than accumulating silently; D51 closes the remaining gap by specifying that a user message arriving mid-chain must route through the director before any specialist acts on it, preventing ambiguous parallel state where a chain and a new user intent collide without a resolution protocol. Together the four decisions form a complete, formally specified sub-agent orchestration contract.

---

## Session — 2026-07-10 (Stage 26 Phase 04 — refusal wiring and agent identity)

### D-F1 honored — `agentId` plus registry lookup

`PermissionGateInput.agentId?` and `AgentHarnessToolInput.agentId?` now carry
stable agent identity into the runtime permission gate. `DefaultPermissionGate`
accepts an optional `AgentDefinitionRegistry`; local and remote runtime adapters
pass the container registry into default harnesses. The gate only reads agent
policy when both `agentId` and registry are present and the id resolves.

### Refusal wiring

The two reserved refusal reasons from D35 are now active:

- `approval-required`: returned before mode/tool checks when the resolved agent
  has `approvalPolicy.requiresApproval === true` and the tool is mutating by the
  exact `DefaultApprovalPolicy.requiresApproval(tool)` predicate.
- `agent-allowlist`: returned after remote-safe checks and before final allow
  when the resolved agent has `allowedTools` and the requested tool id is not in
  that list.

`allowedTools: []` means no tools; `allowedTools: undefined` means no per-agent
restriction. Both new branches are inert when `agentId` or registry is absent,
preserving D23.

### Retry taxonomy boundary

`NEVER_RETRY` remains byte-unchanged. The new values are `RefusalReason` values,
not `ErrorCode`s, and no new error code was added.

### Verification

`pnpm.cmd run ci` passed: build, strict typecheck, 555 workspace tests, and lint.
The earlier PDF workspace `@types/node/index.d.ts` link blocker is resolved in
the current workspace.

---

## Session — 2026-07-10 (Engineering hygiene — agent hooks reference parity)

The user asked to inspect the agents/hooks implementation fix from
`C:\Users\develop\studio_projects\Rudraloka-android` and apply the same behavior
here. The reference was treated as untrusted input and only the portable hook
semantics were ported: in-flight work preservation in the routing prompt,
manual Codex deviance audits instead of Codex Stop-hook detection, read-only
dry-run audits, and safe import of schema-lint parser helpers.

### What changed

- `scripts/subagent-routing-hook.mjs` now injects the reference preservation
  clause for normal routing and explicit sub-agent override paths.
- `.claude/agents/director.md` and `.codex/agents/director.toml` now carry the
  reference "Preserve in-flight work" rule while keeping this repo's pnpm
  validation wording.
- `.codex/config.toml` no longer registers `scripts/subagent-deviance-check.mjs`
  under `hooks.Stop`; Codex audits are manual via
  `node scripts/subagent-deviance-check.mjs --dry-run`.
- `scripts/subagent-deviance-check.mjs --dry-run` no longer appends HIGH
  findings to `.agentic-local/deviance-alerts.jsonl`.
- `scripts/safe-agent-schema-lint.mjs` now guards `main()` so importing
  `parseClaudeSchema` from `subagent-deviance-check.mjs` does not execute the
  linter CLI and exit the process.

### Boundary decisions

The Android reference clears all Stop-hook deviance wiring. This repo kept the
Claude Code Stop hooks for quota, session summary, and Claude-side deviance
audits because `AGENTS.md` still binds the Claude quota/session behavior.
Only the Codex Stop detector was removed, matching the reference problem:
Codex Stop fires at ordinary turn boundaries and can make a continuing chain
look interrupted.

### Verification

`pnpm.cmd run ci` passed: build, strict typecheck, 555 workspace tests, and
lint. Additional focused checks passed:
`node scripts/safe-agent-schema-lint.mjs --json`,
`node scripts/subagent-deviance.mjs status`,
`node scripts/subagent-routing.mjs status`,
`node scripts/subagent-deviance-check.mjs --dry-run`, and direct
UserPromptSubmit hook smoke tests for director and validator override paths.

---

## Session — 2026-07-10 (Stage 26 Phase 05 — composition, retry, response guard)

### Composition behavior

`AgentOrchestrator` now executes all supervisor-selected agents for
`sequential` and `parallel` plans. Both strategies deliberately call
`singleAgentExecutor.execute()` once per planned agent, with each call wrapped in
`runWithRetry(agent.retryPolicy)`. This keeps retry policy and attempt visibility
per registered agent and leaves the `RuntimeMultiAgentRunReport` branch in
`OrchestratorSubRun` reserved for future use.

The injected `TokenEfficientMultiAgentExecutor` is now required and reachable on
the orchestrator instance, but it is not invoked in this phase. That dependency
exists so Phase 06 can wire the real container slot without changing the
composition semantics that Phase 05 tests lock.

### Retry and guard boundaries

`attemptCount` is derived from the retry callback argument; no `RetryOutcome`
type was invented. `NEVER_RETRY` remains owned by `runWithRetry()` and was not
modified. Parallel composition uses `Promise.allSettled`; partial failure
returns `ok` with warnings when any branch succeeds, while total failure returns
`fail`.

The per-orchestrator response guard runs once on the merged output only when the
first planned agent has a response policy whose `guardTiming` is not
`"per-agent"`. The merged guard input is a real `DeterministicAgentOutput`
shape with manager role, synthesis summary, aggregate token usage, source count,
and context-derived citations when available.

### Verification

Focused runtime verification passed: runtime typecheck and 395/395 runtime
tests. Full `pnpm.cmd run ci` also passed: build, strict typecheck, 565/565
workspace tests, and lint.

---

## Session — 2026-07-10 (Stage 26 CLOSEOUT — container wiring)

### Final architecture state

Stage 26 is complete. `RuntimeServiceContainer` now has a non-optional
`orchestrator` slot, and `createRuntimeServiceContainer()` auto-builds
`AgentOrchestrator` from `DefaultSupervisorPolicy`, the container registry, the
single-agent executor, the token-efficient multi-agent executor, the content
guard, and the feedback hook.

The factory remains synchronous and side-effect-free. It constructs both
executors locally because the container already owns the resolved config,
observability sink, trajectory recorder, shared token recorder, eval store,
agent registry, session manager, and session id. The orchestrator receives those
dependencies by injection; it does not construct infrastructure or start
runtime surfaces.

### Corrections locked

- `SupervisorPolicy.route()` returns `FrameworkResult<SupervisorRoutePlan>`.
- `FrameworkError` is used as a typed result object, not as a constructed class.
- No `RetryOutcome` type was added; attempt counts come from the retry callback.
- `NEVER_RETRY` remains owned by `runWithRetry()` and was not modified.
- The container factory stayed sync and returned `FrameworkResult`, not a
  `Promise`.
- Parallel orchestration uses `Promise.allSettled` so partial success is
  observable without erasing successful branches.

### Verification and handoff

Focused runtime verification passed after the Phase 06 code change: runtime
typecheck and 399/399 runtime tests. Full `pnpm.cmd run ci` also passed: build,
strict typecheck, 569/569 workspace tests, and lint.

Stage 27 should consume the completed container slot rather than create a second
composition entry point. Main pickups: rich `AgentDefinition` config, dashboard
and eval views for `OrchestratorReport`, bounded remote-safe orchestration APIs,
and a decision on when the token-efficient multi-agent executor becomes an
active orchestration strategy.
## Session — 2026-07-11 (Stage 26 Phase 07 — identity and safety correction)

**Status:** Implemented with focused evidence; awaiting security review and the
full validator gate. Phase 08 is approved but not started.

The Stage 26 audit showed that green tests had locked several incorrect
assumptions: a valid exact approval could not pass the earlier permission gate,
specialist routes executed with manager policy and were relabeled afterward,
guard actions were recorded without controlling returned synthesis, and
available sources were treated as citations. Phase 07 makes identity canonical
at the registry boundary, passes `agentId` and trace through execution, verifies
report attribution, restores permission→approval ordering, enforces guard and
response actions, preserves typed refusal reasons, and sanitizes injected seam
throws. Focused core tests passed 64/64 and runtime tests passed 412/412.

The correction does not solve token-efficient composition. Sequential and
parallel paths still repeat the supplied full context for each single-agent
call. Phase 08 must build or accept context once, derive deterministic bounded
role slices, keep sequential handoffs compact, and expose truthful correlated
usage/eval evidence before Stage 26 can close.

---
