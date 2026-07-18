import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  DEFAULT_PROJECT_CONTEXT_CHARS,
  DEFAULT_PROJECT_CONTEXT_CHUNKS,
  DEFAULT_PROJECT_KNOWLEDGE_SEARCH_TOP_K,
  MAX_KNOWLEDGE_CHUNKS_PER_FILE,
  MAX_PROJECT_CONTEXT_CHARS,
  MAX_PROJECT_CONTEXT_CHUNKS,
  MAX_PROJECT_CONTEXT_PLANNER_TASK_CHARS,
  MAX_PROJECT_KNOWLEDGE_CONTEXT_TASK_CHARS,
  MAX_PROJECT_KNOWLEDGE_PATH_FILTERS,
  MAX_PROJECT_KNOWLEDGE_QUERY_CHARS,
  MAX_PROJECT_KNOWLEDGE_SEARCH_TOP_K
} from "../config/mcp-config.js";
import type { OperationStatus, TraceContext } from "../core/types.js";
import { chunkProjectFile } from "../knowledge/chunking/chunk-project-file.js";
import {
  KNOWLEDGE_SOURCE_TYPES as KNOWLEDGE_SOURCE_TYPE_VALUES,
  type KnowledgeScanFile,
  type KnowledgeSourceType
} from "../knowledge/chunking/chunk-types.js";
import { runKnowledgePipelineEvals } from "../knowledge/evals/knowledge-pipeline-evals.js";
import { runProjectRagEvals } from "../knowledge/evals/project-rag-evals.js";
import { indexProjectKnowledge } from "../knowledge/indexing/project-knowledge-indexer.js";
import { scanProjectKnowledge } from "../knowledge/indexing/project-scanner.js";
import { planProjectContext } from "../knowledge/planning/context-planner.js";
import {
  PROJECT_CONTEXT_PLANNER_MODES,
  type ProjectContextPlannerMode
} from "../knowledge/planning/context-planner-types.js";
import { getRelevantProjectContext } from "../knowledge/retrieval/context-builder.js";
import { searchProjectKnowledge } from "../knowledge/retrieval/hybrid-retrieval-service.js";
import { ProjectKnowledgeStore } from "../knowledge/storage/project-knowledge-store.js";
import { writeAuditEvent } from "../observability/audit-logger.js";
import { withToolTelemetry, writeAppLog } from "../observability/logger.js";
import {
  createChildTraceContext,
  getDurationMs
} from "../observability/trace.js";
import {
  normalizeProjectPath,
  toProjectRelativePath
} from "../security/path-policy.js";
import { sha256 } from "../utils/crypto.js";

export const KNOWLEDGE_TOOL_NAMES = [
  "preview_project_knowledge_scan",
  "preview_project_chunks",
  "run_knowledge_pipeline_evals",
  "index_project_knowledge",
  "get_project_knowledge_index_status",
  "search_project_knowledge",
  "get_relevant_context",
  "run_project_rag_evals",
  "plan_project_context"
] as const;

function textResponse(text: string) {
  return {
    content: [
      {
        type: "text" as const,
        text
      }
    ]
  };
}

function findScannedFile(params: {
  files: KnowledgeScanFile[];
  filePath: string;
}): KnowledgeScanFile | undefined {
  const fullPath = normalizeProjectPath(params.filePath);
  const relativePath = toProjectRelativePath(fullPath);

  return params.files.find((file) => file.filePath === relativePath);
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Project knowledge operation failed safely.";
}

function statusFromError(error: unknown): OperationStatus {
  return /denied|must exactly equal|approvalText/i.test(safeErrorMessage(error))
    ? "denied"
    : "error";
}

function textMetrics(prefix: "query" | "task", value: string): Record<string, unknown> {
  return {
    [`${prefix}Sha256`]: sha256(value),
    [`${prefix}Length`]: value.length
  };
}

async function writeKnowledgeSummaryLog(params: {
  traceContext: TraceContext;
  status?: OperationStatus;
  metadata: Record<string, unknown>;
}): Promise<void> {
  await writeAppLog({
    traceContext: createChildTraceContext(params.traceContext),
    toolName: params.traceContext.toolName,
    operationType: params.traceContext.operationType,
    status: params.status ?? "success",
    metadata: params.metadata
  });
}

function failedCaseNames(results: Array<{ name: string; status: string }>): string {
  return results
    .filter((result) => result.status === "failed")
    .map((result) => result.name)
    .slice(0, 10)
    .join(", ");
}

const sourceTypeSchema = z.enum(KNOWLEDGE_SOURCE_TYPE_VALUES);

