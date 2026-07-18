import { createHash } from "node:crypto";

/**
 * Hash content for audit correlation without storing the content itself.
 */
export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
