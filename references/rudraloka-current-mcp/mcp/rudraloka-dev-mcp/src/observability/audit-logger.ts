import path from "node:path";
import { AUDIT_LOG_DIR } from "../config/mcp-config.js";
import type {
  OperationStatus,
  OperationType,
  TraceContext
} from "../core/types.js";
import { appendJsonLine } from "../utils/jsonl.js";
import { sanitizeLogMetadata } from "./logger.js";

const AUDIT_LOG_FILE = path.join(AUDIT_LOG_DIR, "audit.jsonl");

/**
 * Audit logs record security-relevant decisions, not payloads.
 *
 * This keeps a useful trail of writes and command execution while avoiding
 * patch bodies, file contents, command output, secrets, or environment data.
 */
export async function writeAuditEvent(event: {
  traceContext?: TraceContext;
  toolName: string;
  operationType: OperationType;
  status: OperationStatus;
  filePath?: string;
  packageName?: string;
  script?: string;
  patchId?: string;
  proposalId?: string;
  durationMs?: number;
  message?: string;
  exitCode?: number | null;
  timedOut?: boolean;
  originalSha256?: string;
  replacementSha256?: string;
  contentSha256?: string;
  appliedCount?: number;
  pendingCount?: number;
}): Promise<void> {
  const { traceContext, ...safeEvent } = event;

  await appendJsonLine(AUDIT_LOG_FILE, {
    timestamp: new Date().toISOString(),
    traceId: traceContext?.traceId,
    spanId: traceContext?.spanId,
    ...sanitizeLogMetadata(safeEvent)
  });
}
