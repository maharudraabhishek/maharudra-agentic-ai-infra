import {
  type ActualUsageImportBatch,
  type ActualUsageImportResult,
  type ActualUsageImportSource,
  type ActualUsageRecord,
  type BenchmarkComparisonMode,
  type EstimatedVsActualComparison,
  type ReconciliationMatchStatus,
  type TokenEfficiencyReport,
  type UsageImportOptions,
  type UsageImportParser,
  type UsageImportMapper,
  type UsageReconciliationEntry,
  type UsageReconciliationReport
} from "@maharudra/agentic-ai-infra-core";
// Re-export the import source union so callers that depend only on the runtime
// package do not need a direct import from core for this commonly-used type.
export type { ActualUsageImportSource } from "@maharudra/agentic-ai-infra-core";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default row limit to prevent accidental ingestion of giant exports. */
const DEFAULT_MAX_ROWS = 10_000;

/** Default file size limit (10 MB). */
const DEFAULT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * Timestamp match window in milliseconds.
 * Records within this window of each other are considered a weak timestamp match.
 */
const TIMESTAMP_MATCH_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Column names that may contain prompts, task bodies, or sensitive content.
 * Rows containing these columns have those values dropped silently.
 */
const UNSAFE_COLUMN_NAMES = new Set([
  "prompt",
  "completion",
  "message",
  "messages",
  "request",
  "response",
  "input",
  "output",
  "content",
  "text",
  "body",
  "payload",
  "api_key",
  "apikey",
  "secret",
  "token",
  "password",
  "email",
  "user_email"
]);

/**
 * Column names that contain user identifiers requiring hashing or redaction.
 */
const USER_ID_COLUMN_NAMES = new Set([
  "user_id",
  "userid",
  "user",
  "account_id",
  "accountid",
  "org_user_id",
  "sub"
]);

// ---------------------------------------------------------------------------
// CSV helpers (dependency-free)
// ---------------------------------------------------------------------------

/**
 * Parses a single CSV line into fields, handling quoted fields with commas.
 *
 * This covers the RFC 4180 quoting rules used by most provider CSV exports:
 * - Fields may be quoted with double-quotes.
 * - Double-quotes inside a quoted field are escaped as "".
 * - Commas inside a quoted field do not split the field.
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const ch = line[i]!;

    if (inQuotes) {
      if (ch === '"') {
        // Peek at the next character to detect escaped double-quote.
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i += 2;
          continue;
        }

        // End of quoted field.
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }

    i++;
  }

  fields.push(current.trim());
  return fields;
}

/**
 * Parses a CSV string into a header row and data rows as key-value records.
 *
 * Returns up to `maxRows` data rows; excess rows are counted in `skipped`.
 * Rows whose column count does not match the header are skipped with a warning.
 */
function parseCsv(
  content: string,
  maxRows: number
): {
  rows: Record<string, string>[];
  skipped: number;
  warnings: string[];
  totalDataRows: number;
} {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { rows: [], skipped: 0, warnings: ["CSV file is empty."], totalDataRows: 0 };
  }

  const headers = parseCsvLine(lines[0]!).map((h) => h.toLowerCase().trim());
  const dataLines = lines.slice(1);
  const rows: Record<string, string>[] = [];
  const warnings: string[] = [];
  let skipped = 0;
  const totalDataRows = dataLines.length;

  for (let index = 0; index < dataLines.length; index++) {
    // Enforce row limit.
    if (rows.length >= maxRows) {
      skipped += dataLines.length - index;
      warnings.push(
        `Row limit of ${maxRows} reached. ${dataLines.length - index} rows skipped.`
      );
      break;
    }

    const line = dataLines[index]!;
    const fields = parseCsvLine(line);

    if (fields.length !== headers.length) {
      skipped++;
      warnings.push(
        `Row ${index + 2}: column count mismatch (expected ${headers.length}, got ${fields.length}); skipped.`
      );
      continue;
    }

    const row: Record<string, string> = {};

    for (let j = 0; j < headers.length; j++) {
      row[headers[j]!] = fields[j] ?? "";
    }

    rows.push(row);
  }

  return { rows, skipped, warnings, totalDataRows };
}

// ---------------------------------------------------------------------------
// Privacy helpers
// ---------------------------------------------------------------------------

/**
 * Applies user identifier privacy rules.
 *
 * - If `redactUserIds` is true, returns "[redacted]".
 * - If `hashUserIds` is true (default), returns a truncated SHA-256 hex hash.
 * - Otherwise returns the raw value (only when both flags are false).
 */
function handleUserId(value: string, options?: UsageImportOptions): string | undefined {
  if (!value || value.trim() === "") {
    return undefined;
  }

  if (options?.redactUserIds === true) {
    return "[redacted]";
  }

  // Hash by default; only skip hashing when explicitly set to false.
  if (options?.hashUserIds === false) {
    return value.trim();
  }

  // SHA-256 hash truncated to 16 hex chars — sufficient for correlation without
  // exposing the original value.
  return createHash("sha256").update(value.trim()).digest("hex").slice(0, 16);
}

/**
 * Strips unsafe columns (prompts, bodies, API keys) from a raw row before mapping.
 */
