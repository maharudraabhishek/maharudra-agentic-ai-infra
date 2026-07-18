import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OperationStatus, TraceContext } from "../core/types.js";
import { writeAuditEvent } from "../observability/audit-logger.js";
import { withToolTelemetry } from "../observability/logger.js";
import { getDurationMs } from "../observability/trace.js";
import { runAllowedPnpmScript } from "../services/command-runner-service.js";

function textResponse(text: string) {
  return {
    content: [
      {
        type: "text" as const,
        text
      }
    ]
  };
}

function statusFromError(error: unknown): OperationStatus {
  const message = error instanceof Error ? error.message : String(error);

  return /access denied|denied|invalid/i.test(message) ? "denied" : "error";
}

export function registerCommandTools(server: McpServer): void {
  server.registerTool(
    "run_allowed_pnpm_script",
    {
      title: "Run allowlisted pnpm script",
      description:
        "Runs a strictly allowlisted pnpm script for a strictly allowlisted package. Does not allow arbitrary shell commands.",
      inputSchema: z.object({
        packageName: z
          .enum(["rudraloka-dev-mcp"])
          .default("rudraloka-dev-mcp")
          .describe("Allowlisted pnpm package name."),
        script: z
          .enum(["typecheck", "build", "lint", "test"])
          .describe("Allowlisted pnpm script to run.")
      })
    },
    withToolTelemetry(
      "run_allowed_pnpm_script",
      "command",
      async (
        input: { packageName: string; script: string },
        traceContext: TraceContext
      ) => {
        await writeAuditEvent({
          traceContext,
          toolName: "run_allowed_pnpm_script",
          operationType: "command",
          status: "attempt",
          packageName: input.packageName,
          script: input.script
        });

        try {
          const result = await runAllowedPnpmScript(input);

          await writeAuditEvent({
            traceContext,
            toolName: "run_allowed_pnpm_script",
            operationType: "command",
            status: result.exitCode === 0 && !result.timedOut ? "success" : "error",
            packageName: input.packageName,
            script: input.script,
            durationMs: getDurationMs(traceContext),
            exitCode: result.exitCode,
            timedOut: result.timedOut
          });

          return textResponse(JSON.stringify(result, null, 2));
        } catch (error) {
          await writeAuditEvent({
            traceContext,
            toolName: "run_allowed_pnpm_script",
            operationType: "command",
            status: statusFromError(error),
            packageName: input.packageName,
            script: input.script,
            durationMs: getDurationMs(traceContext),
            message: error instanceof Error ? error.message : String(error)
          });

          throw error;
        }
      }
    )
  );
}
