import {
  DefaultConfigValidator,
  type AgenticInfraProjectConfig,
  type FrameworkResult,
  type KnowledgeIndexStorageCapability,
  type ResolvedProjectConfig,
  type RetrievalProvider,
  type RuntimeMode,
  type SessionManager,
  type StorageProvider,
  type SupervisorPolicy,
  type ToolContract,
  type ToolExecutionHandler,
  ok
} from "@maharudra/agentic-ai-infra-core";
import { MOCK_EMBEDDING_DIMENSION } from "../retrieval/embedding-config.js";
import { InMemoryStorageProvider, RUN_AGENTIC_AI_INFRA_MIGRATIONS } from "../storage/index.js";
import { createSessionManager } from "../session/index.js";
import {
  DocumentTreeProvider,
  FullTextProvider,
  HeuristicReranker,
  MockEmbeddingProvider,
  PageIndexProvider,
  PgVectorProvider,
  ReciprocalRankFusion,
  RetrievalRouter,
  SymbolCodeProvider,
  createEmbeddingProvider
} from "../retrieval/index.js";
import {
  AnthropicLlmProvider,
  DEFAULT_COST_CATALOG,
  DefaultBudgetGate,
  MockLlmProvider,
  NoopBudgetGate,
  OllamaLlmProvider,
  SmartRouter
} from "../llm/index.js";
import type { EmbeddingProvider, LlmProvider } from "@maharudra/agentic-ai-infra-core";
import { AgentHarness } from "../harness/index.js";
import { EvalHarness } from "../harness/eval-harness.js";
import {
  InMemoryEvalStore,
  RetrievalQualitySuite,
  AgentEvaluator,
  LlmJudgeEvaluator
} from "../evals/index.js";
import {
  createAgentDefinitionRegistry,
  SingleAgentExecutor,
  TokenEfficientMultiAgentExecutor,
  type ExecutorOptions
} from "../agents/index.js";
import { AgentOrchestrator, DefaultSupervisorPolicy } from "../orchestrator/index.js";
import type { EvalStore, AgentDefinitionRegistry } from "@maharudra/agentic-ai-infra-core";
import { fatal, recoverable } from "../errors/index.js";
import { type InputGuard, createInputGuard, NoopContentGuard } from "../guardrails/index.js";
import { NoopCritiqueLoop } from "../feedback-loops/critique-loop.js";
import type { ContentGuard, FeedbackHook } from "@maharudra/agentic-ai-infra-core";
import {
  assertRemoteToolsSafe,
  createFrameworkToolContracts,
  createFrameworkToolHandlers,
  createRuntimeToolRegistry,
  filterToolsForMode
} from "../tools/index.js";
import {
  StderrObservabilitySink,
  createTraceSink,
  type ObservabilitySink,
  type RuntimeObservabilitySink
} from "../observability/index.js";
import {
  createTrajectoryRecorder,
  type TrajectoryRecorder
} from "../trajectory/index.js";
import { TokenUsageRecorder } from "../token/index.js";
import { createMcpServerForTools } from "./mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Handle returned by an explicit runtime start call.
 *
 * For `local-stdio-mcp` mode the `server` field is populated with the
 * configured `McpServer` instance. Generated entrypoints use it to attach a
 * `StdioServerTransport` after startup validation passes.
 *
 * Remote and API handles leave `server` undefined because those surfaces bind
 * their own transport layers through HTTP/HTTPS adapters.
 */
export type RuntimeHandle = {
  readonly mode: RuntimeMode;
  readonly host?: string;
  readonly port?: number;
  readonly registeredTools: readonly ToolContract[];
  /**
   * The configured MCP server instance. Present for `local-stdio-mcp` mode;
   * absent for remote surfaces where transport binding is handled externally.
   */
  readonly server?: McpServer;
  /** Stops the runtime surface. */
  stop(): Promise<FrameworkResult<void>>;
};

/**
 * Composed runtime services shared by local and remote adapters.
 *
 * `retrievalRouter` is optional: when absent the live retrieval and context
 * build tool handlers return a "not-configured" status rather than an error,
 * allowing the runtime to start without a database connection.
 *
 * `storageProvider` is auto-wired by `createRuntimeServiceContainer` when the
 * resolved profile config declares `storage.providers[0].type = "memory"`.
 * Explicitly passed providers in `RuntimeStartOptions` take precedence.
 */
