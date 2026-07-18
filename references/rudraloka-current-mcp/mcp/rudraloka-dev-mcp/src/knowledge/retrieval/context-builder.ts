import {
  DEFAULT_PROJECT_CONTEXT_CHARS,
  DEFAULT_PROJECT_CONTEXT_CHUNKS,
  MAX_PROJECT_CONTEXT_CHARS,
  MAX_PROJECT_CONTEXT_CHUNKS,
  MAX_PROJECT_CONTEXT_EXCERPT_CHARS,
  MAX_PROJECT_KNOWLEDGE_CONTEXT_TASK_CHARS
} from "../../config/mcp-config.js";
import { sha256 } from "../../utils/crypto.js";
import type { KnowledgeSourceType } from "../chunking/chunk-types.js";
import { searchProjectKnowledge } from "./hybrid-retrieval-service.js";
import type {
  ProjectContextDiagnostics,
  ProjectContextResponse,
  ProjectContextSource,
  ProjectContextStats,
  ProjectKnowledgeSearchResult
} from "./retrieval-types.js";

function normalizeTask(task: string): string {
  const normalized = task.trim().replace(/\s+/g, " ");

  if (normalized.length === 0) {
    throw new Error("Project context task must not be empty.");
  }

  if (normalized.length > MAX_PROJECT_KNOWLEDGE_CONTEXT_TASK_CHARS) {
    throw new Error(
      `Project context task is too long. Limit is ${MAX_PROJECT_KNOWLEDGE_CONTEXT_TASK_CHARS} characters.`
    );
  }

  return normalized;
}

function emptyStats(params: {
  maxChunks: number;
  maxContextChars: number;
}): ProjectContextStats {
  return {
    maxChunks: params.maxChunks,
    maxContextChars: params.maxContextChars,
    returnedChunks: 0,
    returnedSources: 0,
    contextChars: 0,
    truncated: false
  };
}

function emptyDiagnostics(params: {
  task?: string;
  query?: string;
}): ProjectContextDiagnostics {
  return {
    taskSha256: params.task ? sha256(params.task) : undefined,
    taskLength: params.task?.length,
    querySha256: params.query ? sha256(params.query) : undefined,
    queryLength: params.query?.length,
    searchResultCount: 0,
    sourceCount: 0,
    outputSafety: {
      returnsVectors: false,
      returnsFullChunks: false
    }
  };
}

function clampMaxChunks(value: number | undefined): number {
  return Math.min(
    Math.max(1, value ?? DEFAULT_PROJECT_CONTEXT_CHUNKS),
    MAX_PROJECT_CONTEXT_CHUNKS
  );
}

function clampMaxContextChars(value: number | undefined): number {
  return Math.min(
    Math.max(1_000, value ?? DEFAULT_PROJECT_CONTEXT_CHARS),
    MAX_PROJECT_CONTEXT_CHARS
  );
}

function truncateExcerpt(preview: string): string {
  const normalized = preview.trim().replace(/\s+/g, " ");

  if (normalized.length <= MAX_PROJECT_CONTEXT_EXCERPT_CHARS) {
    return normalized;
  }

  return `${normalized
    .slice(0, Math.max(0, MAX_PROJECT_CONTEXT_EXCERPT_CHARS - 22))
    .trim()} [excerpt truncated]`;
}

function makeContextBlock(params: {
  task: string;
  sourceNumber: number;
  result: ProjectKnowledgeSearchResult;
  excerpt: string;
}): string {
  const labels = [
    `Source ${params.sourceNumber}: ${params.result.filePath}`,
    `Type: ${params.result.sourceType}`,
    params.result.headingPath ? `Heading: ${params.result.headingPath}` : "",
    params.result.symbolName ? `Symbol: ${params.result.symbolName}` : "",
    `Reasons: ${params.result.matchReasons.join(", ") || "ranked-match"}`,
    `Excerpt: ${params.excerpt}`
  ].filter(Boolean);

  return labels.join("\n");
}

