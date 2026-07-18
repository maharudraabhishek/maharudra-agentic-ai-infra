import fs from "node:fs/promises";
import { assertAllowedPnpmScript } from "../security/command-policy.js";
import {
  assertAllowedExtension,
  assertWritableProjectFile,
  normalizeProjectPath
} from "../security/path-policy.js";
import { safeListDirectory, safeReadTextFile } from "../services/file-read-service.js";
import { createNewFileProposal } from "../services/new-file-service.js";
import { applyApprovedPatch } from "../services/patch-service.js";
import { assertRunLocalAiMigrationsApprovalText } from "../db/local-ai-migrations.js";
import {
  readAppLogSummary,
  readAuditSummary,
  sanitizeSummaryEvent
} from "../observability/summaries.js";
import { REGISTERED_MCP_TOOL_NAMES } from "../tools/tool-names.js";
import { isIndexableProjectPath } from "../knowledge/indexing/indexing-policy.js";
import { assertProjectKnowledgeReindexApprovalText } from "../knowledge/indexing/project-knowledge-indexer.js";
import {
  PROJECT_CONTEXT_PLANNER_ALLOWED_RECOMMENDED_TOOLS,
  planProjectContext
} from "../knowledge/planning/context-planner.js";

type EvalStatus = "passed" | "failed";
type EvalRisk = "critical" | "high" | "medium" | "low";

export type McpSecurityEvalResult = {
  name: string;
  status: EvalStatus;
  expected: string;
  actual: string;
  risk: EvalRisk;
};

export type McpSecurityEvalReport = {
  suiteName: "mcp-security-evals";
  status: EvalStatus;
  startedAt: string;
  completedAt: string;
  total: number;
  passed: number;
  failed: number;
  results: McpSecurityEvalResult[];
};

const EVAL_TEMP_FILE = "docs/mcp-security-eval-temp.md";
const EVAL_TEMP_CONTENT = [
  "# MCP Security Eval Temp",
  "",
  "This harmless file is used by `run_mcp_security_evals`.",
  "It must never contain secrets or production data.",
  ""
].join("\n");

const FORBIDDEN_SUMMARY_KEYS = new Set([
  "content",
  "originaltext",
  "replacementtext",
  "stdout",
  "stderr",
  "rawproposal",
  "rawpatch",
  "filecontent",
  "text",
  "commandoutput",
  "fullcontent",
  "patchbody",
  "query",
  "task",
  "context",
  "chunk",
  "embedding",
  "vector",
  "sql",
  "approvaltext"
]);

const FORBIDDEN_RAW_VALUE_SNIPPETS = [
  "unsafe original text body",
  "unsafe replacement text body",
  "unsafe raw content body",
  "unsafe stdout body",
  "unsafe stderr body",
  "unsafe patch body",
  "unsafe query body",
  "unsafe task body",
  "unsafe context body",
  "unsafe chunk body",
  "unsafe vector body",
  "unsafe sql body",
  "unsafe approval body"
];

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isExpectedDenial(message: string): boolean {
  return /access denied|denied|must exactly equal|not allowlisted/i.test(message);
}

async function expectDenied(params: {
  name: string;
  expected: string;
  risk: EvalRisk;
  run: () => Promise<void> | void;
}): Promise<McpSecurityEvalResult> {
  try {
    await params.run();

    return {
      name: params.name,
      status: "failed",
      expected: params.expected,
      actual: "Operation unexpectedly succeeded.",
      risk: params.risk
    };
  } catch (error) {
    const actual = messageFromError(error);

    return {
      name: params.name,
      status: isExpectedDenial(actual) ? "passed" : "failed",
      expected: params.expected,
      actual,
      risk: params.risk
    };
  }
}

async function expectAllDenied(params: {
  name: string;
  expected: string;
  risk: EvalRisk;
  runs: Array<() => Promise<void> | void>;
}): Promise<McpSecurityEvalResult> {
  const actualMessages: string[] = [];

  for (const run of params.runs) {
    const result = await expectDenied({
      name: params.name,
      expected: params.expected,
      risk: params.risk,
      run
    });

    actualMessages.push(result.actual);

    if (result.status === "failed") {
      return {
        ...result,
        actual: actualMessages.join(" | ")
      };
    }
  }

  return {
    name: params.name,
    status: "passed",
    expected: params.expected,
    actual: actualMessages.join(" | "),
    risk: params.risk
  };
}

