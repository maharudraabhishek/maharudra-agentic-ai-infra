import fs from "node:fs/promises";
import path from "node:path";
import {
  BLOCKED_DIRS,
  MAX_KNOWLEDGE_FILE_BYTES,
  MAX_KNOWLEDGE_SCAN_FILES,
  PROJECT_ROOT
} from "../../config/mcp-config.js";
import {
  normalizeProjectPath,
  toProjectRelativePath
} from "../../security/path-policy.js";
import { sha256 } from "../../utils/crypto.js";
import type {
  KnowledgeScanFile,
  KnowledgeScanReport,
  KnowledgeScanScope,
  KnowledgeScanSkipReason
} from "../chunking/chunk-types.js";
import { isIndexableProjectPath } from "./indexing-policy.js";

const KNOWLEDGE_ROOT_FILES = ["AGENTS.md", "CLAUDE.md"];
const KNOWLEDGE_ROOT_DIRS = [
  ".agents/skills",
  "docs",
  "mcp/rudraloka-dev-mcp/src"
];

const SKIP_REASONS: KnowledgeScanSkipReason[] = [
  "archive-excluded",
  "blocked-directory",
  "blocked-sensitive-path",
  "not-in-allowed-roots",
  "not-file",
  "read-error",
  "scan-limit-exceeded",
  "too-large",
  "unsafe-path",
  "unsupported-extension"
];

function createEmptySkipCounts(): Record<KnowledgeScanSkipReason, number> {
  return SKIP_REASONS.reduce(
    (counts, reason) => ({
      ...counts,
      [reason]: 0
    }),
    {} as Record<KnowledgeScanSkipReason, number>
  );
}

export function createKnowledgeFileHashes(params: {
  filePath: string;
  sizeBytes: number;
  content: string;
}): {
  fileHash: string;
  contentHash: string;
} {
  const contentHash = sha256(params.content);

  return {
    contentHash,
    fileHash: sha256(`${params.filePath}\n${params.sizeBytes}\n${contentHash}`)
  };
}

function isBlockedDirectoryPath(projectPath: string): boolean {
  return projectPath.split("/").some((part) => BLOCKED_DIRS.has(part));
}

function makeSkippedFile(params: {
  filePath: string;
  sizeBytes?: number;
  isArchived?: boolean;
  skipReason: KnowledgeScanSkipReason;
}): KnowledgeScanFile {
  return {
    filePath: params.filePath,
    status: "skipped",
    sizeBytes: params.sizeBytes ?? 0,
    isArchived: params.isArchived ?? params.filePath.startsWith("docs/99-archive"),
    skipReason: params.skipReason
  };
}

function canRecord(files: KnowledgeScanFile[]): boolean {
  return files.length < MAX_KNOWLEDGE_SCAN_FILES;
}

function recordSkipped(
  files: KnowledgeScanFile[],
  skipped: KnowledgeScanFile
): void {
  if (canRecord(files)) {
    files.push(skipped);
  }
}

async function scanFile(params: {
  projectPath: string;
  includeArchived: boolean;
  files: KnowledgeScanFile[];
}): Promise<void> {
  const { includeArchived, files, projectPath } = params;

  if (!canRecord(files)) {
    return;
  }

  let fullPath: string;

  try {
    fullPath = normalizeProjectPath(projectPath);
  } catch {
    recordSkipped(
      files,
      makeSkippedFile({ filePath: projectPath, skipReason: "unsafe-path" })
    );
    return;
  }

  try {
    const stat = await fs.lstat(fullPath);

    if (stat.isSymbolicLink() || !stat.isFile()) {
      recordSkipped(
        files,
        makeSkippedFile({
          filePath: projectPath,
          isArchived: projectPath.startsWith("docs/99-archive"),
          skipReason: "not-file"
        })
      );
      return;
    }

    const policy = isIndexableProjectPath(projectPath, {
      includeArchived,
      sizeBytes: stat.size
    });

    if (!policy.indexable || !policy.sourceType) {
      recordSkipped(
        files,
        makeSkippedFile({
          filePath: policy.filePath,
          sizeBytes: stat.size,
          isArchived: policy.isArchived,
          skipReason: policy.skipReason ?? "not-in-allowed-roots"
        })
      );
      return;
    }

    /**
     * Content is read only after path, source, extension, archive, and size
     * checks pass. The scan report keeps hashes only, never raw file text.
     */
    const content = await fs.readFile(fullPath, "utf8");
    const { contentHash, fileHash } = createKnowledgeFileHashes({
      filePath: policy.filePath,
      sizeBytes: stat.size,
      content
    });

    files.push({
      filePath: policy.filePath,
      status: "included",
      sourceType: policy.sourceType,
      fileHash,
      contentHash,
      sizeBytes: stat.size,
      isArchived: policy.isArchived
    });
  } catch {
    recordSkipped(
      files,
      makeSkippedFile({ filePath: projectPath, skipReason: "read-error" })
    );
  }
}