function buildContext(params: {
  task: string;
  results: ProjectKnowledgeSearchResult[];
  maxChunks: number;
  maxContextChars: number;
}): {
  context: string;
  sources: ProjectContextSource[];
  stats: ProjectContextStats;
} {
  const sources: ProjectContextSource[] = [];
  const blocks: string[] = [`Task: ${params.task}`, "Project knowledge context:"];
  const seenContent = new Set<string>();
  let truncated = false;

  for (const result of params.results) {
    if (sources.length >= params.maxChunks) {
      truncated = params.results.length > sources.length;
      break;
    }

    const excerpt = truncateExcerpt(result.preview);
    const duplicateKey = `${result.filePath}:${excerpt}`;

    if (seenContent.has(duplicateKey)) {
      continue;
    }

    const sourceNumber = sources.length + 1;
    const block = makeContextBlock({
      task: params.task,
      sourceNumber,
      result,
      excerpt
    });
    const nextContext = [...blocks, "", block].join("\n");

    if (nextContext.length > params.maxContextChars) {
      truncated = true;
      break;
    }

    seenContent.add(duplicateKey);
    blocks.push("", block);
    sources.push({
      sourceNumber,
      chunkId: result.chunkId,
      filePath: result.filePath,
      sourceType: result.sourceType,
      headingPath: result.headingPath,
      symbolName: result.symbolName,
      score: result.score,
      matchReasons: result.matchReasons,
      excerpt
    });
  }

  const context = blocks.join("\n");

  return {
    context,
    sources,
    stats: {
      maxChunks: params.maxChunks,
      maxContextChars: params.maxContextChars,
      returnedChunks: sources.length,
      returnedSources: new Set(sources.map((source) => source.filePath)).size,
      contextChars: context.length,
      truncated
    }
  };
}

export async function getRelevantProjectContext(params: {
  task: string;
  maxChunks?: number;
  maxContextChars?: number;
  includeArchived?: boolean;
  includeSecurityContext?: boolean;
  sourceTypes?: KnowledgeSourceType[];
  pathPrefixes?: string[];
}): Promise<ProjectContextResponse> {
  const maxChunks = clampMaxChunks(params.maxChunks);
  const maxContextChars = clampMaxContextChars(params.maxContextChars);
  let task: string;

  try {
    task = normalizeTask(params.task);
  } catch (error) {
    return {
      status: "error",
      errorCode: "invalid-query",
      message: error instanceof Error ? error.message : String(error),
      context: "",
      sources: [],
      contextStats: emptyStats({ maxChunks, maxContextChars }),
      warnings: [],
      diagnostics: emptyDiagnostics({})
    };
  }

  const query = params.includeSecurityContext === true
    ? `${task} security policy AGENTS.md mcp-security-policy approval .env`
    : task;
  const search = await searchProjectKnowledge({
    query,
    topK: Math.min(maxChunks * 2, MAX_PROJECT_CONTEXT_CHUNKS * 2),
    includeArchived: params.includeArchived,
    sourceTypes: params.sourceTypes,
    pathPrefixes: params.pathPrefixes
  });

  if (search.status === "error") {
    return {
      status: "error",
      task,
      errorCode: search.errorCode,
      message: search.message,
      context: "",
      sources: [],
      contextStats: emptyStats({ maxChunks, maxContextChars }),
      warnings: search.warnings,
      diagnostics: emptyDiagnostics({ task, query })
    };
  }

  const built = buildContext({
    task,
    results: search.results,
    maxChunks,
    maxContextChars
  });

  return {
    status: "ok",
    task,
    context: built.context,
    sources: built.sources,
    contextStats: built.stats,
    warnings: [
      ...search.warnings,
      "context-builder-returns-bounded-excerpts-not-full-chunks"
    ],
    diagnostics: {
      taskSha256: sha256(task),
      taskLength: task.length,
      querySha256: sha256(query),
      queryLength: query.length,
      searchResultCount: search.results.length,
      sourceCount: built.sources.length,
      outputSafety: {
        returnsVectors: false,
        returnsFullChunks: false
      }
    }
  };
}