export function registerKnowledgeTools(server: McpServer): void {
  server.registerTool(
    "preview_project_knowledge_scan",
    {
      title: "Preview project knowledge scan",
      description:
        "Previews the safe local knowledge scanner. Returns metadata and hashes only; does not return file contents, write to the DB, or create embeddings.",
      inputSchema: z.object({
        scope: z
          .enum(["docs-and-mcp"])
          .default("docs-and-mcp")
          .describe("Approved scan scope."),
        includeArchived: z
          .boolean()
          .default(false)
          .describe("Whether to include docs/99-archive in the preview scan.")
      })
    },
    withToolTelemetry(
      "preview_project_knowledge_scan",
      "read",
      async (input: { scope: "docs-and-mcp"; includeArchived: boolean }) => {
        const report = await scanProjectKnowledge(input);

        return textResponse(JSON.stringify(report, null, 2));
      }
    )
  );

  server.registerTool(
    "preview_project_chunks",
    {
      title: "Preview project chunks",
      description:
        "Previews bounded structure-aware chunks for one indexable project file. Returns short previews only and never stores chunks.",
      inputSchema: z.object({
        filePath: z.string().describe("Project-relative path to an indexable file."),
        maxChunks: z
          .number()
          .int()
          .min(1)
          .max(MAX_KNOWLEDGE_CHUNKS_PER_FILE)
          .default(10)
          .describe("Maximum number of chunk previews to return.")
      })
    },
    withToolTelemetry(
      "preview_project_chunks",
      "read",
      async (input: { filePath: string; maxChunks: number }) => {
        const scanReport = await scanProjectKnowledge({
          scope: "docs-and-mcp",
          includeArchived: false
        });
        const scannedFile = findScannedFile({
          files: scanReport.files,
          filePath: input.filePath
        });

        if (!scannedFile || scannedFile.status !== "included") {
          const reason = scannedFile?.skipReason ?? "not-in-allowed-roots";
          throw new Error(
            `Access denied: file is not indexable by knowledge policy (${reason}).`
          );
        }

        const report = await chunkProjectFile({
          scannedFile,
          maxChunks: input.maxChunks
        });

        return textResponse(JSON.stringify(report, null, 2));
      }
    )
  );

  server.registerTool(
    "run_knowledge_pipeline_evals",
    {
      title: "Run knowledge pipeline evals",
      description:
        "Runs read-only evals for the local knowledge scanner and chunkers. Does not write to source files, DB tables, or embedding providers.",
      inputSchema: z.object({})
    },
    withToolTelemetry(
      "run_knowledge_pipeline_evals",
      "eval",
      async (_input: Record<string, never>, traceContext: TraceContext) => {
        const report = await runKnowledgePipelineEvals();

        await writeKnowledgeSummaryLog({
          traceContext,
          metadata: {
            suiteName: report.suiteName,
            status: report.status,
            total: report.total,
            passed: report.passed,
            failed: report.failed,
            failedCaseNames: failedCaseNames(report.results)
          }
        });

        return textResponse(JSON.stringify(report, null, 2));
      }
    )
  );

  server.registerTool(
    "plan_project_context",
    {
      title: "Plan project context",
      description:
        "Plans task-specific project context with deterministic heuristics only. Does not call the DB, filesystem, retrieval tools, models, commands, migrations, indexing, or mutation tools.",
      inputSchema: z.object({
        task: z
          .string()
          .min(1)
          .max(MAX_PROJECT_CONTEXT_PLANNER_TASK_CHARS)
          .describe("Task string to classify and plan context for."),
        mode: z
          .enum(PROJECT_CONTEXT_PLANNER_MODES)
          .default("auto")
          .describe(
            "Optional planner mode: architecture, implementation, debugging, security-review, docs, ai-infra, or auto."
          )
      })
    },
    withToolTelemetry(
      "plan_project_context",
      "read",
      async (
        input: { task: string; mode: ProjectContextPlannerMode },
        traceContext: TraceContext
      ) => {
        const plan = planProjectContext(input);

        await writeKnowledgeSummaryLog({
          traceContext,
          metadata: {
            ...textMetrics("task", input.task),
            taskType: plan.taskType,
            strategy: plan.strategy,
            needsUserDecision: plan.needsUserDecision,
            includeSecurityContext: plan.includeSecurityContext,
            includeArchitectureContext: plan.includeArchitectureContext,
            recommendedQueryCount: plan.recommendedQueries.length,
            recommendedSourceCount: plan.recommendedSources.length,
            recommendedToolCount: plan.recommendedTools.length,
            warningCount: plan.warnings.length,
            nextStepCount: plan.nextSteps.length
          }
        });

        return textResponse(JSON.stringify(plan, null, 2));
      }
    )
  );

  server.registerTool(
    "index_project_knowledge",
    {
      title: "Index project knowledge",
      description:
        "Manually indexes approved project knowledge into the local AI DB using free deterministic mock embeddings only. Writes only to the local knowledge index and returns a bounded summary.",
      inputSchema: z.object({
        scope: z
          .enum(["docs-and-mcp"])
          .default("docs-and-mcp")
          .describe("Approved scan scope."),
        includeArchived: z
          .boolean()
          .default(false)
          .describe("Whether to include docs/99-archive in indexing."),
        forceReindex: z
          .boolean()
          .default(false)
          .describe("Whether to clear and rebuild the current mock index."),
        approvalText: z
          .string()
          .default("")
          .describe(
            'Must exactly equal "REINDEX_PROJECT_KNOWLEDGE" when forceReindex is true.'
          )
      })
    },
    withToolTelemetry(
      "index_project_knowledge",
      "db",
      async (
        input: {
          scope: "docs-and-mcp";
          includeArchived: boolean;
          forceReindex: boolean;
          approvalText: string;
        },
        traceContext: TraceContext
      ) => {
        await writeAuditEvent({
          traceContext,
          toolName: "index_project_knowledge",
          operationType: "db",
          status: "attempt",
          message:
            "Manual mock project knowledge indexing requested. Source files are not mutated and vectors are not logged."
        });

        try {
          const result = await indexProjectKnowledge(input);

          await writeKnowledgeSummaryLog({
            traceContext,
            metadata: {
              filesScanned: result.filesScanned,
              filesIndexed: result.filesIndexed,
              filesSkipped: result.filesSkipped,
              preSkippedFiles: result.maintenance.preSkippedFiles,
              postSkippedFiles: result.maintenance.postSkippedFiles,
              changedFiles: result.maintenance.changedFiles,
              unchangedFiles: result.maintenance.unchangedFiles,
              chunksCreated: result.chunksCreated,
              chunksEmbedded: result.chunksEmbedded,
              clearedDocuments: result.clearedDocuments,
              indexVersion: result.indexVersion,
              embeddingModel: result.embeddingModel,
              embeddingVersion: result.embeddingVersion,
              embeddingDimension: result.embeddingDimension
            }
          });

          await writeAuditEvent({
            traceContext,
            toolName: "index_project_knowledge",
            operationType: "db",
            status: "success",
            durationMs: getDurationMs(traceContext),
            message: `Indexed ${result.filesIndexed} file(s) with mock embeddings.`
          });

          return textResponse(JSON.stringify(result, null, 2));
        } catch (error) {
          const status = statusFromError(error);

          await writeAuditEvent({
            traceContext,
            toolName: "index_project_knowledge",
            operationType: "db",
            status,
            durationMs: getDurationMs(traceContext),
            message: safeErrorMessage(error)
          });

          if (status === "denied") {
            throw error;
          }

          return textResponse(
            JSON.stringify(
              {
                status: "error",
                message: safeErrorMessage(error)
              },
              null,
              2
            )
          );
        }
      }
    )
  );

  server.registerTool(
    "get_project_knowledge_index_status",
    {
      title: "Get project knowledge index status",
      description:
        "Reads safe local project knowledge index status. Returns counts and run metadata only; no chunk contents or vectors.",
      inputSchema: z.object({})
    },
    withToolTelemetry(
      "get_project_knowledge_index_status",
      "db",
      async (_input: Record<string, never>, traceContext: TraceContext) => {
        try {
          const status = await new ProjectKnowledgeStore().getIndexStatus();

          await writeKnowledgeSummaryLog({
            traceContext,
            metadata: {
              indexVersion: status.indexVersion,
              embeddingModel: status.embeddingModel,
              embeddingVersion: status.embeddingVersion,
              embeddingDimension: status.embeddingDimension,
              sourceCount: status.documentCount,
              returnedChunks: status.chunkCount,
              chunksEmbedded: status.embeddingCount,
              failed: status.pendingOrFailedRuns.length
            }
          });

          return textResponse(JSON.stringify(status, null, 2));
        } catch (error) {
          return textResponse(
            JSON.stringify(
              {
                status: "error",
                message: safeErrorMessage(error)
              },
              null,
              2
            )
          );
        }
      }
    )
  );

  server.registerTool(
    "search_project_knowledge",
    {
      title: "Search project knowledge",
      description:
        "Searches the approved local project knowledge index with mock pgvector search, Postgres full-text search, metadata filters, and heuristic reranking. Does not mutate source files or return vectors.",
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .max(MAX_PROJECT_KNOWLEDGE_QUERY_CHARS)
          .describe("Search query for approved local project knowledge."),
        topK: z
          .number()
          .int()
          .min(1)
          .max(MAX_PROJECT_KNOWLEDGE_SEARCH_TOP_K)
          .default(DEFAULT_PROJECT_KNOWLEDGE_SEARCH_TOP_K)
          .describe("Maximum number of bounded retrieval results to return."),
        includeArchived: z
          .boolean()
          .default(false)
          .describe("Whether to include docs/99-archive results."),
        sourceTypes: z
          .array(sourceTypeSchema)
          .default([])
          .describe("Optional allowlisted source type filters."),
        pathPrefixes: z
          .array(z.string().min(1).max(240))
          .max(MAX_PROJECT_KNOWLEDGE_PATH_FILTERS)
          .default([])
          .describe("Optional approved knowledge path prefixes.")
      })
    },
    withToolTelemetry(
      "search_project_knowledge",
      "db",
      async (input: {
        query: string;
        topK: number;
        includeArchived: boolean;
        sourceTypes: KnowledgeSourceType[];
        pathPrefixes: string[];
      }, traceContext: TraceContext) => {
        const response = await searchProjectKnowledge(input);

        await writeKnowledgeSummaryLog({
          traceContext,
          status: response.status === "ok" ? "success" : "error",
          metadata: {
            ...(response.diagnostics ?? textMetrics("query", input.query)),
            status: response.status,
            errorCode: response.status === "error" ? response.errorCode : undefined
          }
        });

        return textResponse(JSON.stringify(response, null, 2));
      }
    )
  );

  server.registerTool(
    "get_relevant_context",
    {
      title: "Get relevant project context",
      description:
        "Builds compact bounded context from the approved local project knowledge index. Does not plan tasks, mutate source files, return vectors, or return full chunk bodies by default.",
      inputSchema: z.object({
        task: z
          .string()
          .min(1)
          .max(MAX_PROJECT_KNOWLEDGE_CONTEXT_TASK_CHARS)
          .describe("Task string to build local project context for."),
        maxChunks: z
          .number()
          .int()
          .min(1)
          .max(MAX_PROJECT_CONTEXT_CHUNKS)
          .default(DEFAULT_PROJECT_CONTEXT_CHUNKS)
          .describe("Maximum number of context chunks to include."),
        maxContextChars: z
          .number()
          .int()
          .min(1_000)
          .max(MAX_PROJECT_CONTEXT_CHARS)
          .default(DEFAULT_PROJECT_CONTEXT_CHARS)
          .describe("Maximum character budget for returned context."),
        includeArchived: z
          .boolean()
          .default(false)
          .describe("Whether to include docs/99-archive context."),
        includeSecurityContext: z
          .boolean()
          .default(true)
          .describe("Whether to bias context toward security policy sources."),
        sourceTypes: z
          .array(sourceTypeSchema)
          .default([])
          .describe("Optional allowlisted source type filters."),
        pathPrefixes: z
          .array(z.string().min(1).max(240))
          .max(MAX_PROJECT_KNOWLEDGE_PATH_FILTERS)
          .default([])
          .describe("Optional approved knowledge path prefixes.")
      })
    },
    withToolTelemetry(
      "get_relevant_context",
      "db",
      async (input: {
        task: string;
        maxChunks: number;
        maxContextChars: number;
        includeArchived: boolean;
        includeSecurityContext: boolean;
        sourceTypes: KnowledgeSourceType[];
        pathPrefixes: string[];
      }, traceContext: TraceContext) => {
        const response = await getRelevantProjectContext(input);

        await writeKnowledgeSummaryLog({
          traceContext,
          status: response.status === "ok" ? "success" : "error",
          metadata: {
            ...(response.diagnostics ?? textMetrics("task", input.task)),
            status: response.status,
            errorCode: response.status === "error" ? response.errorCode : undefined,
            returnedChunks: response.contextStats.returnedChunks,
            returnedSources: response.contextStats.returnedSources,
            contextChars: response.contextStats.contextChars,
            truncated: response.contextStats.truncated,
            maxContextChars: response.contextStats.maxContextChars
          }
        });

        return textResponse(JSON.stringify(response, null, 2));
      }
    )
  );

  server.registerTool(
    "run_project_rag_evals",
    {
      title: "Run project RAG evals",
      description:
        "Runs retrieval and context evals for the local project knowledge index. DB-dependent checks are skipped safely when the local DB or index is not ready.",
      inputSchema: z.object({})
    },
    withToolTelemetry(
      "run_project_rag_evals",
      "eval",
      async (_input: Record<string, never>, traceContext: TraceContext) => {
        const report = await runProjectRagEvals();

        await writeKnowledgeSummaryLog({
          traceContext,
          metadata: {
            suiteName: report.suiteName,
            status: report.status,
            total: report.total,
            passed: report.passed,
            failed: report.failed,
            skipped: report.skipped,
            failedCaseNames: failedCaseNames(report.results)
          }
        });

        return textResponse(JSON.stringify(report, null, 2));
      }
    )
  );
}
