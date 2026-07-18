import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  MAX_NEW_FILE_CONTENT_CHARS,
  MAX_PATCH_RESULT_BYTES,
  NEW_FILE_PROPOSAL_DIR
} from "../config/mcp-config.js";
import type { NewFileProposal } from "../core/types.js";
import { assertCreatableProjectFile } from "../security/path-policy.js";
import {
  assertExactApprovalText,
  assertUuidLikeId
} from "../security/write-policy.js";
import { sha256 } from "../utils/crypto.js";
import { previewText } from "../utils/text.js";

export function getNewFileProposalPath(proposalId: string): string {
  assertUuidLikeId(proposalId, "proposalId");

  return path.join(NEW_FILE_PROPOSAL_DIR, `${proposalId}.json`);
}

export async function readNewFileProposal(
  proposalId: string
): Promise<NewFileProposal> {
  const proposalPath = getNewFileProposalPath(proposalId);
  const rawProposal = await fs.readFile(proposalPath, "utf8");
  const proposal = JSON.parse(rawProposal) as NewFileProposal;

  if (proposal.proposalId !== proposalId) {
    throw new Error("Invalid new-file proposal: proposalId mismatch.");
  }

  return proposal;
}

export async function createNewFileProposal(params: {
  filePath: string;
  content: string;
  reason: string;
}): Promise<{
  proposal: NewFileProposal;
  approvalText: string;
  preview: string;
}> {
  const { filePath, content, reason } = params;

  if (content.length === 0) {
    throw new Error("New file proposal denied: content cannot be empty.");
  }

  if (content.length > MAX_NEW_FILE_CONTENT_CHARS) {
    throw new Error("New file proposal denied: content is too large.");
  }

  const { fullPath, relativePath } = await assertCreatableProjectFile(filePath);
  const proposalId = randomUUID();

  const proposal: NewFileProposal = {
    proposalId,
    createdAt: new Date().toISOString(),
    status: "proposed",
    filePath,
    relativePath,
    reason,
    content,
    contentSha256: sha256(content)
  };

  await fs.mkdir(NEW_FILE_PROPOSAL_DIR, { recursive: true });
  await fs.writeFile(
    getNewFileProposalPath(proposalId),
    JSON.stringify(proposal, null, 2),
    "utf8"
  );

  const approvalText = `APPLY_NEW_FILE:${proposalId}`;

  const preview = [
    `New File Proposal ID: ${proposalId}`,
    `Target: ${relativePath}`,
    `Reason: ${reason}`,
    "",
    "To create this file, call apply_approved_new_file with:",
    approvalText,
    "",
    "--- FILE CONTENT ---",
    previewText(content)
  ].join("\n");

  /**
   * fullPath is intentionally unused after validation. We store relative paths
   * in proposals so they are stable across machines.
   */
  void fullPath;

  return {
    proposal,
    approvalText,
    preview
  };
}

export async function applyApprovedNewFile(params: {
  proposalId: string;
  approvalText: string;
}): Promise<{
  proposalId: string;
  filePath: string;
  status: "created";
  bytesWritten: number;
}> {
  const { proposalId, approvalText } = params;
  const expectedApprovalText = `APPLY_NEW_FILE:${proposalId}`;

  assertExactApprovalText({
    actual: approvalText,
    expected: expectedApprovalText,
    deniedMessage: `New file creation denied: approvalText must exactly equal "${expectedApprovalText}".`
  });

  const proposal = await readNewFileProposal(proposalId);

  if (proposal.status !== "proposed") {
    throw new Error(
      `New file creation denied: proposal status is "${proposal.status}".`
    );
  }

  const { fullPath, relativePath } = await assertCreatableProjectFile(
    proposal.relativePath
  );

  const sizeBytes = Buffer.byteLength(proposal.content, "utf8");

  if (sizeBytes > MAX_PATCH_RESULT_BYTES) {
    throw new Error("New file creation denied: final file size exceeds safety limit.");
  }

  /**
   * flag: "wx" fails if the file appeared after the proposal was created. That
   * protects unrelated user work from being overwritten.
   */
  await fs.writeFile(fullPath, proposal.content, {
    encoding: "utf8",
    flag: "wx"
  });

  const updatedProposal: NewFileProposal = {
    ...proposal,
    status: "created",
    createdFileAt: new Date().toISOString()
  };

  await fs.writeFile(
    getNewFileProposalPath(proposalId),
    JSON.stringify(updatedProposal, null, 2),
    "utf8"
  );

  return {
    proposalId,
    filePath: relativePath,
    status: "created",
    bytesWritten: sizeBytes
  };
}