async function ensureEvalTempFile(): Promise<void> {
  const { fullPath } = assertWritableProjectFile(EVAL_TEMP_FILE);

  try {
    const stat = await fs.stat(fullPath);

    if (!stat.isFile()) {
      throw new Error("Eval temp path exists but is not a file.");
    }

    if (stat.size > 0) {
      return;
    }
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;

    if (nodeError.code !== "ENOENT") {
      throw error;
    }
  }

  /**
   * The eval harness needs one existing harmless file to exercise overwrite
   * protection. It never creates secrets, never deletes files, and writes only
   * to this documented markdown temp path.
   */
  await fs.writeFile(fullPath, EVAL_TEMP_CONTENT, "utf8");
}

function findForbiddenSummaryKeys(value: unknown, path: string): string[] {
  if (value === null || typeof value !== "object") {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findForbiddenSummaryKeys(item, `${path}[${index}]`)
    );
  }

  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, child]) => {
      const currentPath = `${path}.${key}`;
      const matches = FORBIDDEN_SUMMARY_KEYS.has(key.toLowerCase())
        ? [currentPath]
        : [];

      return [...matches, ...findForbiddenSummaryKeys(child, currentPath)];
    }
  );
}

function findForbiddenSummaryValues(value: unknown, path: string): string[] {
  if (typeof value === "string") {
    return FORBIDDEN_RAW_VALUE_SNIPPETS.flatMap((snippet) =>
      value.includes(snippet) ? [`${path} contains ${snippet}`] : []
    );
  }

  if (value === null || typeof value !== "object") {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findForbiddenSummaryValues(item, `${path}[${index}]`)
    );
  }

  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, child]) => findForbiddenSummaryValues(child, `${path}.${key}`)
  );
}

function createUnsafeLegacySummaryFixtures(): Array<{
  name: string;
  events: unknown[];
}> {
  return [
    {
      name: "legacy-audit-summary-fixture",
      events: [
        sanitizeSummaryEvent({
          timestamp: "2026-05-09T00:00:00.000Z",
          toolName: "propose_file_patch",
          operationType: "patch_proposal",
          status: "attempt",
          metadata: {
            filePath: "docs/example.md",
            originalText: "unsafe original text body",
            replacementText: "unsafe replacement text body",
            content: "unsafe raw content body",
            rawPatch: "unsafe patch body"
          }
        })
      ]
    },
    {
      name: "legacy-app-log-summary-fixture",
      events: [
        sanitizeSummaryEvent({
          timestamp: "2026-05-09T00:00:00.000Z",
          toolName: "run_allowed_pnpm_script",
          operationType: "command",
          status: "error",
          metadata: {
            packageName: "rudraloka-dev-mcp",
            script: "test",
            stdout: "unsafe stdout body",
            stderr: "unsafe stderr body",
            commandOutput: "unsafe stdout body"
          }
        })
      ]
    },
    {
      name: "knowledge-observability-summary-fixture",
      events: [
        sanitizeSummaryEvent({
          timestamp: "2026-05-09T00:00:00.000Z",
          toolName: "search_project_knowledge",
          operationType: "db",
          status: "attempt",
          metadata: {
            query: "unsafe query body",
            task: "unsafe task body",
            context: "unsafe context body",
            chunk: "unsafe chunk body",
            embedding: "unsafe vector body",
            vector: "unsafe vector body",
            sql: "unsafe sql body",
            approvalText: "unsafe approval body",
            querySha256:
              "9b01958c4dd8d7d6c00c4708c4fd10b7a756f23a888d2ff64896d3e27e71eed1",
            queryLength: 17,
            resultCount: 2
          }
        })
      ]
    }
  ];
}

function findForbiddenSummaryPayloads(summaries: Array<{
  name: string;
  events: unknown[];
}>): string[] {
  return summaries.flatMap((summary) =>
    summary.events.flatMap((event, index) => [
      ...findForbiddenSummaryKeys(event, `${summary.name}.events[${index}]`),
      ...findForbiddenSummaryValues(event, `${summary.name}.events[${index}]`)
    ])
  );
}

async function runSecretFileBlockingEval(): Promise<McpSecurityEvalResult> {
  return expectDenied({
    name: "secret-file-blocking",
    expected: "Access denied before any .env file content is read.",
    risk: "critical",
    run: async () => {
      await safeReadTextFile(".env");
    }
  });
}

async function runPathTraversalBlockingEval(): Promise<McpSecurityEvalResult> {
  return expectAllDenied({
    name: "path-traversal-blocking",
    expected: "Access denied because the requested path escapes project root.",
    risk: "critical",
    runs: [
      async () => {
        await safeReadTextFile("../../.env");
      },
      async () => {
        await safeReadTextFile("../outside.md");
      }
    ]
  });
}

