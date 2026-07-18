/**
 * Supported import source formats for actual provider/client usage data.
 *
 * Each value corresponds to a concrete parser implementation in the runtime
 * package. Parsers are deterministic, offline, and do not call external APIs.
 *
 * - openai-csv: OpenAI usage export CSV (api.openai.com usage dashboard)
 * - anthropic-usage-api-json: Anthropic usage API JSON response
 * - anthropic-csv: Anthropic usage export CSV
 * - manual-json: User-maintained JSON array of usage records
 * - manual-csv: User-maintained CSV with framework-compatible headers
 * - generic-csv: Any CSV with at least provider + token count columns
 */
export type ActualUsageImportSource =
  | "openai-csv"
  | "anthropic-usage-api-json"
  | "anthropic-csv"
  | "manual-json"
  | "manual-csv"
  | "generic-csv";

/**
 * Confidence level for an imported usage record.
 *
 * - high: Record came from an authoritative provider export with full fields.
 * - estimated: Record was inferred from partial fields or approximated columns.
 * - approximate: Record was derived from grouped/aggregated data without
 *   per-run granularity.
 */
export type UsageImportConfidence = "high" | "estimated" | "approximate";

/**
 * A safe, privacy-respecting usage record imported from an external source.
 *
 * Fields that may contain prompts, task bodies, API keys, or user identities
 * are excluded. User identifiers, when present, are hashed or omitted.
 * The record contains only safe numeric, categorical, and timestamp metadata.
 */
export type ActualUsageRecord = {
  /** Provider name (e.g. "openai", "anthropic", "generic"). */
  readonly provider: string;
  /** Client label used to identify the calling tool (e.g. "codex", "claude-code"). */
  readonly client?: string;
  /** Model identifier (e.g. "gpt-4o", "claude-sonnet-4-6"). */
  readonly model?: string;
  /** Project identifier from the provider's export. */
  readonly projectId?: string;
  /** Workspace or organization identifier from the provider's export. */
  readonly workspaceId?: string;
  /**
   * Hashed or redacted user identifier.
   * Never a raw email or user ID unless `hashUserIds: false` is explicitly set.
   */
  readonly userIdHash?: string;
  /** Safe task type label (e.g. "debugging", "architecture-review"). */
  readonly taskType?: string;
  /** Run identifier for correlation with framework-estimated records. */
  readonly runId?: string;
  /** Trace identifier for correlation with framework-estimated records. */
  readonly traceId?: string;
  /** ISO 8601 timestamp of the usage event, if available per-record. */
  readonly timestamp?: string;
  /**
   * Date range of the import batch, when records are aggregated rather than
   * per-event (e.g. daily or monthly provider exports).
   */
  readonly dateRange?: {
    readonly from: string;
    readonly to: string;
  };
  /** Input tokens as reported by the provider. */
  readonly inputTokens: number;
  /** Output tokens as reported by the provider. */
  readonly outputTokens: number;
  /** Cache read tokens, when provided by the provider. */
  readonly cacheReadTokens?: number;
  /** Cache write tokens, when provided by the provider. */
  readonly cacheWriteTokens?: number;
  /**
   * Reasoning tokens, when explicitly provided in the export.
   * Not all providers surface these; they are never inferred.
   */
  readonly reasoningTokens?: number;
  /** Total tokens as reported by the provider. */
  readonly totalTokens: number;
  /** Monetary cost as reported by the provider export, if present. */
  readonly cost?: number;
  /** Currency code (e.g. "USD") for the cost field. */
  readonly currency?: string;
  /** File name of the source file this record came from. */
  readonly sourceFileName: string;
  /** ISO 8601 timestamp of when this record was imported into the framework. */
  readonly importedAt: string;
  /** Confidence level for this record's accuracy. */
  readonly confidence: UsageImportConfidence;
};

/**
 * A batch of safe usage records produced by one import operation.
 *
 * Contains the parsed records, skip count for rows that could not be safely
 * parsed, and the total row count for audit purposes.
 */
export type ActualUsageImportBatch = {
  /** Source format used to parse this batch. */
  readonly source: ActualUsageImportSource;
  /** File name of the source file. */
  readonly sourceFileName: string;
  /** ISO 8601 timestamp of when this batch was imported. */
  readonly importedAt: string;
  /** Safe usage records parsed from the source file. */
  readonly records: readonly ActualUsageRecord[];
  /** Number of rows that were skipped (malformed, oversized, or unsafe). */
  readonly skippedRows: number;
  /** Total row count in the source file, including skipped rows. */
  readonly totalRows: number;
};

