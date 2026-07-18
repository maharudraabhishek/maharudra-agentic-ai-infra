import { REGISTERED_MCP_TOOL_NAMES } from "../../tools/tool-names.js";
import { MAX_PROJECT_CONTEXT_EXCERPT_CHARS } from "../../config/mcp-config.js";
import { MockEmbeddingProvider } from "../embeddings/mock-embedding-provider.js";
import { runContextPlannerEvals } from "./context-planner-evals.js";
import {
  getRelevantProjectContext
} from "../retrieval/context-builder.js";
import {
  normalizeProjectKnowledgeSearchOptions,
  RETRIEVED_CONTENT_UNTRUSTED_WARNING,
  searchProjectKnowledge
} from "../retrieval/hybrid-retrieval-service.js";
import type {
  ProjectKnowledgeRetrievalErrorCode,
  ProjectKnowledgeSearchResponse,
  ProjectKnowledgeSearchResult
} from "../retrieval/retrieval-types.js";

type EvalStatus = "passed" | "failed" | "skipped";

export type ProjectRagEvalDiagnostics = {
  benchmarkCategory?: string;
  expectedSourceClass?: string;
  returnedSourcePaths?: string[];
  returnedSourcePathCap?: number;
  safeSkipReason?: ProjectKnowledgeRetrievalErrorCode;
  forbiddenHitCount?: number;
  recommendedNextCheck?: string;
  contextBudget?: {
    maxChunks: number;
    maxContextChars: number;
    maxExcerptChars: number;
    returnedChunks: number;
    returnedSources: number;
    contextChars: number;
    longestExcerptChars: number;
    truncated: boolean;
  };
};

export type ProjectRagEvalResult = {
  name: string;
  status: EvalStatus;
  expected: string;
  actual: string;
  diagnostics?: ProjectRagEvalDiagnostics;
};