export type RuntimeServiceContainer = {
  readonly config: ResolvedProjectConfig;
  readonly tools: readonly ToolContract[];
  readonly handlers: ReadonlyMap<string, ToolExecutionHandler>;
  readonly observability: RuntimeObservabilitySink;
  /**
   * Trajectory recorder — `InMemoryTrajectoryRecorder` when no database is
   * available, `PostgresTrajectoryRecorder` when `storageProvider.db` is set.
   * Implements both `recordStep()` (sync harness path) and `record()` (async
   * persistence path used by executors).
   */
  readonly trajectoryRecorder: TrajectoryRecorder;
  readonly tokenRecorder: TokenUsageRecorder;
  /**
   * In-memory eval record store. Capacity from `config.evals.store.capacity`
   * (default 100). Always wired — Stage 27 will swap in a Postgres-backed
   * implementation behind the same `EvalStore` interface.
   */
  readonly evalStore: EvalStore;
  /**
   * Eval harness with `RetrievalQualitySuite` and `AgentEvaluator` pre-registered.
   * `LlmJudgeEvaluator` is registered only when
   * `config.evals.llmJudge.enabled === true` AND `smartRouter` is set.
   * `DatasetEvaluator` is NOT auto-registered (caller-driven; keeps startup
   * I/O-free).
   */
  readonly evalHarness: EvalHarness;
  /**
   * Agent definition registry — read-only lookup of `AgentDefinition` by id
   * or role. Stage 25.
   *
   * Auto-wired by `createRuntimeServiceContainer()` from
   * `config.agents.agents` via `createAgentDefinitionRegistry()`. Always
   * contains the six default definitions; caller-supplied profiles override
   * defaults on id collision (caller wins).
   *
   * Used by executors at planning time to apply per-agent `allowedTools` and
   * `budgetPolicy` (Stage 25 Phase 04). Stage 26 will use it for
   * orchestrator routing and execution-time enforcement.
   */
  readonly agentRegistry: AgentDefinitionRegistry;
  /**
   * Agent orchestrator used as the canonical Layer 10 composition entry point.
   *
   * The factory auto-wires this slot from the resolved config, agent registry,
   * executors, content guard, feedback hook, and supervisor policy. Callers may
   * replace it through `RuntimeServiceContainerOptions.orchestrator` for tests
   * or advanced host composition. Construction is side-effect-free; execution
   * starts only when `orchestrator.run()` is called.
   *
   * @example
   * const result = createRuntimeServiceContainer({ config });
   * if (result.ok) {
   *   await result.value.orchestrator.run({ task: "Review this change." });
   * }
   *
   * @umbrella Guardrails
   */
  readonly orchestrator: AgentOrchestrator;
  /**
   * Input Guard — Layer 8/9 boundary check on retrieved content.
   *
   * Wires `SecurityConfig.promptInjectionDefense`. Defaults to `NoopInputGuard`
   * when the security config is absent or `enabled: false`. Non-fatal: emits
   * observability warnings; does not block context build (Stage 25.5 D26).
   */
  readonly inputGuard: InputGuard;
  /**
   * Content-safety guard. Default: `NoopContentGuard` (D42).
   * Stage 42 injects `LlmJudgeContentGuard` via options override.
   *
   * @umbrella Guardrails
   */
  readonly contentGuard: ContentGuard;
  /**
   * Post-output feedback hook. Default: `NoopCritiqueLoop` (D42).
   * Stage 48 injects `LlmCritiqueLoop`; Stage 49 may extend to a separate
   * cross-run hook slot.
   *
   * @umbrella Feedback Loops
   */
  readonly feedbackHook: FeedbackHook;
  /** Optional router used by agentic.retrieval.search and agentic.context.build. */
  readonly retrievalRouter?: RetrievalRouter;
  /**
   * Storage provider auto-wired from profile config or passed in options.
   * Used by `startLocalRuntime` for embedding dimension validation.
   */
  readonly storageProvider?: StorageProvider;
  /**
   * Session and thread lifecycle manager.
   *
   * Auto-wired by `createRuntimeServiceContainer`: `PostgresSessionManager`
   * when the storage provider exposes a `QueryableDatabase` via its `db`
   * getter; `InMemorySessionManager` otherwise (includes vectorless-local).
   */
  readonly sessionManager: SessionManager;
  /**
   * Tracing sink for OTel-compatible span instrumentation.
   *
   * `NoopTraceSink` when traces are disabled, `StderrTraceSink` for local
   * development, `OtelTraceSink` when `@opentelemetry/api` is installed and
   * `traces.sink = "remote"` in the observability config.
   */
  readonly traceSink: ObservabilitySink;
  /**
   * SmartRouter for LLM calls. Undefined when no `llm` config is set or when
   * the `llm.providers` list is empty. Framework features that need LLM access
   * (Stage 21+) check for this field before attempting a call.
   */
  readonly smartRouter?: SmartRouter;
  /**
   * Resolved `EmbeddingProvider` for this container.
   *
   * Present when the profile declares a `pgvector` retrieval provider.
   * `LocalEmbeddingProvider` when `config.embedding` is set to `"local-http"`;
   * `MockEmbeddingProvider` when no `config.embedding` is set and the profile
   * needs embeddings (auto-fallback). Wired into `PgVectorProvider` to enable
   * SQL semantic vector queries.
   *
   * Undefined when the profile has no `pgvector` provider and no embedding
   * config was supplied — non-vector profiles do not need an embedding provider.
   */
  readonly embeddingProvider?: EmbeddingProvider;
};

/**
 * Optional runtime startup dependencies.
 *
 * Pass a `retrievalRouter` to enable live behavior for `agentic.retrieval.search`
 * and `agentic.context.build`. When absent those tools return a "not-configured"
 * status so the runtime is always startable regardless of storage readiness.
 *
 * Pass a `storageProvider` to enable startup embedding-dimension validation.
 * When the provider implements `assertEmbeddingDimension` (duck-type detected),
 * `startLocalRuntime` will call it before tool registration. A mismatch causes
 * a fatal startup error; callers should apply migration 003 first.
 */
