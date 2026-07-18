import fs from "node:fs/promises";
import path from "node:path";
import { cliFail, cliOk, errorIssue } from "./result.js";
import type {
  CliResult,
  NormalizedInitOptions,
  RenderedFile,
  WritePlan,
  WritePlanItem
} from "./types.js";
import {
  resolveTargetRoot,
  validateTemplateRelativePath
} from "./validation.js";

const BLOCKED_PATH_PARTS = new Set([
  ".git",
  "node_modules",
  ".pnpm-store",
  "dist",
  "build",
  "coverage",
  ".next",
  ".cache"
]);

const GITIGNORE_MANAGED_BLOCK_START = "# BEGIN agentic-ai-infra managed local state";

/**
 * Normalizes generated relative paths to POSIX-style separators for security
 * checks that should behave the same on Windows, macOS, and Linux.
 */
function normalizeRelativePath(relativePath: string): string {
  return relativePath.replaceAll("\\", "/");
}

/**
 * Returns true when a generated output path is always unsafe to write.
 *
 * This check still applies when `--force` is set. Force may replace ordinary
 * generated files, but it must never override secret files, dependency folders,
 * build output, or repository metadata.
 */
export function isSensitiveOutputPath(relativePath: string): boolean {
  const normalized = normalizeRelativePath(relativePath);
  const basename = path.posix.basename(normalized);
  const parts = normalized.split("/").filter(Boolean);

  return (
    basename === ".npmrc" ||
    basename.startsWith(".env") ||
    /^id_(rsa|dsa|ecdsa|ed25519)$/i.test(basename) ||
    /private.*key/i.test(basename) ||
    /^credentials?(\.|$)/i.test(basename) ||
    parts.some((part) => BLOCKED_PATH_PARTS.has(part))
  );
}

/**
 * Reads an existing target file and returns `undefined` when it does not exist.
 *
 * Non-ENOENT errors are rethrown because permission or IO failures should stop
 * planning instead of being mistaken for a missing file.
 */
async function readExistingFile(targetPath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(targetPath, "utf8");
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;

    if (nodeError.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

/**
 * Creates a deterministic write plan for rendered template files.
 *
 * The plan performs path containment, sensitive-path blocking, idempotency
 * detection, conflict detection, and force-aware overwrite decisions before
 * any file write is attempted.
 */
export async function createWritePlan(params: {
  readonly files: readonly RenderedFile[];
  readonly options: NormalizedInitOptions;
  readonly cwd?: string;
}): Promise<CliResult<WritePlan>> {
  const cwd = params.cwd ?? process.cwd();
  let targetRoot: string;

  try {
    targetRoot = resolveTargetRoot(params.options.target, cwd);
  } catch (error) {
    return cliFail([
      errorIssue(
        "invalid-target",
        error instanceof Error ? error.message : "Invalid target path.",
        "Use --target . or a child directory of the current workspace."
      )
    ]);
  }

  const items: WritePlanItem[] = [];

  for (const file of params.files) {
    // Template paths are treated as untrusted generated input even though they
    // come from this package. This keeps future template changes inside the
    // same safety boundary as user-provided paths.
    if (!validateTemplateRelativePath(file.relativePath)) {
      return cliFail([
        errorIssue(
          "unsafe-template-path",
          `Template path "${file.relativePath}" is unsafe.`,
          "Template output paths must be relative and must not contain traversal."
        )
      ]);
    }

    const targetPath = path.resolve(targetRoot, file.relativePath);
    const rootWithSeparator = `${targetRoot}${path.sep}`;
    const isInsideRoot =
      targetPath === targetRoot || targetPath.startsWith(rootWithSeparator);

    // Resolve-and-prefix validation prevents traversal that might survive
    // separator normalization or platform-specific path parsing.
    if (!isInsideRoot) {
      return cliFail([
        errorIssue(
          "path-escapes-target",
          `Output path "${file.relativePath}" escapes the target root.`,
          "Use neutral generated project paths under the target root."
        )
      ]);
    }

    // Sensitive targets are recorded in the plan instead of written so the user
    // can see exactly what was blocked without risking a secret overwrite.
    if (isSensitiveOutputPath(file.relativePath)) {
      items.push({
        action: "blocked",
        relativePath: file.relativePath,
        targetPath,
        content: file.content,
        reason: "Sensitive or generated/dependency paths are never written."
      });
      continue;
    }

    const existing = await readExistingFile(targetPath);

    // `.gitignore` is append-only by contract: generated local state should be
    // ignored, but user ignore rules must remain byte-for-byte intact.
    if (file.relativePath === ".gitignore" && existing !== undefined) {
      if (existing.includes(GITIGNORE_MANAGED_BLOCK_START)) {
        items.push({
          action: "unchanged",
          relativePath: file.relativePath,
          targetPath,
          content: file.content,
          reason: "Existing .gitignore already contains the managed agentic block."
        });
        continue;
      }

      items.push({
        action: "append",
        relativePath: file.relativePath,
        targetPath,
        content: file.content,
        reason: "Append managed local-state ignore block while preserving existing content."
      });
      continue;
    }

    // Missing files are safe creates once path and sensitivity checks pass.
    if (existing === undefined) {
      items.push({
        action: "create",
        relativePath: file.relativePath,
        targetPath,
        content: file.content,
        reason: "File does not exist."
      });
      continue;
    }

    // Matching content makes init idempotent and keeps repeated runs quiet.
    if (existing === file.content) {
      items.push({
        action: "unchanged",
        relativePath: file.relativePath,
        targetPath,
        content: file.content,
        reason: "Existing file already matches generated content."
      });
      continue;
    }

    // Force is intentionally narrow: it applies only after sensitive paths and
    // target containment have already been rejected.
    if (params.options.force) {
      items.push({
        action: "overwrite",
        relativePath: file.relativePath,
        targetPath,
        content: file.content,
        reason: "--force was provided for a non-sensitive conflicting file."
      });
      continue;
    }

    // Conflicting files get a `.new` suggestion so users can review the
    // generated content without losing their current file.
    items.push({
      action: "conflict",
      relativePath: file.relativePath,
      targetPath,
      content: file.content,
      reason: "Existing file differs and will not be overwritten by default.",
      newFilePath: `${targetPath}.new`
    });
  }

  return cliOk({
    targetRoot,
    dryRun: params.options.dryRun,
    force: params.options.force,
    items
  });
}
