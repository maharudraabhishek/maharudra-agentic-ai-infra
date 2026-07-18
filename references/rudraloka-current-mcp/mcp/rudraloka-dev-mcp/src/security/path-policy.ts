import fs from "node:fs/promises";
import path from "node:path";
import {
  ALLOWED_EXTENSIONS,
  BLOCKED_DIRS,
  BLOCKED_FILE_NAMES,
  PROJECT_ROOT,
  WRITABLE_PATH_RULES,
  WRITABLE_ROOT_FILES
} from "../config/mcp-config.js";

/**
 * Resolve a user-supplied project path under PROJECT_ROOT.
 *
 * Absolute paths, ../ traversal, and Windows backslash traversal all collapse
 * through path.resolve before we compare the final location to PROJECT_ROOT.
 */
export function normalizeProjectPath(inputPath: string): string {
  const requestedPath = path.resolve(PROJECT_ROOT, inputPath);
  const projectRootWithSeparator = `${PROJECT_ROOT}${path.sep}`;

  const isProjectRoot = requestedPath === PROJECT_ROOT;
  const isInsideProjectRoot = requestedPath.startsWith(projectRootWithSeparator);

  if (!isProjectRoot && !isInsideProjectRoot) {
    throw new Error("Access denied: path escapes project root.");
  }

  return requestedPath;
}

/**
 * Return a portable project-relative path. Policy checks use forward slashes so
 * they behave the same on Windows, macOS, and Linux.
 */
export function toProjectRelativePath(fullPath: string): string {
  return path.relative(PROJECT_ROOT, fullPath).split(path.sep).join("/");
}

function isBlockedName(name: string): boolean {
  return BLOCKED_FILE_NAMES.has(name) || name.startsWith(".env");
}

/**
 * Deny access to blocked directories and sensitive filenames after path
 * normalization. This puts the policy inside the server, where prompt injection
 * in project files cannot talk the client into bypassing it.
 */
export function assertSafePath(fullPath: string): void {
  const relativePath = path.relative(PROJECT_ROOT, fullPath);
  const pathParts = relativePath.split(path.sep).filter(Boolean);

  for (const part of pathParts) {
    if (BLOCKED_DIRS.has(part)) {
      throw new Error(`Access denied: blocked directory "${part}".`);
    }

    if (isBlockedName(part)) {
      throw new Error(`Access denied: blocked sensitive path "${part}".`);
    }
  }
}

/**
 * Read access is deny-by-default: unknown extensions are blocked until the
 * project deliberately approves them.
 */
export function assertAllowedExtension(fullPath: string): void {
  const extension = path.extname(fullPath).toLowerCase();

  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new Error(`Access denied: file extension "${extension}" is not allowed.`);
  }
}

/**
 * Validate that a file can be modified by write tools.
 *
 * The write allowlist is intentionally narrower than the read allowlist. This
 * keeps code generation focused on source/docs and prevents accidental edits to
 * package manager state, credentials, generated output, or hidden internals.
 */
export function assertWritableProjectFile(inputPath: string): {
  fullPath: string;
  relativePath: string;
} {
  const fullPath = normalizeProjectPath(inputPath);

  assertSafePath(fullPath);
  assertAllowedExtension(fullPath);

  const relativePath = toProjectRelativePath(fullPath);
  const extension = path.extname(fullPath).toLowerCase();

  if (WRITABLE_ROOT_FILES.has(relativePath)) {
    return { fullPath, relativePath };
  }

  for (const rule of WRITABLE_PATH_RULES) {
    if (relativePath.startsWith(rule.prefix) && rule.extensions.has(extension)) {
      return { fullPath, relativePath };
    }
  }

  throw new Error(
    `Access denied: "${relativePath}" is not in the MCP writable allowlist.`
  );
}

/**
 * Validate a target for new-file creation.
 *
 * We do not create parent directories here. Requiring the parent to already
 * exist makes generated file creation explicit and easier for a human to review.
 */
export async function assertCreatableProjectFile(inputPath: string): Promise<{
  fullPath: string;
  relativePath: string;
}> {
  const { fullPath, relativePath } = assertWritableProjectFile(inputPath);

  try {
    await fs.stat(fullPath);

    throw new Error(
      `Access denied: "${relativePath}" already exists. Use patch tools for existing files.`
    );
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;

    if (nodeError.code !== "ENOENT") {
      throw error;
    }
  }

  const parentDir = path.dirname(fullPath);
  const parentStat = await fs.stat(parentDir);

  if (!parentStat.isDirectory()) {
    throw new Error("Access denied: parent path is not a directory.");
  }

  return { fullPath, relativePath };
}