export type RuntimeStartOptions = {
  readonly observability?: RuntimeObservabilitySink;
  readonly tools?: readonly ToolContract[];
  readonly handlers?: ReadonlyMap<string, ToolExecutionHandler>;
  readonly trajectoryRecorder?: TrajectoryRecorder;
  readonly tokenRecorder?: TokenUsageRecorder;
  /** Optional RetrievalRouter wired into live retrieval and context build handlers. */
  readonly retrievalRouter?: RetrievalRouter;
  /**
   * Optional storage provider for startup dimension validation.
   *
   * When present and the provider satisfies the `assertEmbeddingDimension`
   * duck-type, `startLocalRuntime` validates the schema's vector column
   * dimension against `MOCK_EMBEDDING_DIMENSION` before any tools are
   * registered. A mismatch returns a fatal error; apply migration 003 first.
   */
  readonly storageProvider?: StorageProvider;
  /**
   * Optional session id to resume an existing session.
   *
   * When provided, `execute()` calls `resumeOrCreateSession` with this id
   * so repeated agent runs reuse the same session row in the dashboard.
   * When absent, a new UUID is generated on each run.
   */
  readonly sessionId?: string;
  /**
   * Caller-supplied `EmbeddingProvider`. Overrides `config.embedding`.
   *
   * Required when using `EmbeddingProviderConfig` type `"custom"`. The factory
   * cannot construct a custom provider from config fields alone — the caller
   * must pass the pre-constructed instance here.
   */
  readonly embeddingProvider?: EmbeddingProvider;
  /**
   * Caller-supplied `AgentDefinitionRegistry`. Overrides the auto-built
   * default registry. Useful when callers need to register definitions with
   * policy fields (allowedTools, budgetPolicy, evalRules) that the config
   * schema doesn't yet support (config-driven rich definitions land in
   * Stage 26).
   */
  readonly agentRegistry?: AgentDefinitionRegistry;
};

/**
 * Options for `createRuntimeServiceContainer`.
 *
 * Combines a required `config` with all optional override fields from the
 * previous `RuntimeStartOptions` shape, plus Phase 05 guard/hook overrides.
 * The `config` field makes the call site self-documenting and allows guard
 * overrides to sit alongside config in a single destructured argument.
 *
 * Stage 42 injects `contentGuard`; Stage 48/49 inject `feedbackHook`.
 */
export type RuntimeServiceContainerOptions = RuntimeStartOptions & {
  /** Project config (user-authored or already-resolved). */
  readonly config: AgenticInfraProjectConfig | ResolvedProjectConfig;
  /** Override for the default `NoopContentGuard` (Stage 25.5 P05). */
  readonly contentGuard?: ContentGuard;
  /** Override for the default `NoopCritiqueLoop` (Stage 25.5 P05). */
  readonly feedbackHook?: FeedbackHook;
  /**
   * Override for the auto-wired `AgentOrchestrator`.
   *
   * Supplying this value lets tests or advanced hosts own the full composition
   * boundary while the factory still wires the rest of the container normally.
   * The override is returned unchanged and is not invoked during construction.
   */
  readonly orchestrator?: AgentOrchestrator;
  /**
   * Override for the supervisor routing policy used by the auto-wired orchestrator.
   *
   * Ignored when `orchestrator` is supplied because a caller-owned orchestrator
   * already includes its routing policy. Policy construction and selection stay
   * synchronous and side-effect-free.
   */
  readonly supervisorPolicy?: SupervisorPolicy;
};

/**
 * Converts either a user-authored config or an already-resolved config into the
 * canonical resolved shape that runtime adapters require.
 *
 * The runtime package accepts both shapes because generated entrypoints usually
 * pass user config, while tests and advanced integrations may pass resolved
 * config directly after custom validation.
 */
function resolveConfig(
  config: AgenticInfraProjectConfig | ResolvedProjectConfig
): FrameworkResult<ResolvedProjectConfig> {
  // Resolved configs already contain mandatory merged categories, so avoid
  // re-resolving them and accidentally changing caller-owned specialization.
  if ("security" in config && "tokenEfficiency" in config && "observability" in config) {
    return ok(config as ResolvedProjectConfig);
  }

  return new DefaultConfigValidator().validate(config);
}

/**
 * Builds the dependency-inverted service container shared by all runtime
 * adapters.
 *
 * This function performs validation and composition only. It intentionally does
 * not start transports, bind ports, connect to databases, or run migrations so
 * imports and tests remain side-effect free.
 *
 * @example
 * const container = createRuntimeServiceContainer({
 *   config,
 *   observability: silentObservabilitySink
 * });
 */
