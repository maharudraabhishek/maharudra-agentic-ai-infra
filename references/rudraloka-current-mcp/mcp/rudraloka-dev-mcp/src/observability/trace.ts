import { randomUUID } from "node:crypto";
import type { OperationType, TraceContext } from "../core/types.js";

export function createSpanId(): string {
  return randomUUID();
}

/**
 * Each tool call gets an isolated trace context. Trace IDs let audit and app
 * logs be correlated without logging file contents or command output.
 */
export function createTraceContext(
  toolName: string,
  operationType: OperationType
): TraceContext {
  return {
    traceId: randomUUID(),
    spanId: createSpanId(),
    toolName,
    operationType,
    startedAtMs: Date.now()
  };
}

export function createChildTraceContext(
  parent: TraceContext,
  toolName = parent.toolName,
  operationType = parent.operationType
): TraceContext {
  return {
    traceId: parent.traceId,
    spanId: createSpanId(),
    parentSpanId: parent.spanId,
    toolName,
    operationType,
    startedAtMs: Date.now()
  };
}

export function getDurationMs(traceContext: TraceContext): number {
  return Date.now() - traceContext.startedAtMs;
}