async function runBlockedDirectoryListingEval(): Promise<McpSecurityEvalResult> {
  return expectAllDenied({
    name: "blocked-directory-listing",
    expected:
      "Access denied because generated dependency/cache directories are blocked.",
    risk: "high",
    runs: [
      async () => {
        await safeListDirectory("node_modules");
      },
      async () => {
        await safeListDirectory(".pnpm-store");
      }
    ]
  });
}

async function runUnknownExtensionBlockingEval(): Promise<McpSecurityEvalResult> {
  return expectDenied({
    name: "unknown-extension-blocking",
    expected: "Access denied by extension policy before file contents are read.",
    risk: "high",
    run: () => {
      const fullPath = normalizeProjectPath("docs/mcp-security-eval-temp.exe");
      assertAllowedExtension(fullPath);
    }
  });
}

async function runCommandAllowlistBlockingEval(): Promise<McpSecurityEvalResult> {
  return expectAllDenied({
    name: "command-allowlist-blocking",
    expected: "Access denied for unknown package and unknown script.",
    risk: "critical",
    runs: [
      () => {
        assertAllowedPnpmScript({
          packageName: "unknown-package",
          script: "typecheck"
        });
      },
      () => {
        assertAllowedPnpmScript({
          packageName: "rudraloka-dev-mcp",
          script: "dev"
        });
      }
    ]
  });
}

async function runNoArbitrarySqlToolEval(): Promise<McpSecurityEvalResult> {
  const unsafeToolNamePattern =
    /(^|_)(execute_sql|raw_sql|sql|query|sql_query)($|_)/i;
  const requiredDbTools = [
    "check_local_ai_db",
    "get_local_ai_migration_status",
    "run_local_ai_migrations"
  ];
  const registeredToolNames: string[] = Array.from(REGISTERED_MCP_TOOL_NAMES);
  const missingDbTools = requiredDbTools.filter(
    (toolName) => !registeredToolNames.includes(toolName)
  );
  const unsafeSqlToolNames = registeredToolNames.filter((toolName) =>
    unsafeToolNamePattern.test(toolName)
  );
  const passed =
    missingDbTools.length === 0 && unsafeSqlToolNames.length === 0;

  return {
    name: "no-arbitrary-sql-tool-registered",
    status: passed ? "passed" : "failed",
    expected:
      "Only fixed-purpose local AI DB tools are listed; no arbitrary SQL/query tool is registered.",
    actual: passed
      ? "Registered DB tools are fixed-purpose health, status, and migration tools only."
      : [
          missingDbTools.length > 0
            ? `Missing DB tools: ${missingDbTools.join(", ")}.`
            : "",
          unsafeSqlToolNames.length > 0
            ? `Unsafe SQL-like tools found: ${unsafeSqlToolNames.join(", ")}.`
            : ""
        ]
          .filter(Boolean)
          .join(" "),
    risk: "critical"
  };
}

async function runKnowledgeToolsMilestone5SurfaceEval(): Promise<McpSecurityEvalResult> {
  const registeredToolNames: string[] = Array.from(REGISTERED_MCP_TOOL_NAMES);
  const requiredKnowledgeTools = [
    "preview_project_knowledge_scan",
    "preview_project_chunks",
    "run_knowledge_pipeline_evals",
    "index_project_knowledge",
    "get_project_knowledge_index_status",
    "search_project_knowledge",
    "get_relevant_context",
    "run_project_rag_evals",
    "plan_project_context"
  ];
  const forbiddenMilestone5ToolPattern =
    /^(build_project_context|apply_project_context|execute_project_context)$/;
  const missingTools = requiredKnowledgeTools.filter(
    (toolName) => !registeredToolNames.includes(toolName)
  );
  const forbiddenTools = registeredToolNames.filter((toolName) =>
    forbiddenMilestone5ToolPattern.test(toolName)
  );
  const passed = missingTools.length === 0 && forbiddenTools.length === 0;

  return {
    name: "knowledge-tools-milestone5-safe-surface",
    status: passed ? "passed" : "failed",
    expected:
      "Milestone 5 exposes preview, manual indexing, safe status, retrieval, context, RAG eval, and advisory planner tools, but no planner execution aliases.",
    actual: passed
      ? "Milestone 5 knowledge tool surface contains context planner tooling and no planner execution aliases."
      : [
          missingTools.length > 0
            ? `Missing knowledge tools: ${missingTools.join(", ")}.`
            : "",
          forbiddenTools.length > 0
            ? `Forbidden planner aliases registered: ${forbiddenTools.join(", ")}.`
            : ""
        ]
          .filter(Boolean)
          .join(" "),
    risk: "high"
  };
}

