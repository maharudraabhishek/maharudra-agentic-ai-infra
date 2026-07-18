import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runMcpSecurityEvals } from "../evals/mcp-security-evals.js";
import type { TraceContext } from "../core/types.js";
import { writeAuditEvent } from "../observability/audit-logger.js";
import { withToolTelemetry } from "../observability/logger.js";
import { getDurationMs } from "../observability/trace.js";

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

export function registerEvalTools(server: McpServer): void {
  server.registerTool(
    "run_mcp_security_evals",
    {
      title: "Run MCP security evals",
      description:
        "Runs local security and safety checks for the Rudraloka MCP server and returns a structured report.",
      inputSchema: z.object({})
    },
    withToolTelemetry(
      "run_mcp_security_evals",
      "eval",
      async (_input: Record<string, never>, traceContext: TraceContext) => {
        await writeAuditEvent({
          traceContext,
          toolName: "run_mcp_security_evals",
          operationType: "eval",
          status: "attempt"
        });

        try {
          const report = await runMcpSecurityEvals();

          await writeAuditEvent({
            traceContext,
            toolName: "run_mcp_security_evals",
            operationType: "eval",
            status: report.status === "passed" ? "success" : "error",
            durationMs: getDurationMs(traceContext),
            message: `MCP security evals ${report.status}: ${report.passed}/${report.total} passed.`
          });

          return textResponse(JSON.stringify(report, null, 2));
        } catch (error) {
          await writeAuditEvent({
            traceContext,
            toolName: "run_mcp_security_evals",
            operationType: "eval",
            status: "error",
            durationMs: getDurationMs(traceContext),
            message: error instanceof Error ? error.message : String(error)
          });

          throw error;
        }
      }
    )
  );
}
