import { APP_LOG_FILE } from "../config/mcp-config.js";
import type {
  OperationStatus,
  OperationType,
  SafeLogMetadata,
  SafeLogValue,
  TraceContext
} from "../core/types.js";
import { appendJsonLine } from "../utils/jsonl.js";
import { sha256 } from "../utils/crypto.js";
import { createTraceContext, getDurationMs } from "./trace.js";

const SENSITIVE_METADATA_KEY =
  /(secret|token|password|credential|private|output|stdout|stderr|originaltext|replacementtext|approvaltext|rawproposal|rawpatch|filecontent|^text$|commandoutput|fullcontent|patchbody|^content$|^query$|^task$|context|chunk|embedding|vector|sql|pathprefixes)/i;

const DERIVED_TEXT_METADATA_KEYS = new Map<string, string>([
  ["query", "query"],
  ["task", "task"],
  ["context", "context"]
]);

const ALLOWED_DERIVED_METADATA_KEY =
  /^(query|task|context)(Sha256|Length)$|^(file|content|original|replacement)Sha256$/;

const ALLOWED_SAFE_METADATA_KEYS = new Set([
  "includeSecurityContext",
  "includeArchitectureContext",
  "contextChars",
  "maxContextChars",
  "returnedChunks",
  "returnedSources"
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeValue(value: unknown): SafeLogValue {
  if (value === null) {
    return null;
  }

  if (typeof value === "string") {
    return value.length > 500 ? `${value.slice(0, 500)}[truncated]` : value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeValue(item));
  }

  if (isPlainObject(value)) {
    return sanitizeLogMetadata(value);
  }

  return String(value);
}

function addDerivedTextMetadata(params: {
  sanitized: SafeLogMetadata;
  key: string;
  value: unknown;
}): void {
  if (typeof params.value !== "string") {
    return;
  }

  const derivedPrefix = DERIVED_TEXT_METADATA_KEYS.get(params.key.toLowerCase());

  if (!derivedPrefix) {
    return;
  }

  params.sanitized[`${derivedPrefix}Sha256`] = sha256(params.value);
  params.sanitized[`${derivedPrefix}Length`] = params.value.length;
}

function addDerivedCountMetadata(params: {
  sanitized: SafeLogMetadata;
  key: string;
  value: unknown;
}): void {
  if (!Array.isArray(params.value)) {
    return;
  }

  const normalizedKey = params.key.toLowerCase();

  if (normalizedKey === "pathprefixes") {
    params.sanitized.pathPrefixFilterCount = params.value.length;
  }

  if (normalizedKey === "sourcetypes") {
    params.sanitized.sourceTypeFilterCount = params.value.length;
  }
}

function isSensitiveMetadataKey(key: string): boolean {
  if (ALLOWED_SAFE_METADATA_KEYS.has(key)) {
    return false;
  }

  if (ALLOWED_DERIVED_METADATA_KEY.test(key)) {
    return false;
  }

  return SENSITIVE_METADATA_KEY.test(key);
}

/**
 * Scrub metadata before it reaches disk.
 *
 * Normal app logs must never contain full file contents, patch bodies, command
 * output, approval text, or secret-shaped values. If a key looks risky, omit
 * the field entirely so later summaries cannot expose even sensitive key names.
 */
export function sanitizeLogMetadata(
  metadata: Record<string, unknown> = {}
): SafeLogMetadata {
  const sanitized: SafeLogMetadata = {};

  for (const [key, value] of Object.entries(metadata)) {
    addDerivedTextMetadata({ sanitized, key, value });
    addDerivedCountMetadata({ sanitized, key, value });

    if (isSensitiveMetadataKey(key)) {
      continue;
    }

    sanitized[key] = sanitizeValue(value);
  }

  return sanitized;
}

export async function writeAppLog(params: {
  traceContext?: TraceContext;
  toolName: string;
  operationType: OperationType;
  status: OperationStatus;
  durationMs?: number;
  metadata?: Record<string, unknown>;
  errorMessage?: string;
}): Promise<void> {
  const {
    traceContext,
    toolName,
    operationType,
    status,
    durationMs,
    metadata,
    errorMessage
  } = params;

  await appendJsonLine(APP_LOG_FILE, {
    timestamp: new Date().toISOString(),
    traceId: traceContext?.traceId,
    spanId: traceContext?.spanId,
    toolName,
    operationType,
    status,
    durationMs,
    metadata: sanitizeLogMetadata(metadata),
    parentSpanId: traceContext?.parentSpanId,
    errorMessage: errorMessage
      ? sanitizeValue(errorMessage)
      : undefined
  });
}

function getStatusFromError(error: unknown): OperationStatus {
  const message = error instanceof Error ? error.message : String(error);

  return /access denied|denied|invalid .*format|must exactly equal/i.test(message)
    ? "denied"
    : "error";
}

/**
 * Wrap every tool handler with telemetry while keeping stdout untouched.
 *
 * STDIO MCP servers use stdout for protocol messages, so diagnostics must go to
 * local JSONL files instead of console.log.
 */
export function withToolTelemetry<Input, Result>(
  toolName: string,
  operationType: OperationType,
  handler: (input: Input, traceContext: TraceContext) => Promise<Result>
): (input: Input) => Promise<Result> {
  return async (input: Input): Promise<Result> => {
    const traceContext = createTraceContext(toolName, operationType);

    await writeAppLog({
      traceContext,
      toolName,
      operationType,
      status: "attempt",
      metadata: input as Record<string, unknown>
    });

    try {
      const result = await handler(input, traceContext);

      await writeAppLog({
        traceContext,
        toolName,
        operationType,
        status: "success",
        durationMs: getDurationMs(traceContext)
      });

      return result;
    } catch (error) {
      await writeAppLog({
        traceContext,
        toolName,
        operationType,
        status: getStatusFromError(error),
        durationMs: getDurationMs(traceContext),
        errorMessage: error instanceof Error ? error.message : String(error)
      });

      throw error;
    }
  };
}