export function createRuntimeServiceContainer(
  options: RuntimeServiceContainerOptions
): FrameworkResult<RuntimeServiceContainer> {
  const {
    config,
    contentGuard: contentGuardOverride,
    feedbackHook: feedbackHookOverride,
    orchestrator: orchestratorOverride,
    supervisorPolicy: supervisorPolicyOverride,
    ...startOptions
  } = options;
  const resolved = resolveConfig(config);

  if (!resolved.ok) {
    return resolved;
  }

  // Auto-wire a storage provider from the profile config when none is passed in
  // options. The vectorless-local profile declares type:"memory", which creates
  // an InMemoryStorageProvider without any external dependencies. All other
  // profiles either have no providers (minimal) or require a caller-supplied
  // Postgres provider.
  const storageConfig = resolved.value.storage;
  const storageProvider: StorageProvider | undefined =
    startOptions.storageProvider ??
    (storageConfig?.providers?.[0]?.type === "memory"
      ? new InMemoryStorageProvider(storageConfig.providers[0]?.id ?? "in-memory-store")
      : undefined);

  // ── Embedding provider resolution ────────────────────────────────────────
  // Precedence (highest to lowest):
  //   1. startOptions.embeddingProvider — explicit caller instance (type: "custom")
  //   2. config.embedding — config-driven, constructed via factory
  //   3. Auto-fallback MockEmbeddingProvider — when profile declares pgvector
  //      but no explicit provider was supplied (covers CI with no Ollama)
  //
  // The fallback is intentional: hybrid-rag and local-context profiles exercise
  // the full PgVectorProvider SQL code path in CI using deterministic mock vectors.
  let embeddingProvider: EmbeddingProvider | undefined = startOptions.embeddingProvider;

  if (!embeddingProvider && resolved.value.embedding) {
    // Config-driven construction — factory throws synchronously on bad config.
    embeddingProvider = createEmbeddingProvider(resolved.value.embedding);
  }

  // Auto-fallback: profiles that declare pgvector need an EmbeddingProvider.
  // Without one, PgVectorProvider returns "not-configured" for SQL vector queries.
  if (!embeddingProvider) {
    const needsEmbeddings = (resolved.value.retrieval?.providers ?? []).some(
      (p) => p.type === "pgvector" && p.enabled !== false
    );
    if (needsEmbeddings) {
      embeddingProvider = new MockEmbeddingProvider();
    }
  }

  // Auto-create a RetrievalRouter with storage-backed providers when all three
  // conditions are met:
  //   1. The resolved profile config has retrieval enabled.
  //   2. A storage provider is available (explicitly passed or auto-wired above).
  //   3. The storage provider has getChunks() (duck-typed) — meaning it is an
  //      InMemoryStorageProvider or custom provider with the in-memory path.
  //   4. No explicit router was passed in options (explicit always wins).
  //
  // This is the activation wire that makes vectorless-local retrieval functional
  // without callers having to manually construct providers or a router.
  let retrievalRouter = startOptions.retrievalRouter;

  if (
    !retrievalRouter &&
    storageProvider !== undefined &&
    resolved.value.retrieval?.enabled === true &&
    typeof (storageProvider as unknown as Record<string, unknown>).getChunks === "function"
  ) {
    const indexStorage = storageProvider as StorageProvider & KnowledgeIndexStorageCapability;
    const autoProviders = (resolved.value.retrieval.providers ?? [])
      .filter((p) => p.enabled !== false)
      .flatMap((p): RetrievalProvider[] => {
        // Construct each profile-configured provider with the storage reference.
        // FullTextProvider and PgVectorProvider gain SQL paths when storageProvider
        // exposes a non-null .db getter (PostgresStorageProvider with injected DB).
        // DocumentTreeProvider, SymbolCodeProvider, PageIndexProvider use the
        // getChunks() bulk path. PgVectorProvider has no EmbeddingProvider here —
        // it returns not-configured for SQL vector queries until one is wired.
        switch (p.type) {
          case "full-text":     return [new FullTextProvider(p.id, undefined, indexStorage)];
          case "document-tree": return [new DocumentTreeProvider(p.id, undefined, indexStorage)];
          case "symbol-code":   return [new SymbolCodeProvider(p.id, undefined, indexStorage)];
          case "page-index":    return [new PageIndexProvider(p.id, undefined, indexStorage)];
          case "pgvector":
            // embeddingProvider resolved above — real provider for local dev,
            // MockEmbeddingProvider auto-fallback for CI without Ollama.
            return [new PgVectorProvider(p.id, undefined, embeddingProvider, indexStorage)];
          default:              return [];
        }
      });

    if (autoProviders.length > 0) {
      // Wire merger and reranker from the resolved router config.
      // hybrid-rag profile declares merger:"rrf" and reranker:"heuristic".
      // All other profiles leave these fields absent (undefined → no-op).
      const routerConfig = resolved.value.retrieval.router;
      const merger = routerConfig?.merger === "rrf" ? new ReciprocalRankFusion() : undefined;
      const reranker = routerConfig?.reranker === "heuristic" ? new HeuristicReranker() : undefined;

      retrievalRouter = new RetrievalRouter(autoProviders, {
        merger,
        reranker,
        maxResults: routerConfig?.maxResults,
        // sourcePriorityMap from profile router config (Stage 22); falls back to
        // DEFAULT_SOURCE_PRIORITY_MAP inside RetrievalRouter constructor.
        sourcePriorityMap: routerConfig?.sourcePriorityMap
      });
    }
  }

  // Route all tools through PolicyEnforcingToolRegistry so registration-time
  // policy (critical risk, shell access) is enforced at container construction
  // rather than silently bypassed. The registry uses local-stdio-mcp mode so the
  // container remains surface-agnostic; per-adapter filtering (filterToolsForMode,
  // assertRemoteToolsSafe) then narrows the list for remote surfaces.
  const rawTools = startOptions.tools ?? createFrameworkToolContracts();

  let registeredTools: readonly ToolContract[];

  try {
    const registry = createRuntimeToolRegistry(rawTools, {
      modes: ["local-stdio-mcp"],
      localStdioMcp: resolved.value.runtime.localStdioMcp
    });
    registeredTools = registry.list();
  } catch (error) {
    return fatal(
      "runtime.unsafe-tool",
      error instanceof Error ? error.message : "Tool registration policy violation at container construction."
    );
  }

  // Duck-type check: if the storage provider exposes a non-null `db` getter
  // (i.e. PostgresStorageProvider with an injected QueryableDatabase), use
  // PostgresSessionManager; otherwise fall back to InMemorySessionManager.
  // This keeps the selection purely structural — no instanceof checks.
  const rawDb = (storageProvider as unknown as Record<string, unknown>)?.db;
  const sessionDb = (typeof rawDb === "object" && rawDb !== null)
    ? (rawDb as import("../storage/index.js").QueryableDatabase)
    : null;
  const sessionManager = createSessionManager(sessionDb);

  // Select trajectory recorder based on storage availability. PostgresTrajectoryRecorder
  // persists events to agentic_tool_calls; InMemoryTrajectoryRecorder is the fallback.
  const trajectoryRecorder: TrajectoryRecorder =
    startOptions.trajectoryRecorder ?? createTrajectoryRecorder(sessionDb);
  const tokenRecorder = startOptions.tokenRecorder ?? new TokenUsageRecorder();

  // Select tracing sink from the resolved observability config.
  const traceSink = createTraceSink(resolved.value.observability);

  // Wire SmartRouter when llm config is present and has at least one provider.
  // Providers are constructed per their type:
  //   "mock"      → MockLlmProvider (no network, deterministic)
  //   "ollama"    → OllamaLlmProvider (local fetch, isLocal=true)
  //   "anthropic" → AnthropicLlmProvider.fromEnv (reads API key from env)
  // AnthropicLlmProvider is skipped gracefully when its env var is absent so
  // other providers in the list remain functional.
  let smartRouter: SmartRouter | undefined;

  const llmConfig = resolved.value.llm;

  if (llmConfig && llmConfig.providers.length > 0) {
    const builtProviders: LlmProvider[] = llmConfig.providers.flatMap((providerConfig): LlmProvider[] => {
      switch (providerConfig.type) {
        case "mock":
          return [new MockLlmProvider(providerConfig.id)];
        case "ollama":
          return [new OllamaLlmProvider(
            providerConfig.id,
            providerConfig.model,
            providerConfig.baseUrl
          )];
        case "anthropic": {
          const apiKeyEnvVar = providerConfig.apiKeyEnvVar ?? "ANTHROPIC_API_KEY";
          const providerResult = AnthropicLlmProvider.fromEnv(
            providerConfig.id,
            providerConfig.model,
            apiKeyEnvVar,
            providerConfig.baseUrl
          );
          if (!providerResult.ok) {
            // Log and skip — other providers in the list may still work.
            process.stderr.write(
              `[SmartRouter] Skipping Anthropic provider "${providerConfig.id}": ${providerResult.error.message}\n`
            );
            return [];
          }
          return [providerResult.value];
        }
        default:
          return [];
      }
    });

    if (builtProviders.length > 0) {
      const routingPolicy = llmConfig.routing ?? {
        preferLocal: true,
        maxCostPerCallUsd: 0.01,
        fallbackChain: []
      };

      // Use DefaultBudgetGate when maxCostPerCallUsd > 0, NoopBudgetGate otherwise.
      // NoopBudgetGate is safe for local-only setups (ollama, mock) that have zero cost.
      const budgetGate = routingPolicy.maxCostPerCallUsd > 0
        ? new DefaultBudgetGate(routingPolicy.maxCostPerCallUsd)
        : new NoopBudgetGate();

      smartRouter = new SmartRouter(
        builtProviders,
        routingPolicy,
        DEFAULT_COST_CATALOG,
        budgetGate
      );
    }
  }

  // Stage 24: eval store + harness wiring.
  const evalStore = new InMemoryEvalStore({
    capacity: resolved.value.evals?.store?.capacity
  });
  const evalHarness = new EvalHarness();

  // Always-on suites. Both use lazy options providers so they pull fresh data
  // at run-time.
  evalHarness.registerSuite(
    new RetrievalQualitySuite(() => ({}))
  );
  evalHarness.registerSuite(
    new AgentEvaluator(evalStore, () => ({}))
  );

  // LLM judge — disabled by default. Requires explicit enable + SmartRouter (D15).
  if (resolved.value.evals?.llmJudge?.enabled === true && smartRouter) {
    evalHarness.registerSuite(
      new LlmJudgeEvaluator(smartRouter, () => ({ items: [] }))
    );
  }

  // Stage 25: agent definition registry wiring.
  // Auto-built from config.agents.agents when no caller override supplied.
  // Always contains the six default definitions (no policy fields) — D23
  // guarantees backwards-compatibility.
  const agentRegistry =
    startOptions.agentRegistry ??
    createAgentDefinitionRegistry(resolved.value.agents.agents);

  // Hoist observability so it can be passed to createInputGuard below.
  const observability = startOptions.observability ?? new StderrObservabilitySink();

  // Stage 25.5: input guard wiring (D26).
  // Built from resolved security config — no options override (built-from-config only).
  // NoopInputGuard when promptInjectionDefense absent or enabled:false (D23 compat).
  const inputGuard = createInputGuard(resolved.value.security, observability);

  // Stage 25.5 P05: content guard + feedback hook wiring (D42 / D43).
  // No-op defaults when no override supplied — D23 backwards-compat preserved.
  const contentGuard: ContentGuard = contentGuardOverride ?? new NoopContentGuard();
  const feedbackHook: FeedbackHook = feedbackHookOverride ?? new NoopCritiqueLoop();
  const supervisorPolicy = supervisorPolicyOverride ?? new DefaultSupervisorPolicy();
  const executorOptions: ExecutorOptions = {
    config: resolved.value,
    observability,
    trajectoryRecorder,
    tokenRecorder,
    evalStore,
    agentRegistry,
    sessionManager,
    sessionId: startOptions.sessionId
  };
  const singleAgentExecutor = new SingleAgentExecutor(executorOptions);
  const multiAgentExecutor = new TokenEfficientMultiAgentExecutor(executorOptions);
  const orchestrator =
    orchestratorOverride ??
    new AgentOrchestrator({
      supervisorPolicy,
      agentRegistry,
      singleAgentExecutor,
      multiAgentExecutor,
      contentGuard,
      feedbackHook
    });

  return ok({
    config: resolved.value,
    tools: registeredTools,
    // Pass the retrievalRouter (auto-wired or explicitly supplied) so live tool
    // handlers can delegate to it. Callers that supply custom handlers bypass
    // this wiring intentionally.
    handlers: startOptions.handlers ?? createFrameworkToolHandlers(retrievalRouter, smartRouter, embeddingProvider, evalHarness, inputGuard),
    observability,
    trajectoryRecorder,
    tokenRecorder,
    evalStore,
    evalHarness,
    agentRegistry,
    orchestrator,
    inputGuard,
    contentGuard,
    feedbackHook,
    retrievalRouter,
    storageProvider,
    sessionManager,
    traceSink,
    smartRouter,
    embeddingProvider
  });
}

