import {
  DefaultRemoteSafeToolFilter,
  InMemoryToolContractRegistry,
  isRemoteSafeTool,
  type AggregateQualityReport,
  type EmbeddingProvider,
  type FrameworkResult,
  type QualityReport,
  type RetrievalResult,
  type RuntimeConfig,
  type RuntimeMode,
  type ToolContract,
  type ToolContractRegistry,
  type ToolExecutionHandler,
  ok
} from "@maharudra/agentic-ai-infra-core";
import { recoverable } from "../errors/index.js";
import { ContextBuilder } from "../context/index.js";
import { RetrievalRouter } from "../retrieval/index.js";
import type { SmartRouter } from "../llm/index.js";
import { runAgentRuntimeEvals, runRetrievalQualityEvals } from "../evals/index.js";
import { EvalHarness, aggregateReports } from "../harness/eval-harness.js";
import { type InputGuard, NoopInputGuard } from "../guardrails/index.js";

const REMOTE_ABSOLUTE_PATH_PATTERN = /[A-Za-z]:\\|(?:^|["'\s])\/(?:Users|home|var|etc|tmp)\//;
const SECRET_PATTERN = /(BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY|api[_-]?key|secret|token|password\s*[=:])/i;

/**
 * Creates the default framework-level tool contracts used by generated runtime
 * services.
 *
 * These contracts are intentionally bounded and remote-safe so the same list can
 * be filtered for local STDIO, remote MCP, and API surfaces.
 */
export function createFrameworkToolContracts(): readonly ToolContract[] {
  const sharedModes: readonly RuntimeMode[] = [
    "local-stdio-mcp",
    "remote-http-mcp",
    "api-service"
  ];

  // Each contract declares both runtime eligibility and output policy. Runtime
  // adapters use both dimensions before exposing a tool.
  return [
    {
      id: "agentic.project.status",
      name: "Project status",
      description: "Returns bounded project identity and runtime status metadata.",
      category: "business-safe",
      riskLevel: "low",
      outputPolicy: { remoteSafe: true, maxBytes: 4096 },
      runtimePolicy: { allowedModes: sharedModes, remoteSafe: true }
    },
    {
      id: "agentic.config.status",
      name: "Config status",
      description: "Returns bounded project configuration validation status.",
      category: "business-safe",
      riskLevel: "low",
      outputPolicy: { remoteSafe: true, maxBytes: 4096 },
      runtimePolicy: { allowedModes: sharedModes, remoteSafe: true }
    },
    {
      id: "agentic.health.status",
      name: "Health status",
      description: "Returns bounded runtime and storage health information.",
      category: "observability",
      riskLevel: "low",
      outputPolicy: { remoteSafe: true, maxBytes: 4096 },
      runtimePolicy: { allowedModes: sharedModes, remoteSafe: true }
    },
    {
      id: "agentic.retrieval.search",
      name: "Retrieval search",
      description: "Runs configured retrieval providers and returns bounded previews.",
      category: "retrieval",
      riskLevel: "low",
      outputPolicy: { remoteSafe: true, maxBytes: 8192, returnsVectors: false },
      runtimePolicy: { allowedModes: sharedModes, remoteSafe: true }
    },
    {
      id: "agentic.context.build",
      name: "Context build",
      description: "Builds a compact context package from safe retrieval previews.",
      category: "context",
      riskLevel: "low",
      outputPolicy: { remoteSafe: true, maxBytes: 12288, returnsRawFiles: false },
      runtimePolicy: { allowedModes: sharedModes, remoteSafe: true }
    },
    {
      id: "agentic.diagnostics.summary",
      name: "Diagnostics summary",
      description: "Returns bounded diagnostics and eval summaries without raw logs.",
      category: "eval",
      riskLevel: "low",
      outputPolicy: { remoteSafe: true, maxBytes: 4096 },
      runtimePolicy: { allowedModes: sharedModes, remoteSafe: true }
    },
    {
      id: "agentic.evals.run",
      name: "Run Eval Suite",
      description:
        "Runs a framework eval suite and returns a quality report. " +
        "In Stage 21, most checks return 'skipped' without real retrieval data; " +
        "Stage 24 wires agent execution results for full coverage.",
      category: "eval",
      riskLevel: "low",
      outputPolicy: { remoteSafe: true, maxBytes: 16384 },
      runtimePolicy: { allowedModes: sharedModes, remoteSafe: true }
    },
    {
      id: "agentic.evals.agent-eval",
      name: "Run Agent Eval",
      description:
        "Runs the agent-evaluator suite via the wired EvalHarness. " +
        "Returns the AggregateQualityReport. When no EvalHarness or " +
        "agent-evaluator suite is registered, returns an aggregate with " +
        "status='skipped'.",
      category: "eval",
      riskLevel: "low",
      outputPolicy: { remoteSafe: true, maxBytes: 16384 },
      runtimePolicy: { allowedModes: sharedModes, remoteSafe: true }
    }
  ];
}

/**
 * Creates handlers for the framework-level tools.
 *
 * Static tools (project.status, config.status, health.status, diagnostics.summary)
 * return bounded bounded summaries with no side effects.
 *
 * Live tools (agentic.retrieval.search, agentic.context.build) delegate to the
 * supplied RetrievalRouter and ContextBuilder when a router is provided. When the
 * router is absent the handler returns a bounded "not-configured" status rather
 * than an error, so the tool is always callable regardless of whether storage has
 * been wired.
 *
 * @param retrievalRouter - Optional router from the RuntimeServiceContainer.
 *   Required for live retrieval and context build behavior. When absent both
 *   live tools return a "not-configured" status without error.
 * @param smartRouter - Optional SmartRouter for query rewrite in agentic.retrieval.search.
 *   When wired, attempts LLM query rewrite before dispatching to providers. Falls back
 *   silently to the original query on any failure or invalid rewrite output.
 * @param embeddingProvider - Optional embedding provider for context dedup in
 *   agentic.context.build. When absent dedup falls back to Jaccard similarity.
 * @param evalHarness - Optional `EvalHarness` for live eval dispatch. When set,
 *   `agentic.evals.run` and `agentic.evals.agent-eval` route through the
 *   harness; when absent, both fall back to a "skipped" aggregate response.
 * @param inputGuard - Optional input guard for retrieved content inspection.
 *   Defaults to `NoopInputGuard` (D23 compat — no behavior change when absent).
 */
export function createFrameworkToolHandlers(
  retrievalRouter?: RetrievalRouter,
  smartRouter?: SmartRouter,
  embeddingProvider?: EmbeddingProvider,
  evalHarness?: EvalHarness,
  inputGuard?: InputGuard                              // NEW — Stage 25.5 Phase 01
): ReadonlyMap<string, ToolExecutionHandler> {
  const guard = inputGuard ?? new NoopInputGuard();
  const handlers = new Map<string, ToolExecutionHandler>();

  // Static bounded handlers — no external service access.
  const LIVE_TOOL_IDS = new Set([
    "agentic.retrieval.search",
    "agentic.context.build",
    "agentic.evals.run",
    "agentic.evals.agent-eval"
  ]);
  for (const tool of createFrameworkToolContracts()) {
    if (LIVE_TOOL_IDS.has(tool.id)) {
      continue;
    }
    handlers.set(tool.id, async (_input, context) =>
      ok({
        toolId: tool.id,
        output: {
          toolId: tool.id,
          runtimeMode: context.runtimeMode,
          status: "available",
          taskHash: context.task?.taskHash,
          taskType: context.task?.taskType,
          approvalMatched: context.approvalMatched ?? true
        },
        tokenUsage: {
          inputTokens: 1,
          outputTokens: 24,
          totalTokens: 25
        },
        metadata: {
          safeSummary: true
        }
      })
    );
  }

  // ---------------------------------------------------------------------------
  // agentic.retrieval.search — live handler
  // ---------------------------------------------------------------------------

  handlers.set("agentic.retrieval.search", async (input, context) => {
    // When no router is wired the tool reports its unconfigured state rather
    // than failing, so callers can distinguish "retrieval not set up" from
    // errors returned during actual retrieval.
    if (!retrievalRouter) {
      return ok({
        toolId: "agentic.retrieval.search",
        output: {
          status: "not-configured",
          message:
            "No RetrievalRouter is configured for this runtime. " +
            "Provide a retrievalRouter in RuntimeStartOptions to enable live retrieval.",
          results: [],
          resultCount: 0
        },
        tokenUsage: { inputTokens: 1, outputTokens: 8, totalTokens: 9 },
        metadata: { safeSummary: true }
      });
    }

    const rawInput = input as Record<string, unknown> | null | undefined;
    const query =
      typeof rawInput?.query === "string" ? rawInput.query.trim() : "";
    const maxChunks =
      typeof rawInput?.maxChunks === "number" && rawInput.maxChunks > 0
        ? Math.min(rawInput.maxChunks, 20)
        : 10;

    if (!query) {
      return recoverable(
        "retrieval.unsupported-input",
        "agentic.retrieval.search requires a non-empty query string."
      );
    }

    // ── SmartRouter query rewrite (Stage 21) ──────────────────────────────
    // Attempts to improve retrieval quality by rewriting the original query
    // with an LLM before dispatching to providers. This runs only when a
    // SmartRouter is wired (local dev with Ollama / production with Anthropic).
    //
    // When a SmartRouter is wired, attempts query rewrite via LLM before retrieval.
    // Falls back to original query silently on failure or invalid rewrite output.
    //
    // Graceful degradation: on any SmartRouter failure, or when the rewritten
    // text fails the validity guard, the original query is used unchanged.
    // The tool output includes rewrittenQuery when a rewrite was actually applied.
    let effectiveQuery = query;
    let rewrittenQuery: string | undefined;

    if (smartRouter) {
      const rewriteResult = await smartRouter.complete({
        systemPrompt:
          "You are a query rewriter for a codebase documentation retrieval system. " +
          "Rewrite the search query to improve retrieval quality. " +
          "Return ONLY the rewritten query. Do not explain, quote, or add formatting.",
        prompt: query,
        maxTokens: 64,
        temperature: 0
      });

      if (rewriteResult.ok) {
        const candidate = rewriteResult.value.content.trim();

        // Guard: reject mock artifacts and degenerate responses.
        // MockLlmProvider returns "[mock] received N chars" — not a valid query.
        const isValidRewrite =
          candidate.length > 5 &&
          candidate.length < 300 &&
          !candidate.startsWith("[mock]");

        if (isValidRewrite) {
          effectiveQuery = candidate;
          rewrittenQuery = candidate;
        }
      }
      // On result.ok === false: silently use original query (budget-exceeded,
      // provider-unavailable, etc. are non-fatal for retrieval search).
    }

    // Run the router. Wrap in try/catch so an unexpected throw (e.g. a broken
    // provider) becomes a recoverable FrameworkResult instead of propagating.
    let retrieved: FrameworkResult<readonly RetrievalResult[]>;
    try {
      retrieved = await retrievalRouter.retrieve({ query: effectiveQuery, maxResults: maxChunks });
    } catch (err) {
      return recoverable(
        "framework.internal-error",
        `Retrieval failed unexpectedly: ${err instanceof Error ? err.message : "unknown error"}`
      );
    }

    if (!retrieved.ok) {
      // Surface the provider-level error code so callers can distinguish
      // "not configured" from "not indexed" from other retrieval failures.
      return recoverable(retrieved.error.code, retrieved.error.message);
    }

    // Run input guard on raw retrieved results BEFORE output shaping (D26).
    // Non-fatal: result still returned regardless of verdict.
    const searchVerdict = guard.inspect({
      contextPackage: {
        id: "retrieval-search",
        task: effectiveQuery,
        sources: retrieved.value.map((r) => ({ sourceId: r.sourceId, label: r.sourceId })),
        contextText: retrieved.value.map((r) => r.content ?? "").join("\n"),
        tokenEstimate: retrieved.value.length * 8
      },
      retrievedResults: retrieved.value,
      runtimeMode: context.runtimeMode
    });

    // Sanitize outputs: bounded preview, no vectors, no secrets, no raw SQL,
    // no full file content. Only safe scalar fields per tool output policy.
    const results = retrieved.value.map((r) => ({
      chunkId: String(r.metadata?.chunkId ?? `${r.sourceId}-result`),
      relPath: r.sourceId,
      // headingPath lives in metadata as a string array set by the markdown chunker.
      headingPath: Array.isArray(r.metadata?.headingPath)
        ? (r.metadata!.headingPath as string[])
        : [],
      preview: r.preview.slice(0, 300),
      score: Number(r.score.toFixed(4))
    }));

    return ok({
      toolId: "agentic.retrieval.search",
      output: {
        status: "ok",
        query,
        ...(rewrittenQuery !== undefined && { rewrittenQuery }),
        results,
        resultCount: results.length,
        runtimeMode: context.runtimeMode,
        ...(searchVerdict.suspectCount > 0 && { suspectCount: searchVerdict.suspectCount })
      },
      tokenUsage: {
        inputTokens: Math.max(1, Math.ceil(query.length / 4)),
        outputTokens: Math.max(1, results.length * 8),
        totalTokens: Math.max(2, Math.ceil(query.length / 4) + results.length * 8)
      },
      metadata: { safeSummary: true }
    });
  });

  // ---------------------------------------------------------------------------
  // agentic.context.build — live handler
  // ---------------------------------------------------------------------------

  handlers.set("agentic.context.build", async (input, context) => {
    if (!retrievalRouter) {
      return ok({
        toolId: "agentic.context.build",
        output: {
          status: "not-configured",
          message:
            "No RetrievalRouter is configured for this runtime. " +
            "Provide a retrievalRouter in RuntimeStartOptions to enable live context building.",
          contextId: null,
          tokenEstimate: 0,
          sourceCount: 0,
          citations: [],
          preview: ""
        },
        tokenUsage: { inputTokens: 1, outputTokens: 8, totalTokens: 9 },
        metadata: { safeSummary: true }
      });
    }

    const rawInput = input as Record<string, unknown> | null | undefined;
    const taskStr =
      typeof rawInput?.task === "string" ? rawInput.task.trim() : "";
    const maxTokens =
      typeof rawInput?.maxTokens === "number" && rawInput.maxTokens > 0
        ? Math.min(rawInput.maxTokens, 8000)
        : 4000;

    if (!taskStr) {
      return recoverable(
        "retrieval.unsupported-input",
        "agentic.context.build requires a non-empty task string."
      );
    }

    // Step 1 — Retrieve relevant evidence using the task as the query.
    let retrieved: FrameworkResult<readonly RetrievalResult[]>;
    try {
      retrieved = await retrievalRouter.retrieve({ query: taskStr, maxResults: 10 });
    } catch (err) {
      return recoverable(
        "framework.internal-error",
        `Context build retrieval failed: ${err instanceof Error ? err.message : "unknown error"}`
      );
    }

    if (!retrieved.ok) {
      return recoverable(
        retrieved.error.code,
        `Context build failed during retrieval: ${retrieved.error.message}`
      );
    }

    // Step 2 — Assemble a bounded context package from the retrieval results.
    // ContextBuilder is instantiated here (not in the container) because it has
    // no external state — it is a pure function of its input.
    const contextResult = await new ContextBuilder({
      embeddingProvider
    }).build({
      task: taskStr,
      retrievalResults: retrieved.value,
      tokenBudget: {
        maxTotalTokens: maxTokens + 500,
        maxContextTokens: maxTokens,
        maxResponseTokens: 500
      }
    });

    if (!contextResult.ok) {
      return recoverable(contextResult.error.code, contextResult.error.message);
    }

    // Run input guard on retrieved results AFTER context build, BEFORE output (D26).
    // Non-fatal: context package is still returned regardless of verdict.
    guard.inspect({
      contextPackage: contextResult.value,
      retrievedResults: retrieved.value,
      runtimeMode: context.runtimeMode
    });

    const pkg = contextResult.value;
    // Citations include a 1-based index, label, and source id — no file paths
    // beyond the stored sourceId, no raw content.
    const citations = pkg.sources.map((s, i) => `[${i + 1}] ${s.label} (${s.sourceId})`);
    // Preview is bounded to 500 chars — never raw vectors, secrets, or full files.
    const preview = pkg.contextText.slice(0, 500);

    return ok({
      toolId: "agentic.context.build",
      output: {
        status: "ok",
        contextId: pkg.id,
        tokenEstimate: pkg.tokenEstimate,
        sourceCount: pkg.sources.length,
        citations,
        preview
      },
      tokenUsage: {
        inputTokens: Math.max(1, Math.ceil(taskStr.length / 4)),
        outputTokens: Math.max(1, Math.ceil(preview.length / 4)),
        totalTokens: Math.max(2, Math.ceil((taskStr.length + preview.length) / 4))
      },
      metadata: { safeSummary: true }
    });
  });

  // ---------------------------------------------------------------------------
  // agentic.evals.run — eval suite handler
  // ---------------------------------------------------------------------------

  /**
   * Runs a framework eval suite and returns an `AggregateQualityReport` (D13).
   *
   * When an `EvalHarness` is wired, the named suite is dispatched through it.
   * When no harness is wired (or the suite is not registered), falls back to the
   * static `runRetrievalQualityEvals` / `runAgentRuntimeEvals` functions so the
   * back-compat path from Stage 21 is preserved and the tool is always callable.
   */
  handlers.set("agentic.evals.run", async (input, _context) => {
    const rawInput = input as Record<string, unknown> | null | undefined;
    const suite =
      typeof rawInput?.suite === "string" ? rawInput.suite : "retrieval-quality";

    let report: QualityReport;

    // 1) Try the wired EvalHarness first (Stage 24 path).
    if (evalHarness) {
      const harnessResult = await evalHarness.runSuite(suite);
      if (harnessResult.ok) {
        report = harnessResult.value;
        const aggregate: AggregateQualityReport = aggregateReports([report]);
        return ok({
          toolId: "agentic.evals.run",
          output: aggregate as unknown as Record<string, unknown>,
          tokenUsage: { inputTokens: 1, outputTokens: 12, totalTokens: 13 },
          metadata: { safeSummary: true }
        });
      }
      // Harness present but suite not registered → fall through to static path
      // so the old behavior is preserved.
    }

    // 2) Back-compat static fallback (no harness or unknown suite).
    if (suite === "agent-runtime") {
      report = runAgentRuntimeEvals({});
    } else {
      report = runRetrievalQualityEvals({});
    }

    const aggregate: AggregateQualityReport = aggregateReports([report]);
    return ok({
      toolId: "agentic.evals.run",
      output: aggregate as unknown as Record<string, unknown>,
      tokenUsage: { inputTokens: 1, outputTokens: 12, totalTokens: 13 },
      metadata: { safeSummary: true }
    });
  });

  // ---------------------------------------------------------------------------
  // agentic.evals.agent-eval — agent eval suite handler (Stage 24)
  // ---------------------------------------------------------------------------

  /**
   * Runs the `agent-evaluator` suite via the wired `EvalHarness`.
   *
   * When `evalHarness` is absent or the `agent-evaluator` suite is not
   * registered, returns an aggregate with `status: "skipped"`. This keeps the
   * tool always callable regardless of wiring state — same pattern as
   * `agentic.retrieval.search` returning "not-configured".
   */
  handlers.set("agentic.evals.agent-eval", async (_input, _context) => {
    if (!evalHarness) {
      const aggregate: AggregateQualityReport = {
        status: "skipped",
        suites: [],
        total: 1,
        passed: 0,
        failed: 0,
        skipped: 1
      };
      return ok({
        toolId: "agentic.evals.agent-eval",
        output: aggregate as unknown as Record<string, unknown>,
        tokenUsage: { inputTokens: 1, outputTokens: 12, totalTokens: 13 },
        metadata: { safeSummary: true }
      });
    }

    const result = await evalHarness.runSuite("agent-evaluator");

    if (!result.ok) {
      // Suite not registered. Return a skipped aggregate rather than fail so
      // the tool is always usable.
      const aggregate: AggregateQualityReport = {
        status: "skipped",
        suites: [],
        total: 1,
        passed: 0,
        failed: 0,
        skipped: 1
      };
      return ok({
        toolId: "agentic.evals.agent-eval",
        output: aggregate as unknown as Record<string, unknown>,
        tokenUsage: { inputTokens: 1, outputTokens: 12, totalTokens: 13 },
        metadata: { safeSummary: true }
      });
    }

    const aggregate = aggregateReports([result.value]);
    return ok({
      toolId: "agentic.evals.agent-eval",
      output: aggregate as unknown as Record<string, unknown>,
      tokenUsage: { inputTokens: 1, outputTokens: 12, totalTokens: 13 },
      metadata: { safeSummary: true }
    });
  });

  return handlers;
}

// ---------------------------------------------------------------------------
// Registration-time policy enforcement
// ---------------------------------------------------------------------------

/**
 * Thrown when a tool contract violates policy at registration time.
 *
 * Not exported — callers receive typed FrameworkResult values from the runtime
 * layer. This error surfaces during service container construction or any
 * explicit register() call so startup fails fast rather than deferring the
 * rejection to the first call of the offending tool.
 */
class ToolRegistrationPolicyError extends Error {
  /** Stable error code from the framework error vocabulary. */
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ToolRegistrationPolicyError";
    this.code = code;
  }
}

/**
 * Policy-enforcing wrapper around InMemoryToolContractRegistry.
 *
 * **Why registration time, not call time:**
 * A tool that is structurally incompatible with the configured runtime (wrong
 * surface, unsafe risk level, shell access when shell is disabled) should never
 * reach the registry. Enforcing at register() eliminates the partial state where
 * the registry holds tools that DefaultPermissionGate would deny on every call.
 * One clear error at startup is preferable to a silent per-call denial.
 *
 * **What is checked statically here** (derivable from ToolContract + RuntimeConfig alone):
 * - Remote-safe predicate for remote-http-mcp and api-service modes — catches
 *   category, risk level, capability flags, and output policy in one isRemoteSafeTool()
 *   call (mirrors the remote check in DefaultPermissionGate.decide()).
 * - Critical risk level — no RuntimeConfig mechanism explicitly permits critical
 *   tools, so the framework fails closed: all critical-risk tools are blocked.
 *   Extend RuntimeConfig with a permit flag to relax this in a future revision.
 * - Shell access (runtimePolicy.shellAccess) and command category — always blocked
 *   unless local-stdio-mcp mode with allowShell enabled. Matches the shell check
 *   in DefaultPermissionGate.decide() so the rejection surfaces at startup.
 *
 * **What remains at call time** (dynamic, requires caller context):
 * - allowedModes check — the calling ToolExecutionContext carries the per-call mode.
 * - Agent role permission check — role is only known at invocation time.
 * - Exact approval matching for write/admin/migration tools.
 * - Network access policy — mode-dependent runtime-layer check.
 *
 * This class is the single registration-time enforcement point. It is NOT exported
 * from the public tools barrel — external code uses createRuntimeToolRegistry().
 */
class PolicyEnforcingToolRegistry implements ToolContractRegistry {
  private readonly inner: InMemoryToolContractRegistry;
  private readonly config: RuntimeConfig;

  /**
   * Constructs the registry and validates all supplied tools against the config.
   *
   * Throws ToolRegistrationPolicyError if any tool violates registration policy.
   * All tools are validated before any is stored, so a failed construction leaves
   * no partial registry state.
   *
   * @param tools - Initial tool contracts to validate and store.
   * @param config - Active RuntimeConfig; its modes drive which policy checks apply.
   */
  constructor(tools: readonly ToolContract[], config: RuntimeConfig) {
    this.config = config;
    for (const tool of tools) {
      this.assertPolicyCompliant(tool);
    }
    this.inner = new InMemoryToolContractRegistry(tools);
  }

  /**
   * Validates the tool against registration policy, then returns a new registry
   * containing all existing tools plus the validated tool.
   *
   * Throws ToolRegistrationPolicyError if the tool violates policy. The existing
   * registry is unchanged when the error is thrown.
   */
  register(tool: ToolContract): ToolContractRegistry {
    this.assertPolicyCompliant(tool);
    return new PolicyEnforcingToolRegistry([...this.inner.list(), tool], this.config);
  }

  /** Lists registered contracts in insertion order. */
  list(): readonly ToolContract[] {
    return this.inner.list();
  }

  /** Finds one contract by id. */
  findById(id: string): ToolContract | undefined {
    return this.inner.findById(id);
  }

  /**
   * Runs static registration-time policy checks against one tool contract.
   *
   * Throws immediately on the first violation so no partially-invalid contract
   * can enter the registry.
   */
  private assertPolicyCompliant(contract: ToolContract): void {
    const isRemoteMode =
      this.config.modes.includes("remote-http-mcp") ||
      this.config.modes.includes("api-service");

    // Remote surfaces must pass the full remote-safe predicate. isRemoteSafeTool()
    // checks category, risk level, capability flags, and output policy in one call,
    // so this single check covers multiple DefaultPermissionGate conditions.
    if (isRemoteMode && !isRemoteSafeTool(contract)) {
      const remoteModes = this.config.modes
        .filter((m) => m === "remote-http-mcp" || m === "api-service")
        .join("/");
      throw new ToolRegistrationPolicyError(
        "runtime.unsafe-tool",
        `Tool "${contract.id}" cannot be registered in ${remoteModes} mode: ` +
          "does not satisfy the remote-safe predicate (check category, riskLevel, " +
          "runtimePolicy flags, and outputPolicy)."
      );
    }

    // Critical-risk tools have no explicit RuntimeConfig permit mechanism. The
    // framework fails closed: block all critical tools until a permit field is added.
    // Note: isRemoteSafeTool() already rejects critical risk for remote modes above;
    // this check covers local-stdio-mcp mode as well.
    if (contract.riskLevel === "critical") {
      throw new ToolRegistrationPolicyError(
        "runtime.permission-denied",
        `Tool "${contract.id}" has riskLevel "critical" and cannot be registered: ` +
          "no explicit permit is configured in RuntimeConfig. " +
          "Add a critical-tool permit field to RuntimeConfig to enable this."
      );
    }

    // Shell-access and command tools are blocked unless the local STDIO config
    // explicitly enables shell. For any remote mode, shell is never permitted
    // regardless of the local config (covered by the remote-safe check above, but
    // also enforced here as defense in depth).
    const requiresShell =
      contract.runtimePolicy.shellAccess === true || contract.category === "command";
    if (requiresShell) {
      const localAllowsShell = this.config.localStdioMcp?.allowShell === true;
      if (!localAllowsShell || isRemoteMode) {
        throw new ToolRegistrationPolicyError(
          "runtime.permission-denied",
          `Tool "${contract.id}" requires shell or command access, which is not ` +
            "permitted in the current runtime configuration " +
            "(set localStdioMcp.allowShell: true to enable for local STDIO mode only)."
        );
      }
    }
  }
}

/**
 * Creates a policy-enforcing tool registry from the default or caller-provided
 * tool contracts.
 *
 * The returned registry wraps InMemoryToolContractRegistry with a policy layer
 * (PolicyEnforcingToolRegistry) that validates remote-safety, critical risk level,
 * and shell access at registration time — one clear failure at startup rather than
 * silent per-call denials from DefaultPermissionGate.
 *
 * @param tools - Tool contracts to register. Framework built-in tools when omitted.
 * @param config - Active RuntimeConfig that drives which policy checks apply.
 *   Defaults to local-stdio-mcp when omitted (trusted local context).
 */
export function createRuntimeToolRegistry(
  tools: readonly ToolContract[] = createFrameworkToolContracts(),
  config: RuntimeConfig = { modes: ["local-stdio-mcp"] }
): ToolContractRegistry {
  return new PolicyEnforcingToolRegistry(tools, config);
}

/**
 * Filters tool contracts for the selected runtime mode.
 *
 * Remote modes use the core remote-safe filter; local mode still blocks shell
 * tools because this framework does not provide command execution tools.
 */
export function filterToolsForMode(
  tools: readonly ToolContract[],
  mode: RuntimeMode
): readonly ToolContract[] {
  // Start with mode eligibility so a tool cannot cross surfaces just because it
  // happens to be remote-safe.
  const allowedForMode = tools.filter((tool) =>
    tool.runtimePolicy.allowedModes.includes(mode)
  );

  if (mode === "remote-http-mcp" || mode === "api-service") {
    return new DefaultRemoteSafeToolFilter().filter(allowedForMode);
  }

  // Local STDIO is trusted for local workflows but still does not permit shell
  // access in this package.
  return allowedForMode.filter((tool) => !tool.runtimePolicy.shellAccess);
}

/**
 * Validates that every tool is safe for remote exposure.
 */
export function assertRemoteToolsSafe(
  tools: readonly ToolContract[]
): FrameworkResult<readonly ToolContract[]> {
  // Re-run the predicate here as a defense-in-depth check for callers that pass
  // a pre-filtered list.
  const unsafe = tools.filter((tool) => !new DefaultRemoteSafeToolFilter().isRemoteSafe(tool));

  if (unsafe.length > 0) {
    return recoverable(
      "runtime.unsafe-tool",
      `Remote runtime refused unsafe tool contracts: ${unsafe.map((tool) => tool.id).join(", ")}.`
    );
  }

  return ok(tools);
}

/**
 * Checks tool output for data classes that must never cross the runtime surface.
 *
 * This guard complements provider-level bounding by catching accidental raw
 * files, vectors, secrets, stack traces, raw SQL, local paths, and command
 * output in composed tool handlers.
 */
export function assertSafeToolOutput(params: {
  readonly runtimeMode: RuntimeMode;
  readonly output: unknown;
}): FrameworkResult<unknown> {
  // Serialize once so nested accidental fields are inspected without requiring
  // every tool to implement its own recursive walk.
  const serialized = JSON.stringify(params.output);

  // Keep outputs bounded even when a tool mistakenly returns a large object.
  if (serialized.length > 65536) {
    return recoverable("output.unsafe", "Tool output exceeded the bounded output size.");
  }

  // Block high-risk data by field names and common secret material patterns.
  if (
    SECRET_PATTERN.test(serialized) ||
    /"vector"\s*:|"embedding"\s*:|"rawSql"\s*:|"stack"\s*:|"commandOutput"\s*:|"approvalText"\s*:|"rawTaskText"\s*:|"taskText"\s*:/i.test(serialized)
  ) {
    return recoverable("output.unsafe", "Tool output contains unsafe raw data.");
  }

  // Remote callers should not learn local absolute paths even if the underlying
  // data is otherwise harmless.
  if (
    (params.runtimeMode === "remote-http-mcp" || params.runtimeMode === "api-service") &&
    REMOTE_ABSOLUTE_PATH_PATTERN.test(serialized)
  ) {
    return recoverable("output.unsafe", "Remote output cannot include local absolute paths.");
  }

  return ok(params.output);
}