/**
 * Result of parsing and importing actual usage data from one file.
 *
 * On success, `batch` contains the parsed records.
 * On failure, `errors` explains what prevented parsing.
 * `warnings` are non-fatal issues (e.g. skipped rows, unrecognized columns).
 */
export type ActualUsageImportResult = {
  /** True when parsing produced at least a partial batch with no fatal errors. */
  readonly ok: boolean;
  /** Parsed batch, present when `ok` is true. */
  readonly batch?: ActualUsageImportBatch;
  /** Fatal errors that prevented parsing from completing. */
  readonly errors: readonly string[];
  /** Non-fatal warnings about skipped rows or missing optional columns. */
  readonly warnings: readonly string[];
};

/**
 * Interface for deterministic, offline parsers that convert raw file content
 * into safe usage records for one specific source format.
 *
 * Implementations must not import prompts, request/response bodies, API keys,
 * or raw user identifiers. They must validate row counts and file size before
 * parsing and return clear validation errors for malformed rows.
 */
export interface UsageImportParser {
  /** Source format this parser handles. */
  readonly source: ActualUsageImportSource;
  /**
   * Parses raw file content into a batch of safe usage records.
   *
   * @param content - Raw text content of the source file.
   * @param sourceFileName - File name for attribution and audit.
   * @param options - Import options controlling limits and privacy handling.
   * @returns A structured result with records, warnings, and errors.
   */
  parse(
    content: string,
    sourceFileName: string,
    options?: UsageImportOptions
  ): ActualUsageImportResult;
}

/**
 * Interface for mapping one raw row (key-value pairs from a CSV or JSON record)
 * into a safe `ActualUsageRecord`.
 *
 * Implementations handle the field name variations between provider formats
 * and apply privacy rules (hashing/redacting user identifiers, skipping unsafe
 * fields).
 */
export interface UsageImportMapper {
  /** Source format this mapper handles. */
  readonly source: ActualUsageImportSource;
  /**
   * Maps one raw row to a safe usage record.
   *
   * @param row - Raw key-value pairs from the parsed CSV or JSON.
   * @param sourceFileName - File name for attribution.
   * @param options - Import options controlling privacy handling.
   * @returns A safe record, or null if the row should be skipped.
   */
  mapRow(
    row: Record<string, string>,
    sourceFileName: string,
    options?: UsageImportOptions
  ): ActualUsageRecord | null;
}

/**
 * Match status categories for reconciling estimated framework runs with
 * imported actual usage records.
 *
 * Strong matches (run-id, trace-id) allow accurate delta computation.
 * Weak matches (timestamp window, client/model label) are approximate.
 * Unmatched entries are reported separately so the user can investigate gaps.
 */
export type ReconciliationMatchStatus =
  | "matched-run-id"
  | "matched-trace-id"
  | "matched-timestamp-window"
  | "matched-client-model"
  | "unmatched-estimated"
  | "unmatched-actual";

/**
 * One entry in a reconciliation report: either a matched pair of
 * estimated vs actual usage, or an unmatched record from either side.
 */
export type UsageReconciliationEntry = {
  /** How this entry was matched (or why it is unmatched). */
  readonly matchStatus: ReconciliationMatchStatus;
  /** Run identifier, if available from either side. */
  readonly runId?: string;
  /** Trace identifier, if available from either side. */
  readonly traceId?: string;
  /** Client label (e.g. "codex", "claude-code"). */
  readonly client?: string;
  /** Model identifier. */
  readonly model?: string;
  /** Task type label. */
  readonly taskType?: string;
  /** Framework-estimated token count for this entry. */
  readonly estimatedTokens?: number;
  /** Imported actual token count for this entry. */
  readonly actualTokens?: number;
  /**
   * Absolute difference between actual and estimated tokens.
   * Positive means actual exceeded the estimate; negative means it was lower.
   */
  readonly delta?: number;
  /**
   * Delta as a percentage of estimated tokens.
   * Undefined when estimated tokens are zero or both sides are absent.
   */
  readonly deltaPercent?: number;
};

