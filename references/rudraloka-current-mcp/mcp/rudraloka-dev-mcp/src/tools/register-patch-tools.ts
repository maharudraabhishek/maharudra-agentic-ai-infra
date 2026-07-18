import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MAX_PATCH_TEXT_CHARS } from "../config/mcp-config.js";
import type { OperationStatus, PatchProposal, TraceContext } from "../core/types.js";
import { writeAuditEvent } from "../observability/audit-logger.js";
import { withToolTelemetry } from "../observability/logger.js";
import { getDurationMs } from "../observability/trace.js";
import {
  applyApprovedPatch,
  createPatchProposal,
  readPatchProposal
} from "../services/patch-service.js";

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

export function registerPatchTools(server: McpServer): void {
  server.registerTool(
    "propose_file_patch",
    {
      title: "Propose safe file patch",
      description:
        "Creates a safe exact-replacement patch proposal for an allowlisted file. Does not modify the file.",
      inputSchema: z.object({
        filePath: z
          .string()
          .describe("Project-relative path of the file to patch."),
        originalText: z
          .string()
          .min(1)
          .max(MAX_PATCH_TEXT_CHARS)
          .describe("Exact text currently present in the file."),
        replacementText: z
          .string()
          .max(MAX_PATCH_TEXT_CHARS)
          .describe("Replacement text to use if the patch is approved."),
        reason: z
          .string()
          .min(3)
          .max(1000)
          .describe("Human-readable reason for the patch.")
      })
    },
    withToolTelemetry(
      "propose_file_patch",
      "patch_proposal",
      async (
        input: {
          filePath: string;
          originalText: string;
          replacementText: string;
          reason: string;
        },
        traceContext: TraceContext
      ) => {
        await writeAuditEvent({
          traceContext,
          toolName: "propose_file_patch",
          operationType: "patch_proposal",
          status: "attempt",
          filePath: input.filePath
        });

        try {
          const result = await createPatchProposal(input);

          await writeAuditEvent({
            traceContext,
            toolName: "propose_file_patch",
            operationType: "patch_proposal",
            status: "success",
            filePath: result.proposal.relativePath,
            patchId: result.proposal.patchId,
            durationMs: getDurationMs(traceContext),
            originalSha256: result.proposal.originalSha256,
            replacementSha256: result.proposal.replacementSha256
          });

          return textResponse(result.preview);
        } catch (error) {
          await writeAuditEvent({
            traceContext,
            toolName: "propose_file_patch",
            operationType: "patch_proposal",
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
    "apply_approved_patch",
    {
      title: "Apply approved file patch",
      description:
        "Applies a previously proposed safe patch only when approvalText exactly matches APPLY_PATCH:<patchId>.",
      inputSchema: z.object({
        patchId: z.string().describe("Patch ID returned by propose_file_patch."),
        approvalText: z.string().describe("Must exactly equal APPLY_PATCH:<patchId>.")
      })
    },
    withToolTelemetry(
      "apply_approved_patch",
      "patch_apply",
      async (
        input: { patchId: string; approvalText: string },
        traceContext: TraceContext
      ) => {
        await writeAuditEvent({
          traceContext,
          toolName: "apply_approved_patch",
          operationType: "patch_apply",
          status: "attempt",
          patchId: input.patchId
        });

        let proposal: PatchProposal | undefined;

        try {
          proposal = await readPatchProposal(input.patchId);
          const result = await applyApprovedPatch(input);

          await writeAuditEvent({
            traceContext,
            toolName: "apply_approved_patch",
            operationType: "patch_apply",
            status: "success",
            filePath: result.filePath,
            patchId: result.patchId,
            durationMs: getDurationMs(traceContext),
            originalSha256: proposal.originalSha256,
            replacementSha256: proposal.replacementSha256
          });

          return textResponse(JSON.stringify(result, null, 2));
        } catch (error) {
          await writeAuditEvent({
            traceContext,
            toolName: "apply_approved_patch",
            operationType: "patch_apply",
            status: statusFromError(error),
            filePath: proposal?.relativePath,
            patchId: input.patchId,
            durationMs: getDurationMs(traceContext),
            message: error instanceof Error ? error.message : String(error)
          });

          throw error;
        }
      }
    )
  );
}
