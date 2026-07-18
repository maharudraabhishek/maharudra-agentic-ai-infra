import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ALLOWED_EXTENSIONS,
  BLOCKED_DIRS,
  BLOCKED_FILE_NAMES,
  DEFAULT_FALLBACK_CHUNK_CHARS,
  DEFAULT_FALLBACK_CHUNK_OVERLAP_CHARS,
  MAX_CHUNK_PREVIEW_CHARS,
  MAX_KNOWLEDGE_CHUNKS_PER_FILE,
  MAX_KNOWLEDGE_FILE_BYTES,
  MAX_KNOWLEDGE_SCAN_FILES,
  MAX_PROJECT_CONTEXT_CHARS,
  MAX_PROJECT_CONTEXT_CHUNKS,
  MAX_PROJECT_CONTEXT_PLANNER_NEXT_STEPS,
  MAX_PROJECT_CONTEXT_PLANNER_RECOMMENDED_QUERIES,
  MAX_PROJECT_CONTEXT_PLANNER_RECOMMENDED_SOURCES,
  MAX_PROJECT_CONTEXT_PLANNER_RECOMMENDED_TOOLS,
  MAX_PROJECT_CONTEXT_PLANNER_TASK_CHARS,
  MAX_PROJECT_CONTEXT_PLANNER_WARNINGS,
  MAX_PROJECT_KNOWLEDGE_QUERY_CHARS,
  MAX_PROJECT_KNOWLEDGE_SEARCH_TOP_K,
  MAX_READ_BYTES,
  PROJECT_ROOT
} from "../config/mcp-config.js";
import {
  MOCK_EMBEDDING_DIMENSION,
  MOCK_EMBEDDING_INDEX_VERSION,
  MOCK_EMBEDDING_MODEL,
  MOCK_EMBEDDING_VERSION
} from "../knowledge/embeddings/embedding-config.js";
import { safeListDirectory, safeReadTextFile } from "../services/file-read-service.js";
import { withToolTelemetry } from "../observability/logger.js";
import { REGISTERED_MCP_TOOL_NAMES } from "./tool-names.js";

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

export function registerReadTools(server: McpServer): void {
  server.registerTool(
    "project_info",
    {
      title: "Project info",
      description:
        "Returns safe metadata about the Rudraloka project root and MCP security limits.",
      inputSchema: z.object({})
    },
    withToolTelemetry("project_info", "read", async () =>
      textResponse(
        JSON.stringify(
          {
            projectRoot: PROJECT_ROOT,
            mode: "controlled-write",
            writePolicy:
              "Writes require a safe proposal followed by explicit approval before changes are applied.",
            maxReadBytes: MAX_READ_BYTES,
            blockedDirs: Array.from(BLOCKED_DIRS),
            blockedFiles: Array.from(BLOCKED_FILE_NAMES),
            allowedExtensions: Array.from(ALLOWED_EXTENSIONS),
            tools: Array.from(REGISTERED_MCP_TOOL_NAMES),
            localAiDb: {
              integration: "enabled",
              schema: "local_ai",
              migrationDirectory: "infra/db/local-ai/migrations/",
              arbitrarySqlExposed: false,
              tools: [
                "check_local_ai_db",
                "get_local_ai_migration_status",
                "run_local_ai_migrations"
              ]
            },
            localKnowledgePipeline: {
              milestone: "agentic-context-planner",
              readOnly: false,
              sourceMutation: false,
              dbWrites: true,
              dbWriteScope: "local_ai RAG index tables only",
              embeddings: "mock-only",
              embeddingModel: MOCK_EMBEDDING_MODEL,
              embeddingVersion: MOCK_EMBEDDING_VERSION,
              embeddingDimension: MOCK_EMBEDDING_DIMENSION,
              indexVersion: MOCK_EMBEDDING_INDEX_VERSION,
              retrieval: true,
              retrievalMode:
                "mock pgvector search plus Postgres full-text search plus heuristic reranking",
              paidProviders: false,
              planner: true,
              plannerMode:
                "deterministic advisory heuristics only; no DB, filesystem, retrieval, model, command, migration, indexing, or mutation calls",
              limits: {
                maxKnowledgeScanFiles: MAX_KNOWLEDGE_SCAN_FILES,
                maxKnowledgeFileBytes: MAX_KNOWLEDGE_FILE_BYTES,
                maxKnowledgeChunksPerFile: MAX_KNOWLEDGE_CHUNKS_PER_FILE,
                maxChunkPreviewChars: MAX_CHUNK_PREVIEW_CHARS,
                maxProjectKnowledgeQueryChars: MAX_PROJECT_KNOWLEDGE_QUERY_CHARS,
                maxProjectKnowledgeSearchTopK: MAX_PROJECT_KNOWLEDGE_SEARCH_TOP_K,
                maxProjectContextChunks: MAX_PROJECT_CONTEXT_CHUNKS,
                maxProjectContextChars: MAX_PROJECT_CONTEXT_CHARS,
                maxProjectContextPlannerTaskChars:
                  MAX_PROJECT_CONTEXT_PLANNER_TASK_CHARS,
                maxProjectContextPlannerRecommendedQueries:
                  MAX_PROJECT_CONTEXT_PLANNER_RECOMMENDED_QUERIES,
                maxProjectContextPlannerRecommendedSources:
                  MAX_PROJECT_CONTEXT_PLANNER_RECOMMENDED_SOURCES,
                maxProjectContextPlannerRecommendedTools:
                  MAX_PROJECT_CONTEXT_PLANNER_RECOMMENDED_TOOLS,
                maxProjectContextPlannerWarnings:
                  MAX_PROJECT_CONTEXT_PLANNER_WARNINGS,
                maxProjectContextPlannerNextSteps:
                  MAX_PROJECT_CONTEXT_PLANNER_NEXT_STEPS,
                defaultFallbackChunkChars: DEFAULT_FALLBACK_CHUNK_CHARS,
                defaultFallbackChunkOverlapChars:
                  DEFAULT_FALLBACK_CHUNK_OVERLAP_CHARS
              },
              tools: [
                "preview_project_knowledge_scan",
                "preview_project_chunks",
                "run_knowledge_pipeline_evals",
                "index_project_knowledge",
                "get_project_knowledge_index_status",
                "search_project_knowledge",
                "get_relevant_context",
                "run_project_rag_evals",
                "plan_project_context"
              ]
            }
          },
          null,
          2
        )
      )
    )
  );

  server.registerTool(
    "safe_list_files",
    {
      title: "Safely list project files",
      description:
        "Lists files in a project-relative directory. Blocks secrets, node_modules, build outputs, and paths outside the project.",
      inputSchema: z.object({
        directory: z.string().default(".")
      })
    },
    withToolTelemetry(
      "safe_list_files",
      "list",
      async ({ directory }: { directory: string }) => {
        const files = await safeListDirectory(directory);

        return textResponse(files.join("\n") || "No visible files.");
      }
    )
  );

  server.registerTool(
    "safe_read_file",
    {
      title: "Safely read source file",
      description:
        "Reads a small, allowed source/document file from the project. Blocks secrets, binaries, large files, and path traversal.",
      inputSchema: z.object({
        filePath: z.string()
      })
    },
    withToolTelemetry(
      "safe_read_file",
      "read",
      async ({ filePath }: { filePath: string }) => textResponse(await safeReadTextFile(filePath))
    )
  );
}
