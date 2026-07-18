import type { AgentRole, SafeTaskMetadata } from "../agents/types.js";
import type { EvalSuiteContract, QualityReport } from "../evals/types.js";
import type { ErrorCode, FrameworkResult } from "../errors/index.js";
import type { RuntimeMode } from "../runtime/types.js";
import type { TokenUsageReport } from "../token/types.js";
import type { ToolContract } from "../tools/types.js";

/** Contract for registering and running eval suites in tests or diagnostics. */
export interface EvalHarnessContract {
  /** Registers an eval suite and returns the harness for chaining. */
  registerSuite(suite: EvalSuiteContract): EvalHarnessContract;
  /** Runs one named eval suite. */
  runSuite(name: string): Promise<FrameworkResult<QualityReport>>;
  /** Runs every registered eval suite. */
  runAll(): Promise<FrameworkResult<readonly QualityReport[]>>;
}

/** Runtime context passed to a concrete tool handler after policy checks pass. */
export type ToolExecutionContext = {
  readonly runtimeMode: RuntimeMode;
  readonly traceId: string;
  readonly runId: string;
  readonly tool: ToolContract;
  readonly agentRole?: AgentRole;
  readonly task?: SafeTaskMetadata;
  readonly approvalMatched?: boolean;
  readonly startedAt: string;
};

/** Successful tool execution payload before it is mapped to FrameworkResult. */
export type ToolExecutionResult<TOutput = unknown> = {
  readonly toolId: string;
  readonly output: TOutput;
  readonly tokenUsage?: TokenUsageReport;
  readonly metadata?: Record<string, string | number | boolean | null>;
};

/** Safe tool execution error that never contains stack traces or raw output. */
export type ToolExecutionError = {
  readonly code: ErrorCode;
  readonly message: string;
  readonly severity?: "recoverable" | "fatal";
};

/** Concrete runtime behavior for one tool contract. */
export type ToolExecutionHandler<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  context: ToolExecutionContext
) => Promise<FrameworkResult<ToolExecutionResult<TOutput>>> | FrameworkResult<ToolExecutionResult<TOutput>>;
