import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MAX_LOG_SUMMARY_LIMIT } from "../config/mcp-config.js";
import { withToolTelemetry } from "../observability/logger.js";
import {
  readAppLogSummary,
  readAuditSummary
} from "../observability/summaries.js";

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

export function registerObservabilityTools(server: McpServer): void {
  server.registerTool(
    "audit_read_summary",
    {
      title: "Read MCP audit summary",
      description:
        "Returns recent MCP audit metadata without exposing patch contents or secrets.",
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_LOG_SUMMARY_LIMIT)
          .default(20)
          .describe("Maximum number of recent audit events to return.")
      })
    },
    withToolTelemetry(
      "audit_read_summary",
      "observability",
      async ({ limit }: { limit: number }) =>
        textResponse(JSON.stringify(await readAuditSummary({ limit }), null, 2))
    )
  );

  server.registerTool(
    "log_read_summary",
    {
      title: "Read MCP app log summary",
      description:
        "Returns recent sanitized MCP app log metadata without exposing command output, patch contents, or secrets.",
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_LOG_SUMMARY_LIMIT)
          .default(20)
          .describe("Maximum number of recent app log events to return.")
      })
    },
    withToolTelemetry(
      "log_read_summary",
      "observability",
      async ({ limit }: { limit: number }) =>
        textResponse(JSON.stringify(await readAppLogSummary({ limit }), null, 2))
    )
  );
}
