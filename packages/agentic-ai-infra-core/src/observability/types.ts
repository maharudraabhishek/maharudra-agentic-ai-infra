/** Trace span/event metadata for bounded runtime observability. */
export type TraceEvent = {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly attributes?: Record<string, string | number | boolean>;
};

/** Audit event describing a runtime decision. */
export type AuditEvent = {
  readonly id: string;
  readonly traceId?: string;
  readonly action: string;
  readonly actor?: string;
  readonly decision: "allowed" | "denied" | "error";
  readonly reason?: string;
  readonly createdAt: string;
};

/** Safe log event that excludes secrets and raw command output. */
export type SafeLogEvent = {
  readonly level: "debug" | "info" | "warn" | "error";
  readonly message: string;
  readonly traceId?: string;
  readonly metadata?: Record<string, string | number | boolean | null>;
};

/** Safe trajectory event persisted for runtime and dashboard summaries. */
export type SafeTrajectoryEvent = {
  readonly traceId: string;
  readonly runId: string;
  readonly agentRole?: string;
  readonly stepType: string;
  readonly toolName?: string;
  readonly status: "allowed" | "denied" | "error" | "completed";
  readonly durationMs: number;
  readonly taskHash?: string;
  readonly taskType?: string;
  readonly tokenEstimate?: number;
  readonly errorCode?: string;
  readonly sourceCount?: number;
  readonly metadata?: Record<string, string | number | boolean | null>;
  /**
   * Thread id from the active session. When present, `PostgresTrajectoryRecorder`
   * uses it as the FK reference when inserting into `agentic_tool_calls`.
   * Absent for events recorded before a thread is opened or when no session
   * manager is wired.
   */
  readonly threadId?: string;
};

/** Project observability configuration. */
export type ObservabilityConfig = {
  readonly enabled: boolean;
  readonly safeLogging: boolean;
  readonly audit?: {
    readonly enabled: boolean;
    readonly sink?: "local" | "remote" | "custom";
  };
  readonly traces?: {
    readonly enabled: boolean;
    readonly sink?: "local" | "remote" | "custom";
  };
};

/** Dashboard configuration for generated projects. */
export type DashboardConfig = {
  readonly enabled: boolean;
  readonly host?: string;
  readonly port?: number;
  readonly showTokenUsage?: boolean;
  readonly showRetrievalQuality?: boolean;
  readonly showEvalResults?: boolean;
  readonly showAuditEvents?: boolean;
  readonly showAgentWorkflows?: boolean;
};
