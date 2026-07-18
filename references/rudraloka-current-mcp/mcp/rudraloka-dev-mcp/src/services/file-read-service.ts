import fs from "node:fs/promises";
import {
  BLOCKED_DIRS,
  BLOCKED_FILE_NAMES,
  MAX_READ_BYTES
} from "../config/mcp-config.js";
import {
  assertAllowedExtension,
  assertSafePath,
  normalizeProjectPath
} from "../security/path-policy.js";

/**
 * Safely read a small text file from inside PROJECT_ROOT.
 *
 * All checks happen server-side so untrusted project text cannot influence the
 * policy by telling the AI client to read secrets or generated output.
 */
export async function safeReadTextFile(inputPath: string): Promise<string> {
  const fullPath = normalizeProjectPath(inputPath);

  assertSafePath(fullPath);
  assertAllowedExtension(fullPath);

  const stat = await fs.stat(fullPath);

  if (!stat.isFile()) {
    throw new Error("Access denied: path is not a file.");
  }

  if (stat.size > MAX_READ_BYTES) {
    throw new Error(`Access denied: file too large. Limit is ${MAX_READ_BYTES} bytes.`);
  }

  return fs.readFile(fullPath, "utf8");
}

function isVisibleEntryName(name: string): boolean {
  return (
    !BLOCKED_DIRS.has(name) &&
    !BLOCKED_FILE_NAMES.has(name) &&
    !name.startsWith(".env")
  );
}

/**
 * List only immediate children of a safe directory.
 *
 * No recursive crawl is exposed because large trees can overwhelm the client
 * and increase accidental disclosure risk.
 */
export async function safeListDirectory(inputPath: string): Promise<string[]> {
  const fullPath = normalizeProjectPath(inputPath);

  assertSafePath(fullPath);

  const stat = await fs.stat(fullPath);

  if (!stat.isDirectory()) {
    throw new Error("Access denied: path is not a directory.");
  }

  const entries = await fs.readdir(fullPath, { withFileTypes: true });

  return entries
    .filter((entry) => isVisibleEntryName(entry.name))
    .map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`)
    .sort();
}
