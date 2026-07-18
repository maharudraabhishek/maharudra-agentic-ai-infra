import fs from "node:fs/promises";
import path from "node:path";
import {
  MAX_CHUNK_PREVIEW_CHARS,
  MAX_KNOWLEDGE_CHUNKS_PER_FILE,
  MAX_KNOWLEDGE_FILE_BYTES
} from "../../config/mcp-config.js";
import { normalizeProjectPath } from "../../security/path-policy.js";
import type {
  ChunkPreview,
  ChunkPreviewReport,
  IncludedKnowledgeScanFile,
  KnowledgeChunk,
  KnowledgeScanFile
} from "./chunk-types.js";
import { chunkTextWithFallback } from "./fallback-chunker.js";
import { chunkMarkdownByHeadings } from "./markdown-chunker.js";
import { chunkTypeScriptByAst } from "./typescript-ast-chunker.js";
import { isIndexableProjectPath } from "../indexing/indexing-policy.js";
import { createKnowledgeFileHashes } from "../indexing/project-scanner.js";

export type ProjectFileChunkResult = {
  filePath: string;
  sourceType: IncludedKnowledgeScanFile["sourceType"];
  fileHash: string;
  contentHash: string;
  sizeBytes: number;
  isArchived: boolean;
  totalChunks: number;
  chunkingStrategies: Array<KnowledgeChunk["chunkingStrategy"]>;
  warnings: string[];
  chunks: KnowledgeChunk[];
};

function assertIncludedScannedFile(
  scannedFile: KnowledgeScanFile
): IncludedKnowledgeScanFile {
  if (
    scannedFile.status !== "included" ||
    !scannedFile.sourceType ||
    !scannedFile.fileHash ||
    !scannedFile.contentHash
  ) {
    throw new Error("Access denied: file is not included by the knowledge scanner.");
  }

  return scannedFile as IncludedKnowledgeScanFile;
}

function truncatePreview(content: string, maxChars: number): string {
  if (content.length <= maxChars) {
    return content;
  }

  return `${content.slice(0, maxChars)}\n[chunk preview truncated]`;
}

function toChunkPreview(chunk: KnowledgeChunk, maxChars: number): ChunkPreview {
  const { content, ...safeChunk } = chunk;
  const preview = truncatePreview(content, maxChars);

  return {
    ...safeChunk,
    preview,
    previewLength: preview.length
  };
}

function collectWarnings(params: {
  chunks: KnowledgeChunk[];
  totalChunks: number;
  returnedChunks: number;
  fileChanged: boolean;
}): string[] {
  const warnings = new Set<string>();

  if (params.fileChanged) {
    warnings.add("file-changed-after-scan");
  }

  if (params.returnedChunks < params.totalChunks) {
    warnings.add("preview-truncated-by-maxChunks");
  }

  for (const chunk of params.chunks) {
    if (chunk.metadata.truncatedByChunkLimit === true) {
      warnings.add("chunks-truncated-by-file-limit");
    }

    if (typeof chunk.metadata.safeFallbackReason === "string") {
      warnings.add(chunk.metadata.safeFallbackReason);
    }
  }

  return Array.from(warnings).sort();
}

function dispatchChunker(params: {
  text: string;
  scannedFile: IncludedKnowledgeScanFile;
}): KnowledgeChunk[] {
  const extension = path.posix.extname(params.scannedFile.filePath).toLowerCase();

  if (extension === ".md") {
    return chunkMarkdownByHeadings({
      text: params.text,
      scannedFile: params.scannedFile,
      maxChunks: MAX_KNOWLEDGE_CHUNKS_PER_FILE
    });
  }

  if (extension === ".ts" || extension === ".tsx") {
    return chunkTypeScriptByAst({
      text: params.text,
      scannedFile: params.scannedFile,
      maxChunks: MAX_KNOWLEDGE_CHUNKS_PER_FILE
    });
  }

  return chunkTextWithFallback({
    text: params.text,
    scannedFile: params.scannedFile,
    maxChunks: MAX_KNOWLEDGE_CHUNKS_PER_FILE
  });
}

