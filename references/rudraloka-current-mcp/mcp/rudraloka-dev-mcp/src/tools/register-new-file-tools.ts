import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MAX_NEW_FILE_CONTENT_CHARS } from "../config/mcp-config.js";
import type { NewFileProposal, OperationStatus, TraceContext } from "../core/types.js";
import { writeAuditEvent } from "../observability/audit-logger.js";
import { withToolTelemetry } from "../observability/logger.js";
import { getDurationMs } from "../observability/trace.js";
import {
  applyApprovedNewFile,
  createNewFileProposal,
  readNewFileProposal
} from "../services/new-file-service.js";

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

  return /access denied|denied|invalid|must exactly equal/i.test(message)
    ? "denied"
    : "error";
}

export function registerNewFileTools(server: McpServer): void {
  server.registerTool(
    "propose_new_file",
    {
      title: "Propose new file",
      description:
        "Creates a safe new-file proposal for an allowlisted path. Does not create the file.",
      inputSchema: z.object({
        filePath: z.string().describe("Project-relative path for the new file."),
        content: z
          .string()
          .min(1)
          .max(MAX_NEW_FILE_CONTENT_CHARS)
          .describe("Content of the new file."),
        reason: z
          .string()
          .min(3)
          .max(1000)
          .describe("Human-readable reason for creating the file.")
      })
    },
    withToolTelemetry(
      "propose_new_file",
      "new_file_proposal",
      async (
        input: { filePath: string; content: string; reason: string },
        traceContext: TraceContext
      ) => {
        await writeAuditEvent({
          traceContext,
          toolName: "propose_new_file",
          operationType: "new_file_proposal",
          status: "attempt",
          filePath: input.filePath
        });

        try {
          const result = await createNewFileProposal(input);

          await writeAuditEvent({
            traceContext,
            toolName: "propose_new_file",
            operationType: "new_file_proposal",
            status: "success",
            filePath: result.proposal.relativePath,
            proposalId: result.proposal.proposalId,
            durationMs: getDurationMs(traceContext),
            contentSha256: result.proposal.contentSha256
          });

          return textResponse(result.preview);
        } catch (error) {
          await writeAuditEvent({
            traceContext,
            toolName: "propose_new_file",
            operationType: "new_file_proposal",
            status: statusFromError(error),
            filePath: input.filePath,
            durationMs: getDurationMs(traceContext),
            message: error instanceof Error ? error.message : String(error)
          });

          throw error;
        }
      }
    )
  );

  server.registerTool(
    "apply_approved_new_file",
    {
      title: "Apply approved new file",
      description:
        "Creates a previously proposed new file only when approvalText exactly matches APPLY_NEW_FILE:<proposalId>.",
      inputSchema: z.object({
        proposalId: z
          .string()
          .describe("Proposal ID returned by propose_new_file."),
        approvalText: z
          .string()
          .describe("Must exactly equal APPLY_NEW_FILE:<proposalId>.")
      })
    },
    withToolTelemetry(
      "apply_approved_new_file",
      "new_file_apply",
      async (
        input: { proposalId: string; approvalText: string },
        traceContext: TraceContext
      ) => {
        await writeAuditEvent({
          traceContext,
          toolName: "apply_approved_new_file",
          operationType: "new_file_apply",
          status: "attempt",
          proposalId: input.proposalId
        });

        let proposal: NewFileProposal | undefined;

        try {
          proposal = await readNewFileProposal(input.proposalId);
          const result = await applyApprovedNewFile(input);

          await writeAuditEvent({
            traceContext,
            toolName: "apply_approved_new_file",
            operationType: "new_file_apply",
            status: "success",
            filePath: result.filePath,
            proposalId: result.proposalId,
            durationMs: getDurationMs(traceContext),
            contentSha256: proposal.contentSha256
          });

          return textResponse(JSON.stringify(result, null, 2));
        } catch (error) {
          await writeAuditEvent({
            traceContext,
            toolName: "apply_approved_new_file",
            operationType: "new_file_apply",
            status: statusFromError(error),
            filePath: proposal?.relativePath,
            proposalId: input.proposalId,
            durationMs: getDurationMs(traceContext),
            message: error instanceof Error ? error.message : String(error)
          });

          throw error;
        }
      }
    )
  );
}
