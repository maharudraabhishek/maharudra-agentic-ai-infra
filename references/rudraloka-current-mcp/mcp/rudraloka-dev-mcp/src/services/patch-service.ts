import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  MAX_PATCH_RESULT_BYTES,
  MAX_PATCH_TEXT_CHARS,
  PATCH_PROPOSAL_DIR
} from "../config/mcp-config.js";
import type { PatchProposal } from "../core/types.js";
import { assertWritableProjectFile } from "../security/path-policy.js";
import {
  assertExactApprovalText,
  assertUuidLikeId
} from "../security/write-policy.js";
import { sha256 } from "../utils/crypto.js";
import { countOccurrences, previewText } from "../utils/text.js";
import { safeReadTextFile } from "./file-read-service.js";

export function getPatchProposalPath(patchId: string): string {
  assertUuidLikeId(patchId, "patchId");

  return path.join(PATCH_PROPOSAL_DIR, `${patchId}.json`);
}

export async function readPatchProposal(
  patchId: string
): Promise<PatchProposal> {
  const proposalPath = getPatchProposalPath(patchId);
  const rawProposal = await fs.readFile(proposalPath, "utf8");
  const proposal = JSON.parse(rawProposal) as PatchProposal;

  if (proposal.patchId !== patchId) {
    throw new Error("Invalid patch proposal: patchId mismatch.");
  }

  return proposal;
}

export async function createPatchProposal(params: {
  filePath: string;
  originalText: string;
  replacementText: string;
  reason: string;
}): Promise<{
  proposal: PatchProposal;
  approvalText: string;
  preview: string;
}> {
  const { filePath, originalText, replacementText, reason } = params;

  if (originalText.length === 0) {
    throw new Error("Patch denied: originalText cannot be empty.");
  }

  if (originalText === replacementText) {
    throw new Error("Patch denied: originalText and replacementText are identical.");
  }

  if (originalText.length > MAX_PATCH_TEXT_CHARS) {
    throw new Error("Patch denied: originalText is too large.");
  }

  if (replacementText.length > MAX_PATCH_TEXT_CHARS) {
    throw new Error("Patch denied: replacementText is too large.");
  }

  const { fullPath, relativePath } = assertWritableProjectFile(filePath);
  const currentText = await safeReadTextFile(relativePath);
  const occurrenceCount = countOccurrences(currentText, originalText);

  if (occurrenceCount === 0) {
    throw new Error("Patch denied: originalText was not found in the target file.");
  }

  if (occurrenceCount > 1) {
    throw new Error(
      `Patch denied: originalText appears ${occurrenceCount} times. The patch is ambiguous.`
    );
  }

  const patchId = randomUUID();

  const proposal: PatchProposal = {
    patchId,
    createdAt: new Date().toISOString(),
    status: "proposed",
    filePath,
    relativePath,
    reason,
    originalText,
    replacementText,
    originalSha256: sha256(originalText),
    replacementSha256: sha256(replacementText)
  };

  await fs.mkdir(PATCH_PROPOSAL_DIR, { recursive: true });
  await fs.writeFile(
    getPatchProposalPath(patchId),
    JSON.stringify(proposal, null, 2),
    "utf8"
  );

  const approvalText = `APPLY_PATCH:${patchId}`;

  const preview = [
    `Patch ID: ${patchId}`,
    `Target: ${relativePath}`,
    `Reason: ${reason}`,
    "",
    "To apply this patch, call apply_approved_patch with:",
    approvalText,
    "",
    "--- ORIGINAL TEXT ---",
    previewText(originalText),
    "",
    "--- REPLACEMENT TEXT ---",
    previewText(replacementText)
  ].join("\n");

  /**
   * fullPath is intentionally unused after validation. We store the normalized
   * relative path so proposals remain portable across machines.
   */
  void fullPath;

  return {
    proposal,
    approvalText,
    preview
  };
}

export async function applyApprovedPatch(params: {
  patchId: string;
  approvalText: string;
}): Promise<{
  patchId: string;
  filePath: string;
  status: "applied";
  bytesWritten: number;
}> {
  const { patchId, approvalText } = params;
  const expectedApprovalText = `APPLY_PATCH:${patchId}`;

  assertExactApprovalText({
    actual: approvalText,
    expected: expectedApprovalText,
    deniedMessage: `Patch denied: approvalText must exactly equal "${expectedApprovalText}".`
  });

  const proposal = await readPatchProposal(patchId);

  if (proposal.status !== "proposed") {
    throw new Error(`Patch denied: patch status is "${proposal.status}".`);
  }

  const { fullPath, relativePath } = assertWritableProjectFile(
    proposal.relativePath
  );

  const currentText = await safeReadTextFile(relativePath);
  const occurrenceCount = countOccurrences(currentText, proposal.originalText);

  if (occurrenceCount === 0) {
    throw new Error(
      "Patch denied: originalText no longer exists. The file may have changed."
    );
  }

  if (occurrenceCount > 1) {
    throw new Error(
      `Patch denied: originalText appears ${occurrenceCount} times. The patch is ambiguous.`
    );
  }

  const updatedText = currentText.replace(
    proposal.originalText,
    proposal.replacementText
  );

  const updatedSizeBytes = Buffer.byteLength(updatedText, "utf8");

  if (updatedSizeBytes > MAX_PATCH_RESULT_BYTES) {
    throw new Error("Patch denied: final file size exceeds safety limit.");
  }

  /**
   * Write only after all checks pass, including revalidating the current file
   * contents. This avoids overwriting unrelated user edits.
   */
  await fs.writeFile(fullPath, updatedText, "utf8");

  const updatedProposal: PatchProposal = {
    ...proposal,
    status: "applied",
    appliedAt: new Date().toISOString()
  };

  await fs.writeFile(
    getPatchProposalPath(patchId),
    JSON.stringify(updatedProposal, null, 2),
    "utf8"
  );

  return {
    patchId,
    filePath: relativePath,
    status: "applied",
    bytesWritten: updatedSizeBytes
  };
}