export async function createProjectFileChunks(params: {
  scannedFile: KnowledgeScanFile;
}): Promise<ProjectFileChunkResult> {
  const scannedFile = assertIncludedScannedFile(params.scannedFile);
  const fullPath = normalizeProjectPath(scannedFile.filePath);
  const stat = await fs.lstat(fullPath);

  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error("Access denied: knowledge preview target is not a safe file.");
  }

  if (stat.size > MAX_KNOWLEDGE_FILE_BYTES) {
    throw new Error("Access denied: knowledge preview target exceeds file limit.");
  }

  const policy = isIndexableProjectPath(scannedFile.filePath, {
    includeArchived: scannedFile.isArchived,
    sizeBytes: stat.size
  });

  if (!policy.indexable || !policy.sourceType) {
    throw new Error("Access denied: file is not indexable by knowledge policy.");
  }

  const text = await fs.readFile(fullPath, "utf8");
  const hashes = createKnowledgeFileHashes({
    filePath: policy.filePath,
    sizeBytes: stat.size,
    content: text
  });
  const currentScannedFile: IncludedKnowledgeScanFile = {
    ...scannedFile,
    filePath: policy.filePath,
    sourceType: policy.sourceType,
    fileHash: hashes.fileHash,
    contentHash: hashes.contentHash,
    sizeBytes: stat.size,
    isArchived: policy.isArchived
  };
  const chunks = dispatchChunker({
    text,
    scannedFile: currentScannedFile
  });
  const fileChanged =
    hashes.fileHash !== scannedFile.fileHash ||
    hashes.contentHash !== scannedFile.contentHash;

  return {
    filePath: currentScannedFile.filePath,
    sourceType: currentScannedFile.sourceType,
    fileHash: currentScannedFile.fileHash,
    contentHash: currentScannedFile.contentHash,
    sizeBytes: currentScannedFile.sizeBytes,
    isArchived: currentScannedFile.isArchived,
    totalChunks: chunks.length,
    chunkingStrategies: Array.from(
      new Set(chunks.map((chunk) => chunk.chunkingStrategy))
    ),
    warnings: collectWarnings({
      chunks,
      totalChunks: chunks.length,
      returnedChunks: chunks.length,
      fileChanged
    }),
    chunks
  };
}

export async function chunkProjectFile(params: {
  scannedFile: KnowledgeScanFile;
  maxChunks?: number;
  maxPreviewChars?: number;
}): Promise<ChunkPreviewReport> {
  const previewChunkLimit = Math.min(
    Math.max(1, params.maxChunks ?? 10),
    MAX_KNOWLEDGE_CHUNKS_PER_FILE
  );
  const maxPreviewChars = Math.min(
    Math.max(80, params.maxPreviewChars ?? MAX_CHUNK_PREVIEW_CHARS),
    MAX_CHUNK_PREVIEW_CHARS
  );
  const chunkResult = await createProjectFileChunks({
    scannedFile: params.scannedFile
  });
  const returnedChunks = chunkResult.chunks.slice(0, previewChunkLimit);
  const warnings = Array.from(
    new Set([
      ...chunkResult.warnings,
      ...collectWarnings({
        chunks: chunkResult.chunks,
        totalChunks: chunkResult.totalChunks,
        returnedChunks: returnedChunks.length,
        fileChanged: false
      })
    ])
  ).sort();

  return {
    filePath: chunkResult.filePath,
    sourceType: chunkResult.sourceType,
    fileHash: chunkResult.fileHash,
    contentHash: chunkResult.contentHash,
    sizeBytes: chunkResult.sizeBytes,
    isArchived: chunkResult.isArchived,
    maxChunks: previewChunkLimit,
    maxPreviewChars,
    totalChunks: chunkResult.totalChunks,
    returnedChunks: returnedChunks.length,
    chunkingStrategies: chunkResult.chunkingStrategies,
    warnings,
    chunks: returnedChunks.map((chunk) => toChunkPreview(chunk, maxPreviewChars))
  };
}