async function runContextPlannerRecommendationSafetyEval(): Promise<McpSecurityEvalResult> {
  const allowedTools = new Set<string>(
    PROJECT_CONTEXT_PLANNER_ALLOWED_RECOMMENDED_TOOLS
  );
  const unsafeToolNames = new Set([
    "apply_approved_patch",
    "apply_approved_new_file",
    "run_local_ai_migrations",
    "run_allowed_pnpm_script",
    "index_project_knowledge"
  ]);
  const unsafePattern =
    /(apply|approved|migration|command|pnpm|index_project_knowledge|sql|patch|new_file|write|delete|mutate|execute)/i;
  const plan = planProjectContext({
    task:
      "Apply patches, run migrations, execute arbitrary SQL, index project knowledge, and run commands for MCP security.",
    mode: "implementation"
  });
  const disallowed = plan.recommendedTools.filter(
    (tool) =>
      !allowedTools.has(tool) ||
      unsafeToolNames.has(tool) ||
      unsafePattern.test(tool)
  );

  return {
    name: "context-planner-recommendation-safety",
    status: disallowed.length === 0 ? "passed" : "failed",
    expected:
      "plan_project_context recommendations stay on the safe allowlist and never include mutation/action tools.",
    actual:
      disallowed.length === 0
        ? `Recommended tools are safe: ${plan.recommendedTools.join(", ")}.`
        : `Unsafe recommendations found: ${disallowed.join(", ")}.`,
    risk: "critical"
  };
}

async function runNoPaidEmbeddingProviderToolEval(): Promise<McpSecurityEvalResult> {
  const registeredToolNames: string[] = Array.from(REGISTERED_MCP_TOOL_NAMES);
  const paidProviderPattern =
    /(openai|anthropic|cohere|voyage|hosted|paid|api_key|embedding_provider)/i;
  const unsafeTools = registeredToolNames.filter((toolName) =>
    paidProviderPattern.test(toolName)
  );

  return {
    name: "no-paid-embedding-provider-tool-registered",
    status: unsafeTools.length === 0 ? "passed" : "failed",
    expected:
      "Milestone 4 registers no paid or hosted embedding provider tool.",
    actual:
      unsafeTools.length === 0
        ? "No paid/hosted embedding provider tool names are registered."
        : `Unsafe provider-like tools found: ${unsafeTools.join(", ")}.`,
    risk: "critical"
  };
}

async function runKnowledgeSecretIndexingBlockingEval(): Promise<McpSecurityEvalResult> {
  const envResult = isIndexableProjectPath(".env");
  const nodeModulesResult = isIndexableProjectPath("node_modules/example.md");
  const passed = !envResult.indexable && !nodeModulesResult.indexable;

  return {
    name: "knowledge-secret-and-generated-source-blocking",
    status: passed ? "passed" : "failed",
    expected:
      "Knowledge indexing policy denies .env files and generated dependency folders.",
    actual: passed
      ? `Denied .env as ${envResult.skipReason}; denied node_modules as ${nodeModulesResult.skipReason}.`
      : "At least one forbidden knowledge source was unexpectedly indexable.",
    risk: "critical"
  };
}

async function runKnowledgeArchiveDefaultExclusionEval(): Promise<McpSecurityEvalResult> {
  const result = isIndexableProjectPath("docs/99-archive/example.md");

  return {
    name: "knowledge-archive-excluded-by-default",
    status: !result.indexable && result.skipReason === "archive-excluded"
      ? "passed"
      : "failed",
    expected:
      "Knowledge indexing policy excludes docs/99-archive unless archive inclusion is explicit.",
    actual: result.indexable
      ? "Archive path was unexpectedly indexable by default."
      : `Archive path skipped with reason ${result.skipReason ?? "unknown"}.`,
    risk: "medium"
  };
}

async function runDbMigrationApprovalEnforcementEval(): Promise<McpSecurityEvalResult> {
  return expectDenied({
    name: "db-migration-approval-enforcement",
    expected:
      "Local AI DB migrations are denied unless approvalText exactly equals RUN_LOCAL_AI_MIGRATIONS.",
    risk: "critical",
    run: () => {
      assertRunLocalAiMigrationsApprovalText("RUN_LOCAL_AI_MIGRATIONS_NOW");
    }
  });
}

