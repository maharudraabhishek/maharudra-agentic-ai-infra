import path from "node:path";
import {
  ALLOWED_EXTENSIONS,
  BLOCKED_DIRS,
  BLOCKED_FILE_NAMES,
  MAX_KNOWLEDGE_FILE_BYTES
} from "../../config/mcp-config.js";
import {
  normalizeProjectPath,
  toProjectRelativePath
} from "../../security/path-policy.js";
import type {
  KnowledgeScanSkipReason,
  KnowledgeSourceType
} from "../chunking/chunk-types.js";

export type IndexableProjectPathResult = {
  indexable: boolean;
  filePath: string;
  sourceType?: KnowledgeSourceType;
  isArchived: boolean;
  skipReason?: KnowledgeScanSkipReason;
};

const ROOT_KNOWLEDGE_FILES = new Map<string, KnowledgeSourceType>([
  ["AGENTS.md", "project-policy"],
  ["CLAUDE.md", "claude-compatibility"]
]);

const SENSITIVE_PATH_PATTERN =
  /(^|[/_.-])(credentials?|tokens?|secrets?|private[-_]?keys?|id_rsa|id_ed25519|id_ecdsa|id_dsa)([/_.-]|$)/i;

function normalizeRelativePath(inputPath: string): string {
  const fullPath = normalizeProjectPath(inputPath);
  return toProjectRelativePath(fullPath);
}

function splitPathParts(projectPath: string): string[] {
  return projectPath.split("/").filter(Boolean);
}

function isBlockedFileName(name: string): boolean {
  return BLOCKED_FILE_NAMES.has(name) || name.startsWith(".env");
}

function isDocsArchivePath(projectPath: string): boolean {
  return projectPath === "docs/99-archive" || projectPath.startsWith("docs/99-archive/");
}

function hasAllowedKnowledgeExtension(projectPath: string): boolean {
  const extension = path.posix.extname(projectPath).toLowerCase();

  if (projectPath.startsWith("mcp/rudraloka-dev-mcp/src/")) {
    return extension === ".ts";
  }

  return extension === ".md";
}

function isAllowedKnowledgeRoot(projectPath: string): boolean {
  if (ROOT_KNOWLEDGE_FILES.has(projectPath)) {
    return true;
  }

  if (
    projectPath.startsWith(".agents/skills/") &&
    projectPath.endsWith("/SKILL.md")
  ) {
    return true;
  }

  if (projectPath.startsWith("docs/") && projectPath.endsWith(".md")) {
    return true;
  }

  return (
    projectPath.startsWith("mcp/rudraloka-dev-mcp/src/") &&
    projectPath.endsWith(".ts")
  );
}

function getBlockedPathSkipReason(
  projectPath: string
): KnowledgeScanSkipReason | undefined {
  const pathParts = splitPathParts(projectPath);

  for (const part of pathParts) {
    if (BLOCKED_DIRS.has(part)) {
      return "blocked-directory";
    }

    if (isBlockedFileName(part)) {
      return "blocked-sensitive-path";
    }
  }

  if (SENSITIVE_PATH_PATTERN.test(projectPath)) {
    return "blocked-sensitive-path";
  }

  return undefined;
}

export function shouldIncludeArchived(includeArchived = false): boolean {
  return includeArchived === true;
}

export function getKnowledgeSourceType(
  inputPath: string
): KnowledgeSourceType | undefined {
  const projectPath = inputPath.split(path.sep).join("/");

  if (ROOT_KNOWLEDGE_FILES.has(projectPath)) {
    return ROOT_KNOWLEDGE_FILES.get(projectPath);
  }

  if (
    projectPath.startsWith(".agents/skills/") &&
    projectPath.endsWith("/SKILL.md")
  ) {
    return "skill";
  }

  if (projectPath.startsWith("docs/02-architecture/")) {
    return "architecture-doc";
  }

  if (projectPath.startsWith("docs/03-mcp/")) {
    return "mcp-doc";
  }

  if (projectPath.startsWith("docs/04-ai-infra/")) {
    return "ai-infra-doc";
  }

  if (projectPath.startsWith("docs/05-security/")) {
    return "security-doc";
  }

  if (projectPath.startsWith("docs/06-runbooks/")) {
    return "runbook";
  }

  if (projectPath.startsWith("docs/01-learning-journal/")) {
    return "learning-journal";
  }

  if (projectPath.startsWith("docs/") && projectPath.endsWith(".md")) {
    return "project-doc";
  }

  if (projectPath.startsWith("mcp/rudraloka-dev-mcp/src/")) {
    return "typescript-source";
  }

  return undefined;
}

export function isIndexableProjectPath(
  inputPath: string,
  options: {
    includeArchived?: boolean;
    sizeBytes?: number;
  } = {}
): IndexableProjectPathResult {
  let projectPath: string;

  try {
    projectPath = normalizeRelativePath(inputPath);
  } catch {
    return {
      indexable: false,
      filePath: inputPath,
      isArchived: false,
      skipReason: "unsafe-path"
    };
  }

  const isArchived = isDocsArchivePath(projectPath);
  const blockedReason = getBlockedPathSkipReason(projectPath);

  if (blockedReason) {
    return {
      indexable: false,
      filePath: projectPath,
      isArchived,
      skipReason: blockedReason
    };
  }

  /**
   * The knowledge index has a narrower extension policy than general MCP reads.
   * It indexes only approved Markdown and MCP TypeScript sources so generated
   * or binary-like files cannot become shadow context.
   */
  if (!hasAllowedKnowledgeExtension(projectPath)) {
    return {
      indexable: false,
      filePath: projectPath,
      isArchived,
      skipReason: ALLOWED_EXTENSIONS.has(path.posix.extname(projectPath))
        ? "not-in-allowed-roots"
        : "unsupported-extension"
    };
  }

  if (isArchived && !shouldIncludeArchived(options.includeArchived)) {
    return {
      indexable: false,
      filePath: projectPath,
      isArchived,
      skipReason: "archive-excluded"
    };
  }

  if (!isAllowedKnowledgeRoot(projectPath)) {
    return {
      indexable: false,
      filePath: projectPath,
      isArchived,
      skipReason: "not-in-allowed-roots"
    };
  }

  if (
    typeof options.sizeBytes === "number" &&
    options.sizeBytes > MAX_KNOWLEDGE_FILE_BYTES
  ) {
    return {
      indexable: false,
      filePath: projectPath,
      sourceType: getKnowledgeSourceType(projectPath),
      isArchived,
      skipReason: "too-large"
    };
  }

  return {
    indexable: true,
    filePath: projectPath,
    sourceType: getKnowledgeSourceType(projectPath),
    isArchived
  };
}
