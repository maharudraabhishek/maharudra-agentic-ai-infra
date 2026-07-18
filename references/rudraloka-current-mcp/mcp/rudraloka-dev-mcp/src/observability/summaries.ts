import fs from "node:fs/promises";
import path from "node:path";
import {
  APP_LOG_FILE,
  AUDIT_LOG_DIR,
  MAX_LOG_SUMMARY_LIMIT
} from "../config/mcp-config.js";

const AUDIT_LOG_FILE = path.join(AUDIT_LOG_DIR, "audit.jsonl");

const SUMMARY_FIELD_ALLOWLIST = new Set([
  "timestamp",
  "level",
  "eventType",
  "traceId",
  "spanId",
  "parentSpanId",
  "toolName",
  "operationType",
  "status",
  "durationMs",
  "filePath",
  "directory",
  "packageName",
  "script",
  "patchId",
  "proposalId",
  "message",
  "appliedCount",
  "pendingCount",
  "originalSha256",
  "replacementSha256",
  "contentSha256",
  "querySha256",
  "queryLength",
  "taskSha256",
  "taskLength",
  "contextSha256",
  "contextLength",
  "suiteName",
  "total",
  "passed",
  "failed",
  "skipped",
  "failedCaseNames",
  "errorCode",
  "filesScanned",
  "filesIndexed",
  "filesSkipped",
  "preSkippedFiles",
  "postSkippedFiles",
  "changedFiles",
  "unchangedFiles",
  "chunksCreated",
  "chunksEmbedded",
  "clearedDocuments",
  "indexVersion",
  "embeddingModel",
  "embeddingVersion",
  "embeddingDimension",
  "topK",
  "includeArchived",
  "sourceTypeFilterCount",
  "pathPrefixFilterCount",
  "vectorCandidateCount",
  "fullTextCandidateCount",
  "mergedCandidateCount",
  "candidateCount",
  "resultCount",
  "sourceCount",
  "returnedChunks",
  "returnedSources",
  "contextChars",
  "truncated",
  "taskType",
  "strategy",
  "needsUserDecision",
  "includeSecurityContext",
  "includeArchitectureContext",
  "recommendedQueryCount",
  "recommendedSourceCount",
  "recommendedToolCount",
  "warningCount",
  "nextStepCount",
  "exitCode",
  "timedOut"
]);

const SUMMARY_FIELD_ALIASES = new Map<string, string>([
  ["errorMessage", "message"]
]);

type SummaryPrimitive = string | number | boolean | null;

export type SummaryEvent = Record<string, SummaryPrimitive>;

export type JsonlSummary = {
  fileExists: boolean;
  count: number;
  events: SummaryEvent[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toSummaryPrimitive(value: unknown): SummaryPrimitive | undefined {
  if (value === null) {
    return null;
  }

  if (typeof value === "string") {
    return value.length > 500 ? `${value.slice(0, 500)}[truncated]` : value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  return undefined;
}

function addAllowedSummaryField(
  event: SummaryEvent,
  key: string,
  value: unknown
): void {
  const fieldName = SUMMARY_FIELD_ALIASES.get(key) ?? key;

  if (!SUMMARY_FIELD_ALLOWLIST.has(fieldName) || event[fieldName] !== undefined) {
    return;
  }

  const safeValue = toSummaryPrimitive(value);

  if (safeValue !== undefined) {
    event[fieldName] = safeValue;
  }
}

/**
 * Summaries are a public-safe view of private local logs.
 *
 * Older JSONL records may contain redacted-but-dangerous key names such as
 * `originalText` or `content`. Use an output allowlist so summaries expose only
 * fields that were deliberately approved for model context.
 */
export function sanitizeSummaryEvent(rawEvent: unknown): SummaryEvent {
  if (!isPlainObject(rawEvent)) {
    return {
      eventType: "parse_error",
      status: "error",
      message: "Log event had an unexpected shape."
    };
  }

  if (rawEvent.parseError === true) {
    return {
      eventType: "parse_error",
      status: "error",
      message: "Log line could not be parsed."
    };
  }

  const event: SummaryEvent = {};

  for (const [key, value] of Object.entries(rawEvent)) {
    if (key !== "metadata") {
      addAllowedSummaryField(event, key, value);
    }
  }

  const metadata = rawEvent.metadata;

  if (isPlainObject(metadata)) {
    for (const [key, value] of Object.entries(metadata)) {
      addAllowedSummaryField(event, key, value);
    }
  }

  return event;
}

/**
 * Read only a bounded tail of JSONL logs.
 *
 * Summary tools never expose raw internal files wholesale. They return a small
 * parsed tail that has been defensively sanitized on output, even when older
 * local JSONL records contain fields that are no longer safe to show.
 */
export async function readJsonlSummary(params: {
  filePath: string;
  limit: number;
}): Promise<JsonlSummary> {
  const limit = Math.min(
    Math.max(Math.trunc(params.limit), 1),
    MAX_LOG_SUMMARY_LIMIT
  );

  try {
    const rawLog = await fs.readFile(params.filePath, "utf8");

    const events = rawLog
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as unknown;
        } catch {
          return { parseError: true };
        }
      })
      .slice(-limit)
      .map((event) => sanitizeSummaryEvent(event));

    return {
      fileExists: true,
      count: events.length,
      events
    };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;

    if (nodeError.code === "ENOENT") {
      return {
        fileExists: false,
        count: 0,
        events: []
      };
    }

    throw error;
  }
}

export async function readAuditSummary(params: {
  limit: number;
}): Promise<{
  auditFileExists: boolean;
  count: number;
  events: SummaryEvent[];
}> {
  const summary = await readJsonlSummary({
    filePath: AUDIT_LOG_FILE,
    limit: params.limit
  });

  return {
    auditFileExists: summary.fileExists,
    count: summary.count,
    events: summary.events
  };
}

export async function readAppLogSummary(params: {
  limit: number;
}): Promise<{
  appLogFileExists: boolean;
  count: number;
  events: SummaryEvent[];
}> {
  const summary = await readJsonlSummary({
    filePath: APP_LOG_FILE,
    limit: params.limit
  });

  return {
    appLogFileExists: summary.fileExists,
    count: summary.count,
    events: summary.events
  };
}