async function walkDirectory(params: {
  projectPath: string;
  includeArchived: boolean;
  files: KnowledgeScanFile[];
}): Promise<void> {
  const { includeArchived, files, projectPath } = params;

  if (!canRecord(files)) {
    return;
  }

  let fullPath: string;

  try {
    fullPath = normalizeProjectPath(projectPath);
  } catch {
    recordSkipped(
      files,
      makeSkippedFile({ filePath: projectPath, skipReason: "unsafe-path" })
    );
    return;
  }

  const relativePath = toProjectRelativePath(fullPath);

  if (isBlockedDirectoryPath(relativePath)) {
    recordSkipped(
      files,
      makeSkippedFile({
        filePath: `${relativePath}/`,
        skipReason: "blocked-directory"
      })
    );
    return;
  }

  if (
    relativePath === "docs/99-archive" &&
    !includeArchived
  ) {
    recordSkipped(
      files,
      makeSkippedFile({
        filePath: "docs/99-archive/",
        isArchived: true,
        skipReason: "archive-excluded"
      })
    );
    return;
  }

  try {
    const stat = await fs.lstat(fullPath);

    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      recordSkipped(
        files,
        makeSkippedFile({ filePath: relativePath, skipReason: "not-file" })
      );
      return;
    }

    const entries = (await fs.readdir(fullPath, { withFileTypes: true })).sort(
      (left, right) => left.name.localeCompare(right.name)
    );

    for (const entry of entries) {
      if (!canRecord(files)) {
        return;
      }

      const childPath = path.posix.join(relativePath, entry.name);

      if (entry.isDirectory()) {
        await walkDirectory({
          projectPath: childPath,
          includeArchived,
          files
        });
        continue;
      }

      if (entry.isFile() || entry.isSymbolicLink()) {
        await scanFile({ projectPath: childPath, includeArchived, files });
      }
    }
  } catch {
    recordSkipped(
      files,
      makeSkippedFile({ filePath: relativePath, skipReason: "read-error" })
    );
  }
}

function summarizeReport(params: {
  scope: KnowledgeScanScope;
  includeArchived: boolean;
  files: KnowledgeScanFile[];
}): KnowledgeScanReport {
  const skipReasonCounts = createEmptySkipCounts();

  for (const file of params.files) {
    if (file.status === "skipped" && file.skipReason) {
      skipReasonCounts[file.skipReason] += 1;
    }
  }

  const filesAllowed = params.files.filter(
    (file) => file.status === "included"
  ).length;
  const filesSkipped = params.files.length - filesAllowed;

  return {
    scope: params.scope,
    includeArchived: params.includeArchived,
    scannedAt: new Date().toISOString(),
    maxScanFiles: MAX_KNOWLEDGE_SCAN_FILES,
    maxFileBytes: MAX_KNOWLEDGE_FILE_BYTES,
    filesConsidered: params.files.length,
    filesAllowed,
    filesSkipped,
    skipReasonCounts,
    files: params.files
  };
}

export async function scanProjectKnowledge(
  options: {
    scope?: KnowledgeScanScope;
    includeArchived?: boolean;
  } = {}
): Promise<KnowledgeScanReport> {
  const scope = options.scope ?? "docs-and-mcp";
  const includeArchived = options.includeArchived === true;
  const files: KnowledgeScanFile[] = [];

  if (scope !== "docs-and-mcp") {
    recordSkipped(
      files,
      makeSkippedFile({ filePath: PROJECT_ROOT, skipReason: "unsafe-path" })
    );
    return summarizeReport({ scope, includeArchived, files });
  }

  for (const rootFile of KNOWLEDGE_ROOT_FILES) {
    await scanFile({ projectPath: rootFile, includeArchived, files });
  }

  for (const rootDir of KNOWLEDGE_ROOT_DIRS) {
    await walkDirectory({ projectPath: rootDir, includeArchived, files });
  }

  if (files.length >= MAX_KNOWLEDGE_SCAN_FILES) {
    files[MAX_KNOWLEDGE_SCAN_FILES - 1] = makeSkippedFile({
      filePath: "[scan-limit]",
      skipReason: "scan-limit-exceeded"
    });
  }

  return summarizeReport({ scope, includeArchived, files });
}
