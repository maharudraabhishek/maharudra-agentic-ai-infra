const UUID_LIKE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Proposal IDs become filenames under .mcp-local. Enforcing UUID-like IDs here
 * prevents path traversal through patchId/proposalId values.
 */
export function assertUuidLikeId(id: string, label: string): void {
  if (!UUID_LIKE_PATTERN.test(id)) {
    throw new Error(`Invalid ${label} format.`);
  }
}

/**
 * Approval text is deliberately exact and boring. It makes writes an explicit
 * second step after a human-visible proposal has been created.
 */
export function assertExactApprovalText(params: {
  actual: string;
  expected: string;
  deniedMessage: string;
}): void {
  const { actual, expected, deniedMessage } = params;

  if (actual !== expected) {
    throw new Error(deniedMessage);
  }
}