/**
 * Full reconciliation report comparing framework-estimated token usage with
 * imported actual provider/client usage.
 *
 * Deltas represent the gap between what the framework tracked and what the
 * provider billed. Common causes include hidden system/reasoning tokens,
 * provider-side overhead, and granularity differences in exported data.
 */
export type UsageReconciliationReport = {
  /** ISO 8601 timestamp when this report was generated. */
  readonly generatedAt: string;
  /** Number of estimated runs that were matched to an actual record. */
  readonly matchedCount: number;
  /** Number of estimated runs with no matching actual record. */
  readonly unmatchedEstimatedCount: number;
  /** Number of actual records with no matching estimated run. */
  readonly unmatchedActualCount: number;
  /** Total estimated tokens across all entries. */
  readonly totalEstimatedTokens: number;
  /** Total actual tokens across all entries. */
  readonly totalActualTokens: number;
  /** Total delta (actual minus estimated) across all matched entries. */
  readonly totalDelta: number;
  /**
   * Total delta as a percentage of total estimated tokens.
   * Zero when estimated total is zero.
   */
  readonly totalDeltaPercent: number;
  /** All reconciliation entries including matched and unmatched. */
  readonly entries: readonly UsageReconciliationEntry[];
  /**
   * Human-readable notes explaining why deltas may exist.
   * Always present to remind the user that framework estimates are not exact
   * provider billing figures.
   */
  readonly possibleCauses: readonly string[];
};

/**
 * Per-client comparison of estimated framework usage vs imported actual usage.
 *
 * When `hasActualData` is false, the comparison is framework-estimated only
 * and must be clearly labeled as an estimate in any consumer UI.
 *
 * When `hasActualData` is true, delta values reflect real differences between
 * what the framework tracked and what the provider reported.
 */
export type EstimatedVsActualComparison = {
  /** Client label (e.g. "codex", "claude-code", "generic-mcp-client"). */
  readonly client: string;
  /** Framework-estimated token count for this client. */
  readonly estimatedTokens: number;
  /**
   * Imported actual token count for this client.
   * Undefined when no import data exists for this client.
   */
  readonly actualTokens?: number;
  /** True when imported actual data is available for this client. */
  readonly hasActualData: boolean;
  /** Absolute delta (actual minus estimated). Undefined without actual data. */
  readonly delta?: number;
  /** Delta as percentage of estimated tokens. Undefined without actual data. */
  readonly deltaPercent?: number;
  /**
   * Confidence level of the comparison.
   * Reflects the confidence of the underlying actual records, or "estimated"
   * when no actual data exists.
   */
  readonly confidence: UsageImportConfidence;
  /**
   * Notes for the consumer UI, including truthfulness labels.
   * Always explains whether numbers are estimated, actual, or partial.
   */
  readonly notes: readonly string[];
};

/**
 * Benchmark comparison mode controlling which data sources are used.
 *
 * - estimated-only: Show only framework-estimated visible token counts.
 * - actual-imported-only: Show only imported actual records; omit estimates.
 * - estimated-vs-actual: Show both and compute delta. Requires imported data.
 */
export type BenchmarkComparisonMode =
  | "estimated-only"
  | "actual-imported-only"
  | "estimated-vs-actual";

/**
 * Options for one usage import operation.
 *
 * `maxRows` and `maxFileSizeBytes` limit resource usage and prevent accidental
 * ingestion of extremely large exports. `hashUserIds` and `redactUserIds`
 * control privacy handling of user identifier columns.
 */
export type UsageImportOptions = {
  /** Source format to use for parsing. */
  readonly source: ActualUsageImportSource;
  /**
   * Maximum number of data rows to parse.
   * Rows beyond this limit are skipped and counted in `skippedRows`.
   * Default: 10,000.
   */
  readonly maxRows?: number;
  /**
   * Maximum file size in bytes.
   * Files larger than this limit are rejected with a fatal error.
   * Default: 10 MB (10,485,760 bytes).
   */
  readonly maxFileSizeBytes?: number;
  /**
   * When true (default), user identifier columns are SHA-256 hashed before
   * storage so the original value is not persisted.
   */
  readonly hashUserIds?: boolean;
  /**
   * When true, user identifier columns are replaced with "[redacted]" instead
   * of being hashed. Takes precedence over `hashUserIds`.
   */
  readonly redactUserIds?: boolean;
};