/**
 * Creates a handle for runtime surfaces that have passed policy checks but are
 * represented by lightweight adapters in this package.
 *
 * The handle mirrors the shape future transport-backed implementations need:
 * mode, bind metadata, registered tools, an optional server reference for
 * local-stdio-mcp, and an async stop hook.
 */
function stoppedHandle(params: {
  readonly mode: RuntimeMode;
  readonly host?: string;
  readonly port?: number;
  readonly tools: readonly ToolContract[];
  readonly server?: McpServer;
}): RuntimeHandle {
  return {
    mode: params.mode,
    host: params.host,
    port: params.port,
    registeredTools: params.tools,
    server: params.server,
    async stop() {
      return ok(undefined);
    }
  };
}

/**
 * Local STDIO MCP adapter for developer workflows.
 *
 * The adapter prepares local-safe tools and an MCP server instance, but it does
 * not connect a transport during import or construction. Generated entrypoints
 * call `startLocalRuntime` explicitly so runtime startup stays visible.
 */
export class LocalStdioMcpRuntimeAdapter {
  /**
   * Stores the resolved service container that supplies config, tools, and
   * observability behavior to the adapter.
   */
  constructor(private readonly container: RuntimeServiceContainer) {}

  /**
   * Prepares the local STDIO runtime and returns a runtime handle.
   *
   * The method filters out shell-capable tools, logs through the injected sink,
   * creates the MCP server wrapper, and leaves protocol transport connection to
   * explicit entrypoints.
   */
  async start(): Promise<FrameworkResult<RuntimeHandle>> {
    // Local mode may use developer-oriented read/context tools, but shell
    // access remains excluded by the shared tool filter.
    const tools = filterToolsForMode(this.container.tools, "local-stdio-mcp");

    // STDOUT belongs to the MCP protocol stream for STDIO transports. Human
    // logs on stdout can corrupt client/server framing, so local diagnostics
    // must use stderr or an injected observability sink.
    await this.container.observability.log({
      level: "info",
      message: "Local STDIO MCP runtime prepared.",
      metadata: { toolCount: tools.length }
    });
    // Creating the MCP server registers tool metadata but does not attach
    // stdin/stdout transports. The server is returned in the handle so generated
    // entrypoints can connect a StdioServerTransport explicitly.
    const server = createMcpServerForTools({
      name: this.container.config.project.slug ?? "agentic-local-runtime",
      version: "0.1.0",
      tools,
      runtimeMode: "local-stdio-mcp",
      executeTool: (input) =>
        new AgentHarness({
          tools,
          handlers: this.container.handlers,
          agentRegistry: this.container.agentRegistry,
          trajectoryRecorder: this.container.trajectoryRecorder,
          tokenRecorder: this.container.tokenRecorder
        }).executeTool(input)
    });

    // Capture the storage provider reference so stop() can call close() on it.
    // close() is now a formal contract on StorageProvider, so no duck-typing needed.
    const { storageProvider } = this.container;

    return ok({
      mode: "local-stdio-mcp" as RuntimeMode,
      registeredTools: tools,
      server,
      async stop(): Promise<FrameworkResult<void>> {
        await storageProvider?.close();
        return ok(undefined);
      }
    });
  }
}

