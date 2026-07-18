export const KNOWLEDGE_SOURCE_TYPES = [
  "project-policy",
  "claude-compatibility",
  "skill",
  "architecture-doc",
  "mcp-doc",
  "ai-infra-doc",
  "security-doc",
  "runbook",
  "learning-journal",
  "project-doc",
  "typescript-source"
] as const;

export type KnowledgeSourceType = (typeof KNOWLEDGE_SOURCE_TYPES)[number];

export type KnowledgeScanScope = "docs-and-mcp";

export type KnowledgeScanSkipReason =
  | "archive-excluded"
  | "blocked-directory"
  | "blocked-sensitive-path"
  | "not-in-allowed-roots"
  | "not-file"
  | "read-error"
  | "scan-limit-exceeded"
  | "too-large"
  | "unsafe-path"
  | "unsupported-extension";

export type KnowledgeScanFile = {
  filePath: string;
  status: "included" | "skipped";
  sourceType?: KnowledgeSourceType;
  fileHash?: string;
  contentHash?: string;
  sizeBytes: number;
  isArchived: boolean;
  skipReason?: KnowledgeScanSkipReason;
};

export type IncludedKnowledgeScanFile = KnowledgeScanFile & {
  status: "included";
  sourceType: KnowledgeSourceType;
  fileHash: string;
  contentHash: string;
};

export type KnowledgeScanReport = {
  scope: KnowledgeScanScope;
  includeArchived: boolean;
  scannedAt: string;
  maxScanFiles: number;
  maxFileBytes: number;
  filesConsidered: number;
  filesAllowed: number;
  filesSkipped: number;
  skipReasonCounts: Record<KnowledgeScanSkipReason, number>;
  files: KnowledgeScanFile[];
};

export type ChunkingStrategy =
  | "markdown-heading"
  | "typescript-ast"
  | "fallback";

export type KnowledgeChunkMetadata = Record<
  string,
  string | number | boolean | null | string[]
>;

export type KnowledgeChunk = {
  chunkId: string;
  filePath: string;
  sourceType: KnowledgeSourceType;
  fileHash: string;
  chunkIndex: number;
  headingPath?: string[];
  symbolName?: string;
  content: string;
  contentHash: string;
  chunkingStrategy: ChunkingStrategy;
  tokenEstimate: number;
  metadata: KnowledgeChunkMetadata;
};

export type ChunkPreview = Omit<KnowledgeChunk, "content"> & {
  preview: string;
  previewLength: number;
};

export type ChunkPreviewReport = {
  filePath: string;
  sourceType: KnowledgeSourceType;
  fileHash: string;
  contentHash: string;
  sizeBytes: number;
  isArchived: boolean;
  maxChunks: number;
  maxPreviewChars: number;
  totalChunks: number;
  returnedChunks: number;
  chunkingStrategies: ChunkingStrategy[];
  warnings: string[];
  chunks: ChunkPreview[];
};