function stripUnsafeColumns(row: Record<string, string>): Record<string, string> {
  const safe: Record<string, string> = {};

  for (const [key, value] of Object.entries(row)) {
    if (!UNSAFE_COLUMN_NAMES.has(key.toLowerCase())) {
      safe[key] = value;
    }
  }

  return safe;
}

/**
 * Extracts and handles user identifier columns from a row.
 * Returns the hashed/redacted value, or undefined if no user ID column is present.
 */
function extractUserIdHash(
  row: Record<string, string>,
  options?: UsageImportOptions
): string | undefined {
  for (const colName of USER_ID_COLUMN_NAMES) {
    const value = row[colName];

    if (value && value.trim() !== "") {
      return handleUserId(value, options);
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Shared numeric helpers
// ---------------------------------------------------------------------------

/**
 * Parses an integer from a string, returning 0 for empty or non-numeric values.
 */
function safeInt(value: string | undefined): number {
  if (!value || value.trim() === "") {
    return 0;
  }

  const parsed = parseInt(value.replace(/,/g, ""), 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

/**
 * Parses a float from a string, returning undefined for absent or non-numeric values.
 */
function safeFloat(value: string | undefined): number | undefined {
  if (!value || value.trim() === "") {
    return undefined;
  }

  const parsed = parseFloat(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Normalizes an ISO 8601 timestamp string, returning undefined for empty/invalid.
 */
function safeTimestamp(value: string | undefined): string | undefined {
  if (!value || value.trim() === "") {
    return undefined;
  }

  // Accept any non-empty string; downstream consumers can validate stricter.
  return value.trim();
}

// ---------------------------------------------------------------------------
// Base mapper (shared field resolution logic)
// ---------------------------------------------------------------------------

/**
 * Builds a safe `ActualUsageRecord` from a pre-stripped row, applying shared
 * field resolution logic used by all format-specific mappers.
 *
 * Each mapper resolves its own field aliases before delegating here.
 */
function buildRecord(params: {
  readonly row: Record<string, string>;
  readonly provider: string;
  readonly sourceFileName: string;
  readonly importedAt: string;
  readonly options?: UsageImportOptions;
  readonly overrides?: Partial<ActualUsageRecord>;
}): ActualUsageRecord | null {
  const { row, provider, sourceFileName, importedAt, options, overrides } = params;
  const stripped = stripUnsafeColumns(row);

  const inputTokens =
    safeInt(stripped["input_tokens"]) ||
    safeInt(stripped["prompt_tokens"]) ||
    safeInt(stripped["input"]);

  const outputTokens =
    safeInt(stripped["output_tokens"]) ||
    safeInt(stripped["completion_tokens"]) ||
    safeInt(stripped["output"]);

  const totalTokens =
    safeInt(stripped["total_tokens"]) ||
    safeInt(stripped["tokens"]) ||
    inputTokens + outputTokens;

  // Skip rows with no meaningful token data.
  if (totalTokens === 0 && inputTokens === 0 && outputTokens === 0) {
    return null;
  }

  return {
    provider: overrides?.provider ?? provider,
    client: overrides?.client ?? stripped["client"] ?? stripped["tool"] ?? undefined,
    model:
      overrides?.model ??
      stripped["model"] ??
      stripped["model_id"] ??
      stripped["model_name"] ??
      undefined,
    projectId:
      overrides?.projectId ??
      stripped["project_id"] ??
      stripped["projectid"] ??
      undefined,
    workspaceId:
      overrides?.workspaceId ??
      stripped["workspace_id"] ??
      stripped["organization_id"] ??
      stripped["org_id"] ??
      undefined,
    userIdHash:
      overrides?.userIdHash ?? extractUserIdHash(stripped, options),
    taskType:
      overrides?.taskType ??
      stripped["task_type"] ??
      stripped["tasktype"] ??
      stripped["type"] ??
      undefined,
    runId:
      overrides?.runId ??
      stripped["run_id"] ??
      stripped["runid"] ??
      undefined,
    traceId:
      overrides?.traceId ??
      stripped["trace_id"] ??
      stripped["traceid"] ??
      undefined,
    timestamp:
      overrides?.timestamp ??
      safeTimestamp(stripped["timestamp"] ?? stripped["created_at"] ?? stripped["date"]),
    dateRange: overrides?.dateRange,
    inputTokens,
    outputTokens,
    cacheReadTokens:
      overrides?.cacheReadTokens ??
      (safeInt(stripped["cache_read_tokens"]) || undefined),
    cacheWriteTokens:
      overrides?.cacheWriteTokens ??
      (safeInt(stripped["cache_write_tokens"]) || undefined),
    reasoningTokens:
      overrides?.reasoningTokens ??
      (safeInt(stripped["reasoning_tokens"]) || undefined),
    totalTokens,
    cost: overrides?.cost ?? safeFloat(stripped["cost"] ?? stripped["amount"]),
    currency:
      overrides?.currency ??
      stripped["currency"] ??
      stripped["cost_currency"] ??
      undefined,
    sourceFileName,
    importedAt,
    confidence: overrides?.confidence ?? "high"
  };
}

// ---------------------------------------------------------------------------
// OpenAI CSV mapper
// ---------------------------------------------------------------------------

/**
 * Maps one row from an OpenAI usage export CSV to a safe record.
 *
 * OpenAI CSV exports typically include: date, model, n_requests,
 * n_context_tokens_total, n_generated_tokens_total, operation.
 * They do not include per-request prompt content.
 */
class OpenAICsvMapper implements UsageImportMapper {
  readonly source: ActualUsageImportSource = "openai-csv";

  mapRow(
    row: Record<string, string>,
    sourceFileName: string,
    options?: UsageImportOptions
  ): ActualUsageRecord | null {
    // OpenAI CSV uses different column names than the generic baseline.
    const normalized: Record<string, string> = { ...row };

    // Map OpenAI column names to generic names.
    if (row["n_context_tokens_total"] !== undefined) {
      normalized["input_tokens"] = row["n_context_tokens_total"] ?? "";
    }

    if (row["n_generated_tokens_total"] !== undefined) {
      normalized["output_tokens"] = row["n_generated_tokens_total"] ?? "";
    }

    // Date column is per-day aggregated in most OpenAI exports.
    if (row["date"] !== undefined) {
      normalized["timestamp"] = row["date"] ?? "";
    }

    return buildRecord({
      row: normalized,
      provider: "openai",
      sourceFileName,
      importedAt: new Date().toISOString(),
      options,
      overrides: {
        // OpenAI exports are aggregated daily; mark as approximate.
        confidence: "approximate"
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Anthropic CSV mapper
// ---------------------------------------------------------------------------

/**
 * Maps one row from an Anthropic usage export CSV to a safe record.
 *
 * Anthropic CSV exports typically include: date, model, input_tokens,
 * output_tokens, cache_creation_input_tokens, cache_read_input_tokens.
 */
class AnthropicCsvMapper implements UsageImportMapper {
  readonly source: ActualUsageImportSource = "anthropic-csv";

  mapRow(
    row: Record<string, string>,
    sourceFileName: string,
    options?: UsageImportOptions
  ): ActualUsageRecord | null {
    const normalized: Record<string, string> = { ...row };

    // Anthropic uses cache_creation and cache_read column names.
    if (row["cache_creation_input_tokens"] !== undefined) {
      normalized["cache_write_tokens"] = row["cache_creation_input_tokens"] ?? "";
    }

    if (row["cache_read_input_tokens"] !== undefined) {
      normalized["cache_read_tokens"] = row["cache_read_input_tokens"] ?? "";
    }

    return buildRecord({
      row: normalized,
      provider: "anthropic",
      sourceFileName,
      importedAt: new Date().toISOString(),
      options,
      overrides: {
        confidence: "approximate"
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Generic CSV mapper
// ---------------------------------------------------------------------------

/**
 * Maps one row from a generic or manual CSV to a safe record.
 *
 * Expects at minimum: provider (or defaults to "generic"), and at least one of
 * input_tokens / output_tokens / total_tokens.
 */
class GenericCsvMapper implements UsageImportMapper {
  readonly source: ActualUsageImportSource;

  constructor(source: ActualUsageImportSource = "generic-csv") {
    this.source = source;
  }

  mapRow(
    row: Record<string, string>,
    sourceFileName: string,
    options?: UsageImportOptions
  ): ActualUsageRecord | null {
    const provider = row["provider"]?.trim() || "generic";

    return buildRecord({
      row,
      provider,
      sourceFileName,
      importedAt: new Date().toISOString(),
      options,
      overrides: {
        confidence: "estimated"
      }
    });
  }
}

// ---------------------------------------------------------------------------
// CSV-based parsers
// ---------------------------------------------------------------------------

/**
 * Base CSV parser that handles size/row validation and delegates row mapping
 * to a format-specific `UsageImportMapper`.
 */
function parseCsvWithMapper(
  source: ActualUsageImportSource,
  mapper: UsageImportMapper,
  content: string,
  sourceFileName: string,
  options?: UsageImportOptions
): ActualUsageImportResult {
  const maxFileSizeBytes = options?.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;
  const maxRows = options?.maxRows ?? DEFAULT_MAX_ROWS;
  const importedAt = new Date().toISOString();

  // File size check before parsing.
  const byteLength = Buffer.byteLength(content, "utf8");

  if (byteLength > maxFileSizeBytes) {
    return {
      ok: false,
      errors: [
        `File size ${byteLength} bytes exceeds limit of ${maxFileSizeBytes} bytes. ` +
          `Split the file or increase maxFileSizeBytes.`
      ],
      warnings: []
    };
  }

  const { rows, skipped, warnings: csvWarnings, totalDataRows } = parseCsv(content, maxRows);

  if (rows.length === 0) {
    return {
      ok: false,
      errors: ["CSV produced no data rows. Check the file format and column headers."],
      warnings: csvWarnings
    };
  }

  const records: ActualUsageRecord[] = [];
  let skippedByMapper = 0;
  const mapWarnings: string[] = [];

  for (let index = 0; index < rows.length; index++) {
    const record = mapper.mapRow(rows[index]!, sourceFileName, options);

    if (record === null) {
      skippedByMapper++;
      mapWarnings.push(`Row ${index + 2}: no token data found; skipped.`);
    } else {
      records.push({ ...record, importedAt });
    }
  }

  return {
    ok: true,
    batch: {
      source,
      sourceFileName,
      importedAt,
      records,
      skippedRows: skipped + skippedByMapper,
      totalRows: totalDataRows
    },
    errors: [],
    warnings: [...csvWarnings, ...mapWarnings]
  };
}

// ---------------------------------------------------------------------------
// Anthropic JSON parser
// ---------------------------------------------------------------------------

/**
 * Parses an Anthropic usage API JSON response into safe usage records.
 *
 * The Anthropic usage API returns an array of usage objects or an object with
 * a `data` array. This parser handles both shapes.
 *
 * Expected fields per record: model, input_tokens, output_tokens,
 * cache_creation_input_tokens, cache_read_input_tokens, timestamp / date.
 */
class AnthropicUsageApiJsonParser implements UsageImportParser {
  readonly source: ActualUsageImportSource = "anthropic-usage-api-json";

  parse(
    content: string,
    sourceFileName: string,
    options?: UsageImportOptions
  ): ActualUsageImportResult {
    const maxFileSizeBytes = options?.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;
    const maxRows = options?.maxRows ?? DEFAULT_MAX_ROWS;
    const importedAt = new Date().toISOString();

    const byteLength = Buffer.byteLength(content, "utf8");

    if (byteLength > maxFileSizeBytes) {
      return {
        ok: false,
        errors: [
          `File size ${byteLength} bytes exceeds limit of ${maxFileSizeBytes} bytes.`
        ],
        warnings: []
      };
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(content);
    } catch {
      return {
        ok: false,
        errors: ["Failed to parse JSON. Verify the file is valid JSON."],
        warnings: []
      };
    }

    // Normalize to an array. Accept both `{ data: [...] }` and `[...]`.
    let items: unknown[];

    if (Array.isArray(parsed)) {
      items = parsed;
    } else if (
      typeof parsed === "object" &&
      parsed !== null &&
      "data" in parsed &&
      Array.isArray((parsed as Record<string, unknown>)["data"])
    ) {
      items = (parsed as Record<string, unknown>)["data"] as unknown[];
    } else {
      return {
        ok: false,
        errors: [
          "Expected a JSON array or an object with a 'data' array. " +
            "Check the Anthropic usage API response format."
        ],
        warnings: []
      };
    }

    const records: ActualUsageRecord[] = [];
    const warnings: string[] = [];
    let skipped = 0;

    for (let index = 0; index < items.length; index++) {
      if (records.length >= maxRows) {
        skipped += items.length - index;
        warnings.push(
          `Row limit of ${maxRows} reached. ${items.length - index} records skipped.`
        );
        break;
      }

      const item = items[index];

      if (typeof item !== "object" || item === null) {
        skipped++;
        warnings.push(`Record ${index}: not an object; skipped.`);
        continue;
      }

      // Convert to a Record<string, string> for the shared buildRecord helper.
      const row: Record<string, string> = {};

      for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
        if (typeof value === "string" || typeof value === "number") {
          row[key.toLowerCase()] = String(value);
        }
      }

      // Map Anthropic-specific fields.
      if (row["cache_creation_input_tokens"] !== undefined) {
        row["cache_write_tokens"] = row["cache_creation_input_tokens"];
      }

      if (row["cache_read_input_tokens"] !== undefined) {
        row["cache_read_tokens"] = row["cache_read_input_tokens"];
      }

      const record = buildRecord({
        row,
        provider: "anthropic",
        sourceFileName,
        importedAt,
        options,
        overrides: { confidence: "high" }
      });

      if (record === null) {
        skipped++;
        warnings.push(`Record ${index}: no token data found; skipped.`);
      } else {
        records.push(record);
      }
    }

    return {
      ok: true,
      batch: {
        source: this.source,
        sourceFileName,
        importedAt,
        records,
        skippedRows: skipped,
        totalRows: items.length
      },
      errors: [],
      warnings
    };
  }
}

// ---------------------------------------------------------------------------
// Manual JSON parser
// ---------------------------------------------------------------------------

/**
 * Parses a user-maintained JSON array of usage records.
 *
 * Accepts any JSON array where each item contains at least one token count
 * field. Items that pass `buildRecord` with non-zero tokens are included.
 * Does not require any specific field names beyond having some token count.
 */
class ManualJsonParser implements UsageImportParser {
  readonly source: ActualUsageImportSource = "manual-json";

  parse(
    content: string,
    sourceFileName: string,
    options?: UsageImportOptions
  ): ActualUsageImportResult {
    const maxFileSizeBytes = options?.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;
    const maxRows = options?.maxRows ?? DEFAULT_MAX_ROWS;
    const importedAt = new Date().toISOString();

    const byteLength = Buffer.byteLength(content, "utf8");

    if (byteLength > maxFileSizeBytes) {
      return {
        ok: false,
        errors: [
          `File size ${byteLength} bytes exceeds limit of ${maxFileSizeBytes} bytes.`
        ],
        warnings: []
      };
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(content);
    } catch {
      return {
        ok: false,
        errors: ["Failed to parse JSON. Verify the file is valid JSON."],
        warnings: []
      };
    }

    if (!Array.isArray(parsed)) {
      return {
        ok: false,
        errors: ["Expected a JSON array. Each element should be a usage record object."],
        warnings: []
      };
    }

    const items = parsed as unknown[];
    const records: ActualUsageRecord[] = [];
    const warnings: string[] = [];
    let skipped = 0;

    for (let index = 0; index < items.length; index++) {
      if (records.length >= maxRows) {
        skipped += items.length - index;
        warnings.push(`Row limit of ${maxRows} reached. ${items.length - index} records skipped.`);
        break;
      }

      const item = items[index];

      if (typeof item !== "object" || item === null) {
        skipped++;
        warnings.push(`Item ${index}: not an object; skipped.`);
        continue;
      }

      const row: Record<string, string> = {};

      for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
        if (typeof value === "string" || typeof value === "number") {
          row[key.toLowerCase()] = String(value);
        }
      }

      const provider = row["provider"]?.trim() || "manual";
      const record = buildRecord({
        row,
        provider,
        sourceFileName,
        importedAt,
        options,
        overrides: { confidence: "estimated" }
      });

      if (record === null) {
        skipped++;
        warnings.push(`Item ${index}: no token data found; skipped.`);
      } else {
        records.push(record);
      }
    }

    return {
      ok: true,
      batch: {
        source: this.source,
        sourceFileName,
        importedAt,
        records,
        skippedRows: skipped,
        totalRows: items.length
      },
      errors: [],
      warnings
    };
  }
}

// ---------------------------------------------------------------------------
// CSV parser implementations
// ---------------------------------------------------------------------------

/**
 * Parses an OpenAI usage export CSV file.
 *
 * Handles the OpenAI dashboard export format which uses `n_context_tokens_total`
 * and `n_generated_tokens_total` as column names and aggregates per day.
 */
export class OpenAICsvParser implements UsageImportParser {
  readonly source: ActualUsageImportSource = "openai-csv";
  private readonly mapper = new OpenAICsvMapper();

  parse(
    content: string,
    sourceFileName: string,
    options?: UsageImportOptions
  ): ActualUsageImportResult {
    return parseCsvWithMapper(this.source, this.mapper, content, sourceFileName, options);
  }
}

/**
 * Parses an Anthropic usage export CSV file.
 *
 * Handles the Anthropic console export format which uses `input_tokens`,
 * `output_tokens`, `cache_creation_input_tokens`, and `cache_read_input_tokens`.
 */
export class AnthropicCsvParser implements UsageImportParser {
  readonly source: ActualUsageImportSource = "anthropic-csv";
  private readonly mapper = new AnthropicCsvMapper();

  parse(
    content: string,
    sourceFileName: string,
    options?: UsageImportOptions
  ): ActualUsageImportResult {
    return parseCsvWithMapper(this.source, this.mapper, content, sourceFileName, options);
  }
}

/**
 * Parses a manual or generic CSV file.
 *
 * Accepts any CSV with at least a provider column and one token count column.
 * Column headers are matched case-insensitively. Use this format when you are
 * maintaining your own usage tracking spreadsheet.
 */
export class ManualCsvParser implements UsageImportParser {
  readonly source: ActualUsageImportSource;
  private readonly mapper: GenericCsvMapper;

  constructor(source: ActualUsageImportSource = "manual-csv") {
    this.source = source;
    this.mapper = new GenericCsvMapper(source);
  }

  parse(
    content: string,
    sourceFileName: string,
    options?: UsageImportOptions
  ): ActualUsageImportResult {
    return parseCsvWithMapper(this.source, this.mapper, content, sourceFileName, options);
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Registry of all built-in usage import parsers indexed by source format.
 *
 * Call `getUsageImportParser(source)` to resolve the appropriate parser for a
 * given format string without needing to reference the concrete classes.
 */
const PARSER_REGISTRY: ReadonlyMap<ActualUsageImportSource, UsageImportParser> = new Map([
  ["openai-csv", new OpenAICsvParser()],
  ["anthropic-usage-api-json", new AnthropicUsageApiJsonParser()],
  ["anthropic-csv", new AnthropicCsvParser()],
  ["manual-json", new ManualJsonParser()],
  ["manual-csv", new ManualCsvParser("manual-csv")],
  ["generic-csv", new ManualCsvParser("generic-csv")]
]);

/**
 * Returns the registered parser for the given source format, or undefined
 * when no parser is registered for that source.
 */
export function getUsageImportParser(
  source: ActualUsageImportSource
): UsageImportParser | undefined {
  return PARSER_REGISTRY.get(source);
}

// ---------------------------------------------------------------------------
// Main import entry point
// ---------------------------------------------------------------------------

/**
 * Imports actual usage data from raw file content using the parser registered
 * for the given source format.
 *
 * This is the main entry point for the generated `import-usage.ts` entrypoint
 * and for programmatic consumers in the runtime.
 *
 * @param content - Raw text content of the usage export file.
 * @param sourceFileName - File name for attribution and audit records.
 * @param options - Import options including source format, limits, and privacy settings.
 * @returns A structured import result with records, warnings, and any errors.
 *
 * @example
 * ```typescript
 * const result = importActualUsage(csvContent, "openai-usage.csv", {
 *   source: "openai-csv",
 *   hashUserIds: true
 * });
 *
 * if (result.ok && result.batch) {
 *   console.log(`Imported ${result.batch.records.length} records`);
 * }
 * ```
 */
export function importActualUsage(
  content: string,
  sourceFileName: string,
  options: UsageImportOptions
): ActualUsageImportResult {
  const parser = getUsageImportParser(options.source);

  if (!parser) {
    return {
      ok: false,
      errors: [
        `No parser registered for source "${options.source}". ` +
          `Supported sources: openai-csv, anthropic-usage-api-json, anthropic-csv, ` +
          `manual-json, manual-csv, generic-csv.`
      ],
      warnings: []
    };
  }

  return parser.parse(content, sourceFileName, options);
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

/** Standard delta calculation, guarded against division by zero. */
function computeDelta(
  estimated: number,
  actual: number
): { delta: number; deltaPercent: number } {
  const delta = actual - estimated;
  const deltaPercent =
    estimated > 0 ? Math.round((delta / estimated) * 10000) / 100 : 0;
  return { delta, deltaPercent };
}

/**
 * Reconciles framework-estimated token records with imported actual usage records.
 *
 * Matching priority:
 * 1. `runId` exact match
 * 2. `traceId` exact match
 * 3. Timestamp within `TIMESTAMP_MATCH_WINDOW_MS` of each other
 * 4. `client` + `model` label match (weakest, marked as such)
 *
 * Unmatched entries from both sides are included in the report so the user can
 * investigate gaps. The `possibleCauses` field always explains why deltas exist.
 *
 * @param estimatedRecords - Safe token usage records from the framework recorder.
 * @param actualBatches - Imported actual usage batches.
 * @returns A full reconciliation report.
 */
export function reconcileUsage(
  estimatedRecords: readonly {
    readonly runId: string;
    readonly traceId?: string;
    readonly client?: string;
    readonly model?: string;
    readonly taskType?: string;
    readonly estimatedTokens: number;
    readonly timestamp?: string;
  }[],
  actualBatches: readonly ActualUsageImportBatch[]
): UsageReconciliationReport {
  const generatedAt = new Date().toISOString();
  const entries: UsageReconciliationEntry[] = [];

  // Flatten all actual records.
  const actualRecords = actualBatches.flatMap((b) => b.records);
  const usedActual = new Set<number>();

  // Pass 1: match by runId.
  for (const est of estimatedRecords) {
    const actualIndex = actualRecords.findIndex(
      (a, i) => !usedActual.has(i) && a.runId !== undefined && a.runId === est.runId
    );

    if (actualIndex >= 0) {
      const actual = actualRecords[actualIndex]!;
      usedActual.add(actualIndex);
      const { delta, deltaPercent } = computeDelta(est.estimatedTokens, actual.totalTokens);
      entries.push({
        matchStatus: "matched-run-id",
        runId: est.runId,
        traceId: est.traceId ?? actual.traceId,
        client: est.client ?? actual.client,
        model: est.model ?? actual.model,
        taskType: est.taskType ?? actual.taskType,
        estimatedTokens: est.estimatedTokens,
        actualTokens: actual.totalTokens,
        delta,
        deltaPercent
      });
    }
  }

  // Pass 2: match remaining by traceId.
  for (const est of estimatedRecords) {
    const alreadyMatched = entries.some(
      (e) => e.runId === est.runId && e.matchStatus === "matched-run-id"
    );

    if (alreadyMatched) {
      continue;
    }

    if (!est.traceId) {
      continue;
    }

    const actualIndex = actualRecords.findIndex(
      (a, i) =>
        !usedActual.has(i) && a.traceId !== undefined && a.traceId === est.traceId
    );

    if (actualIndex >= 0) {
      const actual = actualRecords[actualIndex]!;
      usedActual.add(actualIndex);
      const { delta, deltaPercent } = computeDelta(est.estimatedTokens, actual.totalTokens);
      entries.push({
        matchStatus: "matched-trace-id",
        runId: est.runId,
        traceId: est.traceId,
        client: est.client ?? actual.client,
        model: est.model ?? actual.model,
        taskType: est.taskType ?? actual.taskType,
        estimatedTokens: est.estimatedTokens,
        actualTokens: actual.totalTokens,
        delta,
        deltaPercent
      });
    }
  }

  // Pass 3: match remaining by timestamp window.
  for (const est of estimatedRecords) {
    const alreadyMatched = entries.some(
      (e) => e.runId === est.runId
    );

    if (alreadyMatched || !est.timestamp) {
      continue;
    }

    const estTime = new Date(est.timestamp).getTime();

    if (!Number.isFinite(estTime)) {
      continue;
    }

    const actualIndex = actualRecords.findIndex((a, i) => {
      if (usedActual.has(i) || !a.timestamp) {
        return false;
      }

      const actualTime = new Date(a.timestamp).getTime();

      if (!Number.isFinite(actualTime)) {
        return false;
      }

      return Math.abs(estTime - actualTime) <= TIMESTAMP_MATCH_WINDOW_MS;
    });

    if (actualIndex >= 0) {
      const actual = actualRecords[actualIndex]!;
      usedActual.add(actualIndex);
      const { delta, deltaPercent } = computeDelta(est.estimatedTokens, actual.totalTokens);
      entries.push({
        matchStatus: "matched-timestamp-window",
        runId: est.runId,
        traceId: est.traceId,
        client: est.client ?? actual.client,
        model: est.model ?? actual.model,
        taskType: est.taskType,
        estimatedTokens: est.estimatedTokens,
        actualTokens: actual.totalTokens,
        delta,
        deltaPercent
      });
    }
  }

  // Pass 4: match remaining by client + model label.
  for (const est of estimatedRecords) {
    const alreadyMatched = entries.some((e) => e.runId === est.runId);

    if (alreadyMatched || !est.client || !est.model) {
      continue;
    }

    const actualIndex = actualRecords.findIndex(
      (a, i) =>
        !usedActual.has(i) &&
        a.client === est.client &&
        a.model === est.model
    );

    if (actualIndex >= 0) {
      const actual = actualRecords[actualIndex]!;
      usedActual.add(actualIndex);
      const { delta, deltaPercent } = computeDelta(est.estimatedTokens, actual.totalTokens);
      entries.push({
        matchStatus: "matched-client-model",
        runId: est.runId,
        traceId: est.traceId,
        client: est.client,
        model: est.model,
        taskType: est.taskType,
        estimatedTokens: est.estimatedTokens,
        actualTokens: actual.totalTokens,
        delta,
        deltaPercent
      });
    }
  }

  // Collect unmatched estimated runs.
  for (const est of estimatedRecords) {
    const matched = entries.some((e) => e.runId === est.runId);

    if (!matched) {
      entries.push({
        matchStatus: "unmatched-estimated",
        runId: est.runId,
        traceId: est.traceId,
        client: est.client,
        model: est.model,
        taskType: est.taskType,
        estimatedTokens: est.estimatedTokens
      });
    }
  }

  // Collect unmatched actual records.
  for (let i = 0; i < actualRecords.length; i++) {
    if (!usedActual.has(i)) {
      const actual = actualRecords[i]!;
      entries.push({
        matchStatus: "unmatched-actual",
        runId: actual.runId,
        traceId: actual.traceId,
        client: actual.client,
        model: actual.model,
        taskType: actual.taskType,
        actualTokens: actual.totalTokens
      });
    }
  }

  // Aggregate totals from matched entries only.
  const matchedEntries = entries.filter(
    (e) =>
      e.matchStatus !== "unmatched-estimated" && e.matchStatus !== "unmatched-actual"
  );

  const totalEstimatedTokens = entries.reduce(
    (sum, e) => sum + (e.estimatedTokens ?? 0),
    0
  );

  const totalActualTokens = entries.reduce(
    (sum, e) => sum + (e.actualTokens ?? 0),
    0
  );

  const totalDelta = totalActualTokens - totalEstimatedTokens;
  const totalDeltaPercent =
    totalEstimatedTokens > 0
      ? Math.round((totalDelta / totalEstimatedTokens) * 10000) / 100
      : 0;

  const unmatchedEstimatedCount = entries.filter(
    (e) => e.matchStatus === "unmatched-estimated"
  ).length;

  const unmatchedActualCount = entries.filter(
    (e) => e.matchStatus === "unmatched-actual"
  ).length;

  return {
    generatedAt,
    matchedCount: matchedEntries.length,
    unmatchedEstimatedCount,
    unmatchedActualCount,
    totalEstimatedTokens,
    totalActualTokens,
    totalDelta,
    totalDeltaPercent,
    entries,
    possibleCauses: [
      "Hidden reasoning tokens billed by the provider are not visible to the framework.",
      "Provider system prompt tokens are not tracked by the framework.",
      "Streaming overhead and retries may be billed but are not captured.",
      "Imported data may be grouped at a different granularity (e.g. daily aggregates vs per-run).",
      "Missing runId or traceId prevents strong matching; weak matches may pair unrelated records.",
      "Client-side context tokens assembled outside the framework are not counted."
    ]
  };
}

// ---------------------------------------------------------------------------
// Estimated vs actual comparison builder
// ---------------------------------------------------------------------------

/**
 * Builds per-client estimated-vs-actual comparison summaries from a
 * reconciliation report and benchmark mode.
 *
 * In `estimated-only` mode, no actual data is required; all comparisons are
 * clearly labeled as estimates.
 *
 * In `actual-imported-only` mode, clients with no imported data are omitted.
 *
 * In `estimated-vs-actual` mode, both sides are shown; clients missing actual
 * data are included with `hasActualData: false` and appropriate notes.
 *
 * @param report - The reconciliation report from `reconcileUsage`.
 * @param mode - Benchmark comparison mode.
 * @returns Array of per-client comparisons with truthfulness labels.
 */
export function buildEstimatedVsActualComparisons(
  report: UsageReconciliationReport,
  mode: BenchmarkComparisonMode = "estimated-vs-actual"
): EstimatedVsActualComparison[] {
  // Aggregate by client.
  const byClient = new Map<
    string,
    { estimated: number; actual: number; hasActual: boolean }
  >();

  for (const entry of report.entries) {
    const client = entry.client ?? "unknown";
    const existing = byClient.get(client) ?? { estimated: 0, actual: 0, hasActual: false };

    byClient.set(client, {
      estimated: existing.estimated + (entry.estimatedTokens ?? 0),
      actual: existing.actual + (entry.actualTokens ?? 0),
      hasActual: existing.hasActual || entry.actualTokens !== undefined
    });
  }

  const comparisons: EstimatedVsActualComparison[] = [];

  for (const [client, data] of byClient.entries()) {
    if (mode === "actual-imported-only" && !data.hasActual) {
      continue;
    }

    if (mode === "estimated-only") {
      comparisons.push({
        client,
        estimatedTokens: data.estimated,
        hasActualData: false,
        confidence: "estimated",
        notes: [
          "Estimated visible framework tokens only.",
          "Hidden provider system/reasoning tokens are not included.",
          "Import actual usage data to enable a real comparison."
        ]
      });
      continue;
    }

    // estimated-vs-actual or actual-imported-only with actual data.
    const hasActual = data.hasActual;
    const { delta, deltaPercent } = hasActual
      ? computeDelta(data.estimated, data.actual)
      : { delta: 0, deltaPercent: 0 };

    const notes: string[] = [];

    if (hasActual) {
      notes.push("Imported actual provider/client usage.");
      notes.push("Delta may include hidden system/reasoning/client overhead.");

      if (Math.abs(deltaPercent) > 50) {
        notes.push(
          "Large delta detected. Consider whether the imported data granularity " +
            "matches the estimated run granularity."
        );
      }
    } else {
      notes.push("No imported actual data for this client.");
      notes.push("Showing estimated visible framework tokens only.");
    }

    comparisons.push({
      client,
      estimatedTokens: data.estimated,
      actualTokens: hasActual ? data.actual : undefined,
      hasActualData: hasActual,
      delta: hasActual ? delta : undefined,
      deltaPercent: hasActual ? deltaPercent : undefined,
      confidence: hasActual ? "high" : "estimated",
      notes
    });
  }

  return comparisons;
}

// ---------------------------------------------------------------------------
// Usage import summary (for dashboard snapshot)
// ---------------------------------------------------------------------------

/**
 * Builds a safe dashboard-ready summary from one or more import batches.
 *
 * The returned summary contains only numeric counts and source labels —
 * no individual usage records, no file paths, and no identifiers.
 */
export function buildUsageImportSummary(batches: readonly ActualUsageImportBatch[]): {
  readonly totalImportedRecords: number;
  readonly sources: readonly string[];
  readonly totalActualTokens: number;
  readonly totalActualCost?: number;
  readonly currency?: string;
} {
  const totalImportedRecords = batches.reduce((sum, b) => sum + b.records.length, 0);
  const sources = [...new Set(batches.map((b) => b.source))];
  const totalActualTokens = batches
    .flatMap((b) => b.records)
    .reduce((sum, r) => sum + r.totalTokens, 0);

  const costsWithCurrency = batches
    .flatMap((b) => b.records)
    .filter((r) => r.cost !== undefined && r.currency !== undefined);

  const totalActualCost =
    costsWithCurrency.length > 0
      ? costsWithCurrency.reduce((sum, r) => sum + (r.cost ?? 0), 0)
      : undefined;

  // Use the most common currency, or undefined if mixed.
  const currencyCounts = new Map<string, number>();

  for (const r of costsWithCurrency) {
    if (r.currency) {
      currencyCounts.set(r.currency, (currencyCounts.get(r.currency) ?? 0) + 1);
    }
  }

  const dominantCurrency =
    currencyCounts.size === 1
      ? [...currencyCounts.keys()][0]
      : currencyCounts.size > 1
        ? undefined
        : undefined;

  return {
    totalImportedRecords,
    sources,
    totalActualTokens,
    totalActualCost,
    currency: dominantCurrency
  };
}

/**
 * Builds a safe reconciliation summary from a full reconciliation report.
 *
 * Contains only aggregate counts and totals — no individual run or record data.
 */
export function buildReconciliationSummary(
  report: UsageReconciliationReport
): {
  readonly matchedCount: number;
  readonly unmatchedEstimatedCount: number;
  readonly unmatchedActualCount: number;
  readonly totalEstimatedTokens: number;
  readonly totalActualTokens: number;
  readonly totalDelta: number;
  readonly totalDeltaPercent: number;
} {
  return {
    matchedCount: report.matchedCount,
    unmatchedEstimatedCount: report.unmatchedEstimatedCount,
    unmatchedActualCount: report.unmatchedActualCount,
    totalEstimatedTokens: report.totalEstimatedTokens,
    totalActualTokens: report.totalActualTokens,
    totalDelta: report.totalDelta,
    totalDeltaPercent: report.totalDeltaPercent
  };
}