/**
 * Checks whether the selected remote surface has the minimum policies required
 * before startup is allowed.
 *
 * Remote runtime policy is explicit because a partially configured public
 * service is a security failure, not a convenience mode.
 */
function hasRequiredRemotePolicy(config: ResolvedProjectConfig, mode: "remote-http-mcp" | "api-service"): boolean {
  if (mode === "remote-http-mcp") {
    const remote = config.runtime.remoteHttpMcp;

    return (
      remote?.auth?.required === true &&
      remote.audit?.enabled === true &&
      remote.rateLimit?.required === true
    );
  }

  const api = config.runtime.apiService;

  return (
    api?.auth?.required === true &&
    api.audit?.enabled === true &&
    api.rateLimit?.required === true
  );
}

/**
 * Detects bind hosts that expose the service beyond loopback by default.
 *
 * Public binding is not rejected after policy checks in this initial adapter,
 * but it is never chosen automatically; callers must configure it explicitly.
 */
function isPublicBindHost(host: string): boolean {
  return host === "0.0.0.0" || host === "::" || host === "";
}

/**
 * Shared base for remote-safe MCP and API surfaces.
 *
 * The base class centralizes fail-closed policy checks, bind defaults, tool
 * filtering, and safe handle creation so both remote surfaces enforce the same
 * trust boundary.
 */