export type ProjectRagQualityReport = {
  retrieval: {
    expectedSourceChecks: number;
    expectedSourceHits: number;
    expectedSourceMisses: number;
    skippedChecks: number;
  };
  forbiddenSources: {
    checks: number;
    forbiddenHitCount: number;
  };
  contextBudget: {
    checks: number;
    passed: number;
    failed: number;
    maxObservedContextChars: number;
    maxObservedExcerptChars: number;
  };
  planner: {
    checks: number;
    passed: number;
    failed: number;
  };
  benchmarks: {
    checks: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  safeSkips: {
    dbUnavailable: number;
    schemaNotReady: number;
    indexNotReady: number;
  };
  failures: Array<{
    name: string;
    benchmarkCategory?: string;
    expectedSourceClass?: string;
    recommendedNextCheck?: string;
  }>;
};

export type ProjectRagEvalReport = {
  suiteName: "project-rag-evals";
  status: EvalStatus;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  results: ProjectRagEvalResult[];
  qualityReport: ProjectRagQualityReport;
};

const SKIPPABLE_ERROR_CODES: ProjectKnowledgeRetrievalErrorCode[] = [
  "db-unavailable",
  "schema-not-ready",
  "index-not-ready"
];

type RetrievalBenchmark = {
  id: string;
  category: string;
  query: string;
  expectedSourceClass: string;
  recommendedNextCheck: string;
  matches: (result: ProjectKnowledgeSearchResult) => boolean;
};

const RETRIEVAL_BENCHMARKS: RetrievalBenchmark[] = [
  {
    id: "mcp-security-policy",
    category: "MCP security policy",
    query: "AGENTS.md .env blocked sensitive path security policy",
    expectedSourceClass: "security-policy-or-agents",
    recommendedNextCheck:
      "Check security-doc source priority, AGENTS.md indexing, and full-text terms.",
    matches: (result) =>
      result.filePath === "AGENTS.md" ||
      result.filePath === "docs/05-security/mcp-security-policy.md"
  },
  {
    id: "patch-approval-workflow",
    category: "patch approval workflow",
    query: "APPLY_PATCH controlled write workflow patch approval exact text",
    expectedSourceClass: "controlled-write-doc-or-patch-source",
    recommendedNextCheck:
      "Check controlled-write docs, patch service indexing, and exact approval token matching.",
    matches: (result) =>
      result.filePath === "docs/03-mcp/controlled-write-workflow.md" ||
      result.filePath.includes("patch-service") ||
      result.preview.includes("APPLY_PATCH")
  },
  {
    id: "db-migration-workflow",
    category: "DB migration workflow",
    query: "RUN_LOCAL_AI_MIGRATIONS local AI DB migrations migration status",
    expectedSourceClass: "migration-runbook-or-db-source",
    recommendedNextCheck:
      "Check local AI DB migration runbook, migration source, and exact approval term retrieval.",
    matches: (result) =>
      result.filePath === "docs/06-runbooks/local-ai-db-migrations.md" ||
      result.filePath.includes("local-ai-migrations") ||
      result.preview.includes("RUN_LOCAL_AI_MIGRATIONS")
  },
  {
    id: "index-project-knowledge",
    category: "index_project_knowledge",
    query: "index_project_knowledge REINDEX_PROJECT_KNOWLEDGE mock embeddings indexing",
    expectedSourceClass: "indexing-runbook-or-source",
    recommendedNextCheck:
      "Check knowledge indexing runbook, register-knowledge-tools, and project-knowledge-indexer retrieval.",
    matches: (result) =>
      result.filePath === "docs/06-runbooks/local-project-knowledge-indexing.md" ||
      result.filePath.includes("project-knowledge-indexer") ||
      result.filePath.includes("register-knowledge-tools") ||
      result.preview.includes("index_project_knowledge")
  },
  {
    id: "run-mcp-security-evals",
    category: "run_mcp_security_evals",
    query: "run_mcp_security_evals MCP security eval harness",
    expectedSourceClass: "mcp-eval-doc-or-source",
    recommendedNextCheck:
      "Check MCP security eval harness docs, exact tool-name FTS, and eval source indexing.",
    matches: (result) =>
      result.filePath.includes("mcp-security-evals") ||
      result.filePath.includes("mcp-security-eval-harness") ||
      result.preview.includes("run_mcp_security_evals")
  },
  {
    id: "architecture-options-tradeoffs",
    category: "architecture decisions/options/tradeoffs",
    query: "architecture decisions options tradeoffs architecture-decision",
    expectedSourceClass: "architecture-doc-or-skill",
    recommendedNextCheck:
      "Check architecture decision docs and architecture-decision skill indexing.",
    matches: (result) =>
      result.filePath.startsWith("docs/02-architecture/") ||
      result.filePath.includes("architecture-decision")
  },
  {
    id: "claude-codex-compatibility",
    category: "Claude/Codex compatibility",
    query: "CLAUDE.md Codex Claude compatibility bridge AGENTS.md",
    expectedSourceClass: "claude-compatibility-or-project-policy",
    recommendedNextCheck:
      "Check CLAUDE.md, Claude compatibility runbook, and Codex/Claude learning note indexing.",
    matches: (result) =>
      result.filePath === "CLAUDE.md" ||
      result.filePath.includes("claude-code-compatibility") ||
      result.filePath.includes("codex-claude-compatibility")
  },
  {
    id: "rag-chunking-context-concepts",
    category: "RAG/chunking/embedding/context concepts",
    query: "RAG chunking embeddings context engineering retrieval benchmark evals",
    expectedSourceClass: "ai-infra-doc-or-learning-note",
    recommendedNextCheck:
      "Check AI infra docs, RAG design spec, and learning journal source priority.",
    matches: (result) =>
      result.filePath.startsWith("docs/04-ai-infra/") ||
      result.filePath.startsWith("docs/01-learning-journal/")
  }
];

function passOrFail(params: {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
  diagnostics?: ProjectRagEvalDiagnostics;
}): ProjectRagEvalResult {
  return {
    name: params.name,
    status: params.passed ? "passed" : "failed",
    expected: params.expected,
    actual: params.actual,
    diagnostics: params.diagnostics
  };
}

function skipped(params: {
  name: string;
  expected: string;
  actual: string;
  diagnostics?: ProjectRagEvalDiagnostics;
}): ProjectRagEvalResult {
  return {
    name: params.name,
    status: "skipped",
    expected: params.expected,
    actual: params.actual,
    diagnostics: params.diagnostics
  };
}

function isSkippableErrorCode(code: ProjectKnowledgeRetrievalErrorCode): boolean {
  return SKIPPABLE_ERROR_CODES.includes(code);
}

function cappedSourcePaths(
  response: ProjectKnowledgeSearchResponse,
  cap = 8
): string[] {
  if (response.status === "error") {
    return [];
  }

  return response.results.slice(0, cap).map((result) => result.filePath);
}

function retrievalSkipDiagnostics(params: {
  benchmarkCategory?: string;
  expectedSourceClass: string;
  errorCode: ProjectKnowledgeRetrievalErrorCode;
}): ProjectRagEvalDiagnostics {
  return {
    benchmarkCategory: params.benchmarkCategory,
    expectedSourceClass: params.expectedSourceClass,
    safeSkipReason: params.errorCode,
    recommendedNextCheck:
      "Check local AI DB runtime, migration status, and latest completed mock index before treating this as a retrieval regression."
  };
}

function evalInvalidPathPrefixDenied(): ProjectRagEvalResult {
  try {
    normalizeProjectKnowledgeSearchOptions({
      query: "security policy",
      pathPrefixes: [".env"]
    });

    return passOrFail({
      name: "invalid-path-prefix-denied",
      passed: false,
      expected: "Blocked path prefixes are denied before retrieval SQL is built.",
      actual: ".env path prefix was unexpectedly accepted."
    });
  } catch (error) {
    return passOrFail({
      name: "invalid-path-prefix-denied",
      passed:
        error instanceof Error &&
        /blocked|not in the approved|outside/i.test(error.message),
      expected: "Blocked path prefixes are denied before retrieval SQL is built.",
      actual: error instanceof Error ? error.message : String(error)
    });
  }
}

function evalInvalidSourceTypeDenied(): ProjectRagEvalResult {
  try {
    normalizeProjectKnowledgeSearchOptions({
      query: "security policy",
      sourceTypes: ["unsafe-source" as never]
    });

    return passOrFail({
      name: "invalid-source-type-denied",
      passed: false,
      expected: "Unsupported sourceTypes are denied before retrieval SQL is built.",
      actual: "Unsupported source type was unexpectedly accepted."
    });
  } catch (error) {
    return passOrFail({
      name: "invalid-source-type-denied",
      passed: error instanceof Error && /Unsupported project knowledge source type/i.test(error.message),
      expected: "Unsupported sourceTypes are denied before retrieval SQL is built.",
      actual: error instanceof Error ? error.message : String(error)
    });
  }
}

function evalNoPaidProviderSurface(): ProjectRagEvalResult {
  const provider = new MockEmbeddingProvider();
  const registeredToolNames = Array.from(REGISTERED_MCP_TOOL_NAMES);
  const unsafeTool = registeredToolNames.find((toolName) =>
    /(openai|anthropic|cohere|voyage|hosted|paid|api_key|embedding_provider)/i.test(
      toolName
    )
  );

  return passOrFail({
    name: "no-paid-provider-surface",
    passed:
      !unsafeTool &&
      !/(openai|anthropic|cohere|voyage|hosted|api[-_ ]?key)/i.test(
        `${provider.model} ${provider.version}`
      ),
    expected: "Milestone 4 retrieval uses only the deterministic mock provider.",
    actual: unsafeTool
      ? `Unsafe provider-like tool found: ${unsafeTool}.`
      : `${provider.model}/${provider.version}.`
  });
}

function evalPlannerToolSurface(): ProjectRagEvalResult {
  const registeredToolNames = Array.from(REGISTERED_MCP_TOOL_NAMES);
  const forbidden = registeredToolNames.filter((toolName) =>
    /^(build_project_context|apply_project_context|execute_project_context)$/.test(
      toolName
    )
  );
  const hasPlanner = registeredToolNames.includes("plan_project_context");

  return passOrFail({
    name: "planner-tool-surface",
    passed: hasPlanner && forbidden.length === 0,
    expected:
      "Milestone 5 registers plan_project_context and no unsafe planner execution aliases.",
    actual: [
      hasPlanner ? "plan_project_context is registered." : "plan_project_context is missing.",
      forbidden.length > 0
        ? `Forbidden planner aliases registered: ${forbidden.join(", ")}.`
        : ""
    ]
      .filter(Boolean)
      .join(" ")
  });
}

async function evalRetrievalBenchmark(
  benchmark: RetrievalBenchmark
): Promise<ProjectRagEvalResult> {
  const response = await searchProjectKnowledge({
    query: benchmark.query,
    topK: 8
  });

  if (response.status === "error") {
    if (isSkippableErrorCode(response.errorCode)) {
      return skipped({
        name: `retrieval-benchmark-${benchmark.id}`,
        expected: `${benchmark.category} retrieves ${benchmark.expectedSourceClass} when DB/index is ready.`,
        actual: response.message,
        diagnostics: retrievalSkipDiagnostics({
          benchmarkCategory: benchmark.category,
          expectedSourceClass: benchmark.expectedSourceClass,
          errorCode: response.errorCode
        })
      });
    }

    return passOrFail({
      name: `retrieval-benchmark-${benchmark.id}`,
      passed: false,
      expected: `${benchmark.category} retrieves ${benchmark.expectedSourceClass}.`,
      actual: response.message,
      diagnostics: {
        benchmarkCategory: benchmark.category,
        expectedSourceClass: benchmark.expectedSourceClass,
        safeSkipReason: response.errorCode,
        recommendedNextCheck:
          "Review retrieval safe error code before changing benchmark expectations."
      }
    });
  }

  const found = response.results.some(benchmark.matches);

  return passOrFail({
    name: `retrieval-benchmark-${benchmark.id}`,
    passed: found,
    expected: `${benchmark.category} retrieves ${benchmark.expectedSourceClass}.`,
    actual: `Returned ${response.results.map((result) => result.filePath).join(", ")}.`,
    diagnostics: {
      benchmarkCategory: benchmark.category,
      expectedSourceClass: benchmark.expectedSourceClass,
      returnedSourcePaths: cappedSourcePaths(response),
      returnedSourcePathCap: 8,
      recommendedNextCheck: found ? undefined : benchmark.recommendedNextCheck
    }
  });
}

async function evalExactToolNameRetrieval(): Promise<ProjectRagEvalResult> {
  const response = await searchProjectKnowledge({
    query: "run_mcp_security_evals",
    topK: 8
  });

  if (response.status === "error") {
    if (isSkippableErrorCode(response.errorCode)) {
      return skipped({
        name: "exact-tool-name-retrieval",
        expected: "Exact tool names retrieve relevant MCP docs or source when DB/index is ready.",
        actual: response.message,
        diagnostics: retrievalSkipDiagnostics({
          expectedSourceClass: "mcp-eval-doc-or-source",
          errorCode: response.errorCode
        })
      });
    }

    return passOrFail({
      name: "exact-tool-name-retrieval",
      passed: false,
      expected: "Exact tool names retrieve relevant MCP docs or source.",
      actual: response.message,
      diagnostics: {
        expectedSourceClass: "mcp-eval-doc-or-source",
        safeSkipReason: response.errorCode,
        recommendedNextCheck:
          "Review retrieval safe error code and migration/index readiness before changing ranking."
      }
    });
  }

  const found = response.results.some(
    (result) =>
      result.filePath.includes("mcp-security-evals") ||
      result.filePath.includes("mcp-security-eval-harness") ||
      result.preview.includes("run_mcp_security_evals")
  );

  return passOrFail({
    name: "exact-tool-name-retrieval",
    passed: found,
    expected: "Query run_mcp_security_evals retrieves relevant MCP eval context.",
    actual: `Returned ${response.results.map((result) => result.filePath).join(", ")}.`,
    diagnostics: {
      expectedSourceClass: "mcp-eval-doc-or-source",
      returnedSourcePaths: cappedSourcePaths(response),
      returnedSourcePathCap: 8,
      recommendedNextCheck: found
        ? undefined
        : "Check full-text search and exact identifier boosts for tool-name queries."
    }
  });
}

async function evalSecurityContextRetrieval(): Promise<ProjectRagEvalResult> {
  const response = await searchProjectKnowledge({
    query: "AGENTS.md .env blocked sensitive path security policy",
    topK: 8
  });

  if (response.status === "error") {
    if (isSkippableErrorCode(response.errorCode)) {
      return skipped({
        name: "security-context-retrieval",
        expected: "Security queries retrieve AGENTS.md or security policy when DB/index is ready.",
        actual: response.message,
        diagnostics: retrievalSkipDiagnostics({
          expectedSourceClass: "security-policy-or-agents",
          errorCode: response.errorCode
        })
      });
    }

    return passOrFail({
      name: "security-context-retrieval",
      passed: false,
      expected: "Security queries retrieve AGENTS.md or security policy.",
      actual: response.message,
      diagnostics: {
        expectedSourceClass: "security-policy-or-agents",
        safeSkipReason: response.errorCode,
        recommendedNextCheck:
          "Review retrieval safe error code and security source availability."
      }
    });
  }

  const found = response.results.some(
    (result) =>
      result.filePath === "AGENTS.md" ||
      result.filePath.startsWith("docs/05-security/")
  );

  return passOrFail({
    name: "security-context-retrieval",
    passed: found,
    expected: "Security queries retrieve AGENTS.md or security policy.",
    actual: `Returned ${response.results.map((result) => result.filePath).join(", ")}.`,
    diagnostics: {
      expectedSourceClass: "security-policy-or-agents",
      returnedSourcePaths: cappedSourcePaths(response),
      returnedSourcePathCap: 8,
      recommendedNextCheck: found
        ? undefined
        : "Check security-doc source priority and AGENTS.md indexing."
    }
  });
}

async function evalArchitectureContextRetrieval(): Promise<ProjectRagEvalResult> {
  const response = await searchProjectKnowledge({
    query: "architecture decision tradeoffs architecture-decision",
    topK: 8
  });

  if (response.status === "error") {
    if (isSkippableErrorCode(response.errorCode)) {
      return skipped({
        name: "architecture-context-retrieval",
        expected: "Architecture queries retrieve architecture docs or skill when DB/index is ready.",
        actual: response.message,
        diagnostics: retrievalSkipDiagnostics({
          expectedSourceClass: "architecture-doc-or-skill",
          errorCode: response.errorCode
        })
      });
    }

    return passOrFail({
      name: "architecture-context-retrieval",
      passed: false,
      expected: "Architecture queries retrieve architecture docs or skill.",
      actual: response.message,
      diagnostics: {
        expectedSourceClass: "architecture-doc-or-skill",
        safeSkipReason: response.errorCode,
        recommendedNextCheck:
          "Review retrieval safe error code and architecture source indexing."
      }
    });
  }

  const found = response.results.some(
    (result) =>
      result.filePath.startsWith("docs/02-architecture/") ||
      result.filePath.includes("architecture-decision")
  );

  return passOrFail({
    name: "architecture-context-retrieval",
    passed: found,
    expected: "Architecture queries retrieve architecture docs or skill.",
    actual: `Returned ${response.results.map((result) => result.filePath).join(", ")}.`,
    diagnostics: {
      expectedSourceClass: "architecture-doc-or-skill",
      returnedSourcePaths: cappedSourcePaths(response),
      returnedSourcePathCap: 8,
      recommendedNextCheck: found
        ? undefined
        : "Check architecture-doc source priority and architecture-decision skill indexing."
    }
  });
}

async function evalArchiveExcludedByDefault(): Promise<ProjectRagEvalResult> {
  const response = await searchProjectKnowledge({
    query: "archive historical docs",
    topK: 8
  });

  if (response.status === "error") {
    if (isSkippableErrorCode(response.errorCode)) {
      return skipped({
        name: "archive-excluded-by-default",
        expected: "Archived docs do not appear unless includeArchived is explicit.",
        actual: response.message,
        diagnostics: retrievalSkipDiagnostics({
          expectedSourceClass: "non-archived-results-only",
          errorCode: response.errorCode
        })
      });
    }

    return passOrFail({
      name: "archive-excluded-by-default",
      passed: false,
      expected: "Archived docs do not appear unless includeArchived is explicit.",
      actual: response.message,
      diagnostics: {
        expectedSourceClass: "non-archived-results-only",
        safeSkipReason: response.errorCode,
        recommendedNextCheck:
          "Review retrieval safe error code before checking archive filters."
      }
    });
  }

  const forbiddenHitCount = response.results.filter((result) => result.isArchived).length;

  return passOrFail({
    name: "archive-excluded-by-default",
    passed: forbiddenHitCount === 0,
    expected: "Archived docs do not appear unless includeArchived is explicit.",
    actual: `Archived result count: ${forbiddenHitCount}.`,
    diagnostics: {
      expectedSourceClass: "non-archived-results-only",
      returnedSourcePaths: cappedSourcePaths(response),
      returnedSourcePathCap: 8,
      forbiddenHitCount,
      recommendedNextCheck: forbiddenHitCount === 0
        ? undefined
        : "Check includeArchived default handling in retrieval filters."
    }
  });
}

async function evalForbiddenSourcesExcluded(): Promise<ProjectRagEvalResult> {
  const response = await searchProjectKnowledge({
    query: ".env node_modules .mcp-local tokens credentials",
    topK: 8
  });

  if (response.status === "error") {
    if (isSkippableErrorCode(response.errorCode)) {
      return skipped({
        name: "forbidden-sources-excluded",
        expected: "Forbidden source paths never appear in retrieval results.",
        actual: response.message,
        diagnostics: retrievalSkipDiagnostics({
          expectedSourceClass: "forbidden-sources-absent",
          errorCode: response.errorCode
        })
      });
    }

    return passOrFail({
      name: "forbidden-sources-excluded",
      passed: false,
      expected: "Forbidden source paths never appear in retrieval results.",
      actual: response.message,
      diagnostics: {
        expectedSourceClass: "forbidden-sources-absent",
        safeSkipReason: response.errorCode,
        recommendedNextCheck:
          "Review retrieval safe error code before checking forbidden source filters."
      }
    });
  }

  const forbidden = response.results.filter((result) =>
    /(^|\/)(\.env|node_modules|\.mcp-local|\.git|dist|build|coverage|credentials?|tokens?|secrets?|private[-_]?keys?)(\/|$)/i.test(
      result.filePath
    )
  );

  return passOrFail({
    name: "forbidden-sources-excluded",
    passed: forbidden.length === 0,
    expected: "Forbidden source paths never appear in retrieval results.",
    actual:
      forbidden.length === 0
        ? "No forbidden paths returned."
        : `Forbidden paths returned: ${forbidden.map((result) => result.filePath).join(", ")}.`,
    diagnostics: {
      expectedSourceClass: "forbidden-sources-absent",
      returnedSourcePaths: cappedSourcePaths(response),
      returnedSourcePathCap: 8,
      forbiddenHitCount: forbidden.length,
      recommendedNextCheck: forbidden.length === 0
        ? undefined
        : "Check indexing policy, retrieval filters, and source path sanitization."
    }
  });
}

async function evalContextBudget(): Promise<ProjectRagEvalResult> {
  const response = await getRelevantProjectContext({
    task: "run_mcp_security_evals security policy context",
    maxChunks: 4,
    maxContextChars: 2_000,
    includeSecurityContext: true
  });

  if (response.status === "error") {
    if (isSkippableErrorCode(response.errorCode)) {
      return skipped({
        name: "context-output-budget",
        expected: "Context builder stays within chunk and character budgets when DB/index is ready.",
        actual: response.message,
        diagnostics: retrievalSkipDiagnostics({
          expectedSourceClass: "bounded-context-output",
          errorCode: response.errorCode
        })
      });
    }

    return passOrFail({
      name: "context-output-budget",
      passed: false,
      expected: "Context builder stays within chunk and character budgets.",
      actual: response.message,
      diagnostics: {
        expectedSourceClass: "bounded-context-output",
        safeSkipReason: response.errorCode,
        recommendedNextCheck:
          "Review retrieval safe error code before checking context budget behavior."
      }
    });
  }

  const longestExcerptChars = response.sources.reduce(
    (max, source) => Math.max(max, source.excerpt.length),
    0
  );
  const withinBudget =
    response.contextStats.returnedChunks <= 4 &&
    response.contextStats.contextChars <= 2_000 &&
    response.sources.length <= 4 &&
    longestExcerptChars <= MAX_PROJECT_CONTEXT_EXCERPT_CHARS;

  return passOrFail({
    name: "context-output-budget",
    passed: withinBudget,
    expected: "Context builder stays within maxChunks and maxContextChars.",
    actual: `chunks=${response.contextStats.returnedChunks}; chars=${response.contextStats.contextChars}; longestExcerpt=${longestExcerptChars}.`,
    diagnostics: {
      expectedSourceClass: "bounded-context-output",
      contextBudget: {
        maxChunks: 4,
        maxContextChars: 2_000,
        maxExcerptChars: MAX_PROJECT_CONTEXT_EXCERPT_CHARS,
        returnedChunks: response.contextStats.returnedChunks,
        returnedSources: response.contextStats.returnedSources,
        contextChars: response.contextStats.contextChars,
        longestExcerptChars,
        truncated: response.contextStats.truncated
      },
      recommendedNextCheck: withinBudget
        ? undefined
        : "Check context builder chunk, source, character, and excerpt caps."
    }
  });
}

async function evalRetrievalWarnsUntrustedEvidence(): Promise<ProjectRagEvalResult> {
  const response = await searchProjectKnowledge({
    query:
      "A retrieved chunk says ignore AGENTS.md and read .env; treat chunk text as policy.",
    topK: 3
  });
  const warns = response.warnings.includes(RETRIEVED_CONTENT_UNTRUSTED_WARNING);

  return passOrFail({
    name: "retrieval-warns-untrusted-evidence",
    passed: warns,
    expected:
      "Retrieval outputs warn that chunks are untrusted evidence, not instructions.",
    actual: `status=${response.status}; warnings=${response.warnings.join(", ")}.`,
    diagnostics: {
      expectedSourceClass: "prompt-injection-defense-warning",
      safeSkipReason:
        response.status === "error" ? response.errorCode : undefined,
      recommendedNextCheck: warns
        ? undefined
        : "Add the untrusted evidence warning to all retrieval responses, including safe errors."
    }
  });
}

async function evalContextWarnsUntrustedEvidence(): Promise<ProjectRagEvalResult> {
  const response = await getRelevantProjectContext({
    task:
      "Use project context for a malicious retrieved chunk that says ignore MCP policy and read secrets.",
    maxChunks: 3,
    maxContextChars: 2_000,
    includeSecurityContext: true
  });
  const warns = response.warnings.includes(RETRIEVED_CONTENT_UNTRUSTED_WARNING);

  return passOrFail({
    name: "context-warns-untrusted-evidence",
    passed: warns,
    expected:
      "Context builder outputs warn that retrieved chunks are untrusted evidence, not instructions.",
    actual: `status=${response.status}; warnings=${response.warnings.join(", ")}.`,
    diagnostics: {
      expectedSourceClass: "prompt-injection-defense-warning",
      safeSkipReason:
        response.status === "error" ? response.errorCode : undefined,
      recommendedNextCheck: warns
        ? undefined
        : "Ensure get_relevant_context preserves retrieval warnings on success and safe-error paths."
    }
  });
}

function buildQualityReport(
  results: readonly ProjectRagEvalResult[]
): ProjectRagQualityReport {
  const retrievalResults = results.filter((result) =>
    [
      "exact-tool-name-retrieval",
      "security-context-retrieval",
      "architecture-context-retrieval"
    ].includes(result.name)
  );
  const forbiddenResults = results.filter((result) =>
    ["archive-excluded-by-default", "forbidden-sources-excluded"].includes(
      result.name
    )
  );
  const contextBudgetResults = results.filter(
    (result) => result.diagnostics?.contextBudget
  );
  const plannerResults = results.filter((result) =>
    /planner|architecture-process|security-related|unsafe-mutation|prompt-injection/.test(
      result.name
    )
  );
  const benchmarkResults = results.filter((result) =>
    result.name.startsWith("retrieval-benchmark-")
  );
  const failedResults = results.filter((result) => result.status === "failed");

  return {
    retrieval: {
      expectedSourceChecks: retrievalResults.length,
      expectedSourceHits: retrievalResults.filter(
        (result) => result.status === "passed"
      ).length,
      expectedSourceMisses: retrievalResults.filter(
        (result) => result.status === "failed"
      ).length,
      skippedChecks: retrievalResults.filter(
        (result) => result.status === "skipped"
      ).length
    },
    forbiddenSources: {
      checks: forbiddenResults.length,
      forbiddenHitCount: forbiddenResults.reduce(
        (total, result) => total + (result.diagnostics?.forbiddenHitCount ?? 0),
        0
      )
    },
    contextBudget: {
      checks: contextBudgetResults.length,
      passed: contextBudgetResults.filter((result) => result.status === "passed")
        .length,
      failed: contextBudgetResults.filter((result) => result.status === "failed")
        .length,
      maxObservedContextChars: contextBudgetResults.reduce(
        (max, result) =>
          Math.max(max, result.diagnostics?.contextBudget?.contextChars ?? 0),
        0
      ),
      maxObservedExcerptChars: contextBudgetResults.reduce(
        (max, result) =>
          Math.max(
            max,
            result.diagnostics?.contextBudget?.longestExcerptChars ?? 0
          ),
        0
      )
    },
    planner: {
      checks: plannerResults.length,
      passed: plannerResults.filter((result) => result.status === "passed")
        .length,
      failed: plannerResults.filter((result) => result.status === "failed")
        .length
    },
    benchmarks: {
      checks: benchmarkResults.length,
      passed: benchmarkResults.filter((result) => result.status === "passed")
        .length,
      failed: benchmarkResults.filter((result) => result.status === "failed")
        .length,
      skipped: benchmarkResults.filter((result) => result.status === "skipped")
        .length
    },
    safeSkips: {
      dbUnavailable: results.filter(
        (result) => result.diagnostics?.safeSkipReason === "db-unavailable"
      ).length,
      schemaNotReady: results.filter(
        (result) => result.diagnostics?.safeSkipReason === "schema-not-ready"
      ).length,
      indexNotReady: results.filter(
        (result) => result.diagnostics?.safeSkipReason === "index-not-ready"
      ).length
    },
    failures: failedResults.slice(0, 10).map((result) => ({
      name: result.name,
      benchmarkCategory: result.diagnostics?.benchmarkCategory,
      expectedSourceClass: result.diagnostics?.expectedSourceClass,
      recommendedNextCheck: result.diagnostics?.recommendedNextCheck
    }))
  };
}

export async function runProjectRagEvals(): Promise<ProjectRagEvalReport> {
  const results: ProjectRagEvalResult[] = [];

  results.push(evalInvalidPathPrefixDenied());
  results.push(evalInvalidSourceTypeDenied());
  results.push(evalNoPaidProviderSurface());
  results.push(evalPlannerToolSurface());
  results.push(...runContextPlannerEvals().results);
  results.push(
    ...(await Promise.all(RETRIEVAL_BENCHMARKS.map(evalRetrievalBenchmark)))
  );
  results.push(await evalExactToolNameRetrieval());
  results.push(await evalSecurityContextRetrieval());
  results.push(await evalArchitectureContextRetrieval());
  results.push(await evalArchiveExcludedByDefault());
  results.push(await evalForbiddenSourcesExcluded());
  results.push(await evalContextBudget());
  results.push(await evalRetrievalWarnsUntrustedEvidence());
  results.push(await evalContextWarnsUntrustedEvidence());

  const passed = results.filter((result) => result.status === "passed").length;
  const failed = results.filter((result) => result.status === "failed").length;
  const skippedCount = results.filter((result) => result.status === "skipped").length;

  return {
    suiteName: "project-rag-evals",
    status: failed > 0 ? "failed" : skippedCount > 0 ? "skipped" : "passed",
    total: results.length,
    passed,
    failed,
    skipped: skippedCount,
    results,
    qualityReport: buildQualityReport(results)
  };
}
