export type OperationType =
  | "read"
  | "list"
  | "command"
  | "patch_proposal"
  | "patch_apply"
  | "new_file_proposal"
  | "new_file_apply"
  | "db"
  | "db_migration"
  | "observability"
  | "eval";

export type OperationStatus = "attempt" | "success" | "denied" | "error";

export type TraceContext = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  toolName: string;
  operationType: OperationType;
  startedAtMs: number;
};

export type SafeLogValue =
  | string
  | number
  | boolean
  | null
  | SafeLogValue[]
  | { [key: string]: SafeLogValue };

export type SafeLogMetadata = Record<string, SafeLogValue>;

/**
 * Stored patch proposals contain the requested replacement text, but these
 * objects stay inside .mcp-local and are never returned by summary tools.
 */
export type PatchProposal = {
  patchId: string;
  createdAt: string;
  status: "proposed" | "applied";
  filePath: string;
  relativePath: string;
  reason: string;
  originalText: string;
  replacementText: string;
  originalSha256: string;
  replacementSha256: string;
  appliedAt?: string;
};

/**
 * New-file proposals are separate from patch proposals because creating a file
 * needs a different safety check: the target must not already exist.
 */
export type NewFileProposal = {
  proposalId: string;
  createdAt: string;
  status: "proposed" | "created";
  filePath: string;
  relativePath: string;
  reason: string;
  content: string;
  contentSha256: string;
  createdFileAt?: string;
};
