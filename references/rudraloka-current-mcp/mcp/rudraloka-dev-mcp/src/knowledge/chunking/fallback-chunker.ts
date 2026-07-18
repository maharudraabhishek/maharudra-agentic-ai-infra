import {
  DEFAULT_FALLBACK_CHUNK_CHARS,
  DEFAULT_FALLBACK_CHUNK_OVERLAP_CHARS,
  MAX_KNOWLEDGE_CHUNKS_PER_FILE
} from "../../config/mcp-config.js";
import { sha256 } from "../../utils/crypto.js";
import type {
  ChunkingStrategy,
  IncludedKnowledgeScanFile,
  KnowledgeChunk,
  KnowledgeChunkMetadata
} from "./chunk-types.js";

export function estimateTokenCount(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function createKnowledgeChunk(params: {
  scannedFile: IncludedKnowledgeScanFile;
  chunkIndex: number;
  content: string;
  chunkingStrategy: ChunkingStrategy;
  headingPath?: string[];
  symbolName?: string;
  metadata?: KnowledgeChunkMetadata;
}): KnowledgeChunk {
  const contentHash = sha256(params.content);

  return {
    chunkId: `chunk_${sha256(
      `${params.scannedFile.filePath}\n${contentHash}\n${params.chunkIndex}`
    ).slice(0, 32)}`,
    filePath: params.scannedFile.filePath,
    sourceType: params.scannedFile.sourceType,
    fileHash: params.scannedFile.fileHash,
    chunkIndex: params.chunkIndex,
    headingPath: params.headingPath,
    symbolName: params.symbolName,
    content: params.content,
    contentHash,
    chunkingStrategy: params.chunkingStrategy,
    tokenEstimate: estimateTokenCount(params.content),
    metadata: params.metadata ?? {}
  };
}

function chooseBoundary(
  text: string,
  start: number,
  targetEnd: number,
  maxChunkChars: number
): number {
  if (targetEnd >= text.length) {
    return text.length;
  }

  const minimumUsefulEnd = start + Math.floor(maxChunkChars * 0.6);
  const newlineIndex = text.lastIndexOf("\n", targetEnd);

  if (newlineIndex > minimumUsefulEnd) {
    return newlineIndex;
  }

  const spaceIndex = text.lastIndexOf(" ", targetEnd);

  if (spaceIndex > minimumUsefulEnd) {
    return spaceIndex;
  }

  return targetEnd;
}

export function chunkTextWithFallback(params: {
  text: string;
  scannedFile: IncludedKnowledgeScanFile;
  startingChunkIndex?: number;
  headingPath?: string[];
  symbolName?: string;
  chunkingStrategy?: ChunkingStrategy;
  metadata?: KnowledgeChunkMetadata;
  maxChunkChars?: number;
  overlapChars?: number;
  maxChunks?: number;
}): KnowledgeChunk[] {
  const maxChunkChars =
    params.maxChunkChars ?? DEFAULT_FALLBACK_CHUNK_CHARS;
  const overlapChars =
    params.overlapChars ?? DEFAULT_FALLBACK_CHUNK_OVERLAP_CHARS;
  const maxChunks = Math.min(
    params.maxChunks ?? MAX_KNOWLEDGE_CHUNKS_PER_FILE,
    MAX_KNOWLEDGE_CHUNKS_PER_FILE
  );
  const content = params.text.trim();

  if (content.length === 0 || maxChunks <= 0) {
    return [];
  }

  /**
   * Fallback chunking uses medium windows plus light overlap. The window keeps
   * preview output bounded; the overlap reduces the chance that a sentence or
   * code block split at a boundary loses the context needed for later retrieval.
   */
  const chunks: KnowledgeChunk[] = [];
  let start = 0;

  while (start < content.length && chunks.length < maxChunks) {
    const targetEnd = Math.min(start + maxChunkChars, content.length);
    const end = chooseBoundary(content, start, targetEnd, maxChunkChars);
    const chunkContent = content.slice(start, end).trim();

    if (chunkContent.length > 0) {
      chunks.push(
        createKnowledgeChunk({
          scannedFile: params.scannedFile,
          chunkIndex: (params.startingChunkIndex ?? 0) + chunks.length,
          content: chunkContent,
          chunkingStrategy: params.chunkingStrategy ?? "fallback",
          headingPath: params.headingPath,
          symbolName: params.symbolName,
          metadata: {
            ...(params.metadata ?? {}),
            fallbackChunkStart: start,
            fallbackChunkEnd: end,
            fallbackOverlapChars: overlapChars,
            truncatedByChunkLimit:
              chunks.length + 1 === maxChunks && end < content.length
          }
        })
      );
    }

    if (end >= content.length) {
      break;
    }

    const nextStart = Math.max(0, end - overlapChars);
    start = nextStart > start ? nextStart : end;
  }

  return chunks;
}