abstract class RemoteRuntimeAdapterBase {
  /**
   * Captures the service container and the concrete remote runtime mode that
   * will be enforced by `startRemoteSurface`.
   */
  protected constructor(
    protected readonly container: RuntimeServiceContainer,
    private readonly mode: "remote-http-mcp" | "api-service"
  ) {}

  /**
   * Starts the shared remote-safe surface after validating required policies.
   *
   * The method returns typed `FrameworkResult` failures for missing policy or
   * unsafe tools instead of throwing, which lets generated services report
   * readable startup diagnostics without stack traces.
   */
  protected startRemoteSurface(params: {
    readonly host?: string;
    readonly port?: number;
  }): FrameworkResult<RuntimeHandle> {
    // Remote surfaces are fail-closed because a publicly reachable agentic
    // server without auth, audit, and rate limits is a security boundary
    // failure, not a degraded mode.
    if (!hasRequiredRemotePolicy(this.container.config, this.mode)) {
      return fatal(
        "runtime.remote-policy-required",
        `${this.mode} requires auth, audit, and rate-limit policy before startup.`
      );
    }

    // Loopback is the only default. Public/non-local hosts must come from the
    // caller's config so accidental exposure cannot happen by omission.
    const host = params.host ?? "127.0.0.1";

    // Keep the public-bind guard here as an explicit future-proof boundary even
    // though missing policy is already rejected above.
    if (isPublicBindHost(host) && !hasRequiredRemotePolicy(this.container.config, this.mode)) {
      return fatal(
        "runtime.public-bind-denied",
        `${this.mode} cannot bind publicly without explicit remote safety policies.`
      );
    }

    // First reduce tools to the selected runtime mode, then apply the stronger
    // remote-safe predicate before anything can be registered.
    const allowedTools = filterToolsForMode(this.container.tools, this.mode);
    const safeTools = assertRemoteToolsSafe(allowedTools);

    if (!safeTools.ok) {
      return safeTools;
    }

    // Tool metadata is registered in an SDK server wrapper only after policy
    // checks pass. Transport binding remains outside import/construction.
    createMcpServerForTools({
      name: this.container.config.project.slug ?? this.mode,
      version: "0.1.0",
      tools: safeTools.value,
      runtimeMode: this.mode,
      executeTool: (input) =>
        new AgentHarness({
          tools: safeTools.value,
          handlers: this.container.handlers,
          agentRegistry: this.container.agentRegistry,
          trajectoryRecorder: this.container.trajectoryRecorder,
          tokenRecorder: this.container.tokenRecorder
        }).executeTool(input)
    });

    return ok(
      stoppedHandle({
        mode: this.mode,
        host,
        port: params.port,
        tools: safeTools.value
      })
    );
  }
}

/**
 * Adapter for the remote HTTP MCP surface.
 *
 * It inherits remote policy enforcement from `RemoteRuntimeAdapterBase` and
 * reads host/port defaults from `runtime.remoteHttpMcp`.
 */
export class RemoteHttpMcpRuntimeAdapter extends RemoteRuntimeAdapterBase {
  /**
   * Creates a remote MCP adapter from the already-composed runtime services.
   */
  constructor(container: RuntimeServiceContainer) {
    super(container, "remote-http-mcp");
  }

  /**
   * Validates remote MCP policy, filters tools, and returns the remote MCP
   * runtime handle.
   */
  async start(): Promise<FrameworkResult<RuntimeHandle>> {
    const remote = this.container.config.runtime.remoteHttpMcp;

    return this.startRemoteSurface({
      host: remote?.host ?? "127.0.0.1",
      port: remote?.port
    });
  }
}

/**
 * Adapter for the HTTPS/API service surface.
 *
 * The API adapter shares remote-safe policy with the MCP adapter while exposing
 * API-service mode metadata and configuration.
 */
export class ApiServiceRuntimeAdapter extends RemoteRuntimeAdapterBase {
  /**
   * Creates an API adapter from the already-composed runtime services.
   */
  constructor(container: RuntimeServiceContainer) {
    super(container, "api-service");
  }

  /**
   * Validates API policy, filters tools, and returns the API runtime handle.
   */
  async start(): Promise<FrameworkResult<RuntimeHandle>> {
    const api = this.container.config.runtime.apiService;

    return this.startRemoteSurface({
      host: api?.host ?? "127.0.0.1",
      port: api?.port
    });
  }
}

/**
 * Convenience entrypoint used by generated local MCP packages.
 *
 * It composes the runtime services and starts only the local STDIO adapter,
 * keeping generated `server.ts` import-safe while `start.ts` performs startup.
 */