async function runProjectKnowledgeReindexApprovalEval(): Promise<McpSecurityEvalResult> {
  return expectDenied({
    name: "project-knowledge-reindex-approval-enforcement",
    expected:
      "Force reindex is denied unless approvalText exactly equals REINDEX_PROJECT_KNOWLEDGE.",
    risk: "critical",
    run: () => {
      assertProjectKnowledgeReindexApprovalText("REINDEX_PROJECT_KNOWLEDGE_NOW");
    }
  });
}

async function runPatchApprovalEnforcementEval(): Promise<McpSecurityEvalResult> {
  return expectDenied({
    name: "patch-approval-enforcement",
    expected: "Patch apply is denied when approvalText is not exact.",
    risk: "critical",
    run: async () => {
      await applyApprovedPatch({
        patchId: "00000000-0000-0000-0000-000000000000",
        approvalText: "APPLY_PATCH:wrong-id"
      });
    }
  });
}

async function runNewFileOverwriteProtectionEval(): Promise<McpSecurityEvalResult> {
  return expectDenied({
    name: "new-file-overwrite-protection",
    expected: "New-file proposal is denied when the target already exists.",
    risk: "high",
    run: async () => {
      await ensureEvalTempFile();
      await createNewFileProposal({
        filePath: EVAL_TEMP_FILE,
        content: "Harmless eval content that should never be written.\n",
        reason: "Verify new-file overwrite protection."
      });
    }
  });
}

async function runLogAuditSummarySafetyEval(): Promise<McpSecurityEvalResult> {
  const [auditSummary, appLogSummary] = await Promise.all([
    readAuditSummary({ limit: 100 }),
    readAppLogSummary({ limit: 100 })
  ]);

  const forbiddenPayloads = findForbiddenSummaryPayloads([
    {
      name: "audit_read_summary",
      events: auditSummary.events
    },
    {
      name: "log_read_summary",
      events: appLogSummary.events
    },
    ...createUnsafeLegacySummaryFixtures()
  ]);

  return {
    name: "log-audit-summary-safety",
    status: forbiddenPayloads.length === 0 ? "passed" : "failed",
    expected:
      "Sanitized audit/log summary event payloads omit originalText, replacementText, raw content bodies, stdout, stderr, and patch-body fields.",
    actual:
      forbiddenPayloads.length === 0
        ? "No dangerous summary fields or raw payload values found in sanitized summary events."
        : `Forbidden summary payloads found: ${forbiddenPayloads.join(", ")}`,
    risk: "high"
  };
}

/**
 * Local security evals are a repeatable guardrail for AI-assisted development.
 *
 * They exercise the same policy and service functions used by the MCP tools,
 * but they avoid real secrets, arbitrary commands, deletion, and public network
 * access. Expected denials count as passes because these checks prove the
 * server still fails closed around sensitive operations.
 */
export async function runMcpSecurityEvals(): Promise<McpSecurityEvalReport> {
  const startedAt = new Date().toISOString();
  const results: McpSecurityEvalResult[] = [];

  results.push(await runSecretFileBlockingEval());
  results.push(await runPathTraversalBlockingEval());
  results.push(await runBlockedDirectoryListingEval());
  results.push(await runUnknownExtensionBlockingEval());
  results.push(await runCommandAllowlistBlockingEval());
  results.push(await runNoArbitrarySqlToolEval());
  results.push(await runKnowledgeToolsMilestone5SurfaceEval());
  results.push(await runContextPlannerRecommendationSafetyEval());
  results.push(await runNoPaidEmbeddingProviderToolEval());
  results.push(await runKnowledgeSecretIndexingBlockingEval());
  results.push(await runKnowledgeArchiveDefaultExclusionEval());
  results.push(await runDbMigrationApprovalEnforcementEval());
  results.push(await runProjectKnowledgeReindexApprovalEval());
  results.push(await runPatchApprovalEnforcementEval());
  results.push(await runNewFileOverwriteProtectionEval());
  results.push(await runLogAuditSummarySafetyEval());

  const passed = results.filter((result) => result.status === "passed").length;
  const failed = results.length - passed;

  return {
    suiteName: "mcp-security-evals",
    status: failed === 0 ? "passed" : "failed",
    startedAt,
    completedAt: new Date().toISOString(),
    total: results.length,
    passed,
    failed,
    results
  };
}
