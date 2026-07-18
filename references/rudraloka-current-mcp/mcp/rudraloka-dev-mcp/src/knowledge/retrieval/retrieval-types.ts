import type {
  ChunkingStrategy,
  KnowledgeSourceType
} from "../chunking/chunk-types.js";

export type RetrievalSource = "vector" | "full-text";

export type ProjectKnowledgeRetrievalErrorCode =
  | "invalid-query"
  | "invalid-filter"
  | "db-unavailable"
  | "schema-not-ready"
  | "index-not-ready"
  | "retrieval-error";

export class ProjectKnowledgeRetrievalSafeError extends Error {
  override name = "ProjectKnowledgeRetrievalSafeError";

  constructor(
    readonly code: ProjectKnowledgeRetrievalErrorCode,
    message: string
  ) {
    super(message);
  }
}

export type ProjectKnowledgeSearchFilters = {
  includeArchived?: boolean;
  sourceTypes?: KnowledgeSourceType[];
  pathPrefixes?: string[];
};

export type NormalizedProjectKnowledgeSearchOptions = {
  query: string;
  topK: number;
  includeArchived: boolean;
  sourceTypes: KnowledgeSourceType[];
  pathPrefixes: string[];
};

export type ProjectKnowledgeIndexState = {
  indexVersion: string;
  indexRunId: string;
  completedAt: string;
};

export type ProjectKnowledgeCandidate = {
  chunkId: string;
  documentId: string;
  filePath: string;
  sourceType: KnowledgeSourceType;
  isArchived: boolean;
  chunkIndex: number;
  headingPath?: string;
  symbolName?: string;
  chunkingStrategy: ChunkingStrategy;
  tokenEstimate: number;
  contentHash: string;
  content: string;
  vectorScore?: number;
  fullTextScore?: number;
  retrievalSources: RetrievalSource[];
};

export type ProjectKnowledgeScoreBreakdown = {
  vectorScore: number;
  fullTextScore: number;
  exactIdentifierBoost: number;
  metadataBoost: number;
  sourcePriorityBoost: number;
  securityOrArchitectureBoost: number;
  archivePenalty: number;
  finalScore: number;
};

export type RerankedProjectKnowledgeCandidate = ProjectKnowledgeCandidate & {
  score: number;
  scoreBreakdown: ProjectKnowledgeScoreBreakdown;
  matchReasons: string[];
};

export type ProjectKnowledgeSearchResult = {
  chunkId: string;
  filePath: string;
  sourceType: KnowledgeSourceType;
  isArchived: boolean;
  chunkIndex: number;
  headingPath?: string;
  symbolName?: string;
  chunkingStrategy: ChunkingStrategy;
  tokenEstimate: number;
  score: number;
  scoreBreakdown: ProjectKnowledgeScoreBreakdown;
  matchReasons: string[];
  retrievalSources: RetrievalSource[];
  preview: string;
  previewLength: number;
};

export type ProjectKnowledgeSearchDiagnostics = {
  querySha256?: string;
  queryLength?: number;
  topK?: number;
  includeArchived?: boolean;
  sourceTypeFilterCount?: number;
  pathPrefixFilterCount?: number;
  vectorCandidateCount?: number;
  fullTextCandidateCount?: number;
  mergedCandidateCount?: number;
  resultCount: number;
  retrievalSourceCounts?: Record<RetrievalSource, number>;
  errorCode?: ProjectKnowledgeRetrievalErrorCode;
  outputSafety: {
    returnsVectors: false;
    returnsFullChunks: false;
  };
};

export type ProjectKnowledgeSearchSuccess = {
  status: "ok";
  query: string;
  indexVersion: string;
  indexRunId: string;
  results: ProjectKnowledgeSearchResult[];
  warnings: string[];
  diagnostics?: ProjectKnowledgeSearchDiagnostics;
};

export type ProjectKnowledgeSearchError = {
  status: "error";
  query?: string;
  errorCode: ProjectKnowledgeRetrievalErrorCode;
  message: string;
  results: [];
  warnings: string[];
  diagnostics?: ProjectKnowledgeSearchDiagnostics;
};

export type ProjectKnowledgeSearchResponse =
  | ProjectKnowledgeSearchSuccess
  | ProjectKnowledgeSearchError;

export type ProjectContextSource = {
  sourceNumber: number;
  chunkId: string;
  filePath: string;
  sourceType: KnowledgeSourceType;
  headingPath?: string;
  symbolName?: string;
  score: number;
  matchReasons: string[];
  excerpt: string;
};

export type ProjectContextStats = {
  maxChunks: number;
  maxContextChars: number;
  returnedChunks: number;
  returnedSources: number;
  contextChars: number;
  truncated: boolean;
};

export type ProjectContextDiagnostics = {
  taskSha256?: string;
  taskLength?: number;
  querySha256?: string;
  queryLength?: number;
  searchResultCount: number;
  sourceCount: number;
  outputSafety: {
    returnsVectors: false;
    returnsFullChunks: false;
  };
};

export type ProjectContextSuccess = {
  status: "ok";
  task: string;
  context: string;
  sources: ProjectContextSource[];
  contextStats: ProjectContextStats;
  warnings: string[];
  diagnostics?: ProjectContextDiagnostics;
};

export type ProjectContextError = {
  status: "error";
  task?: string;
  errorCode: ProjectKnowledgeRetrievalErrorCode;
  message: string;
  context: "";
  sources: [];
  contextStats: ProjectContextStats;
  warnings: string[];
  diagnostics?: ProjectContextDiagnostics;
};

export type ProjectContextResponse =
  | ProjectContextSuccess
  | ProjectContextError;