export async function startLocalRuntime(
  config: AgenticInfraProjectConfig | ResolvedProjectConfig,
  options: RuntimeStartOptions = {}
): Promise<FrameworkResult<RuntimeHandle>> {
  const container = createRuntimeServiceContainer({ config, ...options });

  if (!container.ok) {
    return container;
  }

  // Trace the full startup sequence as one span for OTel visibility.
  const startupSpan = container.value.traceSink.startSpan("startLocalRuntime", {
    storageType: container.value.storageProvider?.type ?? "none"
  });

  const { storageProvider } = container.value;

  // Step 2: Migration startup — only runs for Postgres providers when
  // RUN_AGENTIC_AI_INFRA_MIGRATIONS env var is set to a non-empty string.
  // In-memory providers have no schema; this block is silently skipped for them.
  //
  // Sequence contract (CHANGE 4): runMigrations → assertEmbeddingDimension
  // → tool registration → adapter start. Migration failure is fatal so the
  // runtime never starts against an unmigrated or partially-migrated schema.
  if (storageProvider?.type === "postgres") {
    const envMigrations = process.env["RUN_AGENTIC_AI_INFRA_MIGRATIONS"];
    const rawProvider = storageProvider as unknown as Record<string, unknown>;

    if (typeof rawProvider["runMigrations"] === "function" && envMigrations) {
      try {
        const migResult = await (
          rawProvider["runMigrations"] as (
            approvalText: string
          ) => Promise<FrameworkResult<unknown>>
        )(RUN_AGENTIC_AI_INFRA_MIGRATIONS);

        if (!migResult.ok) {
          return fatal(
            "storage.migration-failed",
            `Migration execution failed: ${migResult.error.message}`
          );
        }
      } catch (error) {
        return fatal(
          "storage.migration-failed",
          error instanceof Error
            ? error.message
            : "Migration execution threw unexpectedly."
        );
      }
    } else if (typeof rawProvider["runMigrations"] === "function" && !envMigrations) {
      // Postgres detected but migrations not requested — emit one advisory warning.
      console.warn(
        "Migrations not run — set RUN_AGENTIC_AI_INFRA_MIGRATIONS=true to apply"
      );
    }
  }

  /**
   * Embedding dimension guard — runs after config resolution and migrations,
   * before tool registration and MCP server creation.
   *
   * WHY AT STARTUP: If the pgvector column dimension does not match the
   * configured embedding dimension, every insert will silently store
   * dimension-mismatched vectors and retrieval results will be semantically
   * meaningless. Catching the skew at startup prevents silent data corruption
   * that would only surface as degraded search quality at query time.
   *
   * WHY DUCK-TYPED: Not all storage providers use pgvector or embeddings.
   * `assertEmbeddingDimension` is only present on providers that have that
   * capability (e.g. `PostgresStorageProvider`). Duck-typing avoids coupling
   * the runtime startup to a specific provider class while still enforcing the
   * guard for providers that do carry it.
   *
   * PREREQUISITE: Migration 003 must be applied against the Postgres database
   * before this check can pass against a real DB. Call `runMigrations()` with
   * the exact approval text before the first startup after schema changes.
   */

  /**
   * Validates the pgvector schema column dimension against the wired embedding
   * provider's dimension (or MOCK_EMBEDDING_DIMENSION when none is wired).
   * Uses duck-typing: the check is skipped for providers without
   * assertEmbeddingDimension (InMemoryStorageProvider in CI).
   */
  if (
    storageProvider !== undefined &&
    typeof (storageProvider as unknown as Record<string, unknown>).assertEmbeddingDimension === "function"
  ) {
    try {
      const pgProvider = storageProvider as StorageProvider & {
        assertEmbeddingDimension(dimension: number): Promise<void>;
      };
      // Use the wired provider's actual dimension when available.
      // Falls back to MOCK_EMBEDDING_DIMENSION (1024 after Stage 20) when no
      // provider was wired (non-vector profiles skip this check via duck-type gate).
      const dimension =
        container.value.embeddingProvider?.dimension ?? MOCK_EMBEDDING_DIMENSION;
      await pgProvider.assertEmbeddingDimension(dimension);
    } catch {
      return fatal(
        "storage.pgvector-unavailable",
        "Embedding dimension mismatch. Run migration 005 before starting the runtime."
      );
    }
  }

  // Instantiate the adapter only after config resolution and storage validation
  // succeed so startup failures have typed validation context.
  const result = await new LocalStdioMcpRuntimeAdapter(container.value).start();
  startupSpan.setAttribute("success", result.ok ? 1 : 0);
  startupSpan.end();

  return result;
}

/**
 * Convenience entrypoint used by generated remote MCP service packages.
 *
 * Missing auth, audit, or rate-limit policy is returned as a fatal typed
 * `FrameworkResult` error before any tool registration can occur.
 */
export async function startRemoteRuntime(
  config: AgenticInfraProjectConfig | ResolvedProjectConfig,
  options: RuntimeStartOptions = {}
): Promise<FrameworkResult<RuntimeHandle>> {
  const container = createRuntimeServiceContainer({ config, ...options });

  if (!container.ok) {
    return container;
  }

  return await new RemoteHttpMcpRuntimeAdapter(container.value).start();
}

/**
 * Convenience entrypoint used by generated API service packages.
 *
 * The function mirrors `startRemoteRuntime` so generated services can start MCP
 * and API surfaces independently while sharing the same config and policies.
 */
export async function startApiService(
  config: AgenticInfraProjectConfig | ResolvedProjectConfig,
  options: RuntimeStartOptions = {}
): Promise<FrameworkResult<RuntimeHandle>> {
  const container = createRuntimeServiceContainer({ config, ...options });

  if (!container.ok) {
    return container;
  }

  return await new ApiServiceRuntimeAdapter(container.value).start();
}

/**
 * Builds a typed rejection result for unsafe tool attempts.
 *
 * Adapters and tests use this helper when a tool contract violates the selected
 * runtime boundary and the caller needs a consistent `FrameworkResult` shape.
 */
export function createUnsafeToolRejection(tool: ToolContract): FrameworkResult<ToolContract> {
  return recoverable("runtime.unsafe-tool", `Tool "${tool.id}" is not safe for this runtime.`);
}
