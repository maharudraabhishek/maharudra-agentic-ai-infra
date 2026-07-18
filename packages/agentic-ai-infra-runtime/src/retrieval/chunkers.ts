import { createHash } from "node:crypto";
import type {
  ChunkingStrategy,
  KnowledgeChunk,
  KnowledgeChunkMetadata,
  KnowledgeSourceType
} from "@maharudra/agentic-ai-infra-core";

// ---------------------------------------------------------------------------
// Shared parameters type used by all chunker functions
// ---------------------------------------------------------------------------

type ChunkerParams = {
  /** Project-relative file path; included in every produced chunk. */
  readonly filePath: string;
  /** Source category classification for this file. */
  readonly sourceType: KnowledgeSourceType;
  /** SHA-256 hex digest of the full file; used for freshness checks. */
  readonly fileHash: string;
  /** Raw file content to split into chunks. */
  readonly content: string;
  /**
   * Maximum tokens per chunk.
   * Token estimate: `Math.max(1, Math.ceil(content.length / 4))`.
   * Default: 512.
   */
  readonly maxTokens?: number;
  /**
   * Maximum number of chunks produced for this file.
   * Prevents runaway chunking on very large files.
   * Default: 100.
   */
  readonly maxChunks?: number;
  /** Caller-supplied metadata merged into every chunk. */
  readonly metadata?: KnowledgeChunkMetadata;
};

type FallbackParams = ChunkerParams & {
  /**
   * Overlap in tokens between adjacent sliding-window chunks.
   * Overlap preserves cross-boundary context without duplicating full chunks.
   * Default: 64 tokens.
   */
  readonly overlapTokens?: number;
};

// ---------------------------------------------------------------------------
// createKnowledgeChunk — factory
// ---------------------------------------------------------------------------

type CreateChunkParams = {
  readonly filePath: string;
  readonly sourceType: KnowledgeSourceType;
  readonly fileHash: string;
  readonly chunkIndex: number;
  readonly headingPath?: readonly string[];
  readonly symbolName?: string;
  readonly content: string;
  readonly chunkingStrategy: ChunkingStrategy;
  readonly metadata?: KnowledgeChunkMetadata;
};

/**
 * Creates a single `KnowledgeChunk` with stable SHA-256–derived identifiers.
 *
 * - `contentHash`: `SHA256(content)` hex digest
 * - `chunkId`: `SHA256("<filePath>:<chunkIndex>:<contentHash[0..7]>")` hex digest
 * - `tokenEstimate`: `Math.max(1, Math.ceil(content.length / 4))`
 *
 * All chunker functions in this module delegate chunk construction to this
 * factory so id derivation and token estimation are consistent across strategies.
 *
 * @example
 * ```typescript
 * const chunk = createKnowledgeChunk({
 *   filePath: "docs/04-core-framework/retrieval-providers.md",
 *   sourceType: "framework-doc",
 *   fileHash: "abc123",
 *   chunkIndex: 0,
 *   content: "## Embedding Providers\n\nEmbedding providers convert text…",
 *   chunkingStrategy: "markdown-heading"
 * });
 * console.log(chunk.chunkId);       // stable SHA-256 hex
 * console.log(chunk.tokenEstimate); // heuristic token count
 * ```
 */
export function createKnowledgeChunk(params: CreateChunkParams): KnowledgeChunk {
  const contentHash = createHash("sha256").update(params.content, "utf8").digest("hex");
  const chunkId = createHash("sha256")
    .update(`${params.filePath}:${params.chunkIndex}:${contentHash.slice(0, 8)}`, "utf8")
    .digest("hex");
  const tokenEstimate = Math.max(1, Math.ceil(params.content.length / 4));

  return {
    chunkId,
    filePath: params.filePath,
    sourceType: params.sourceType,
    fileHash: params.fileHash,
    chunkIndex: params.chunkIndex,
    headingPath: params.headingPath,
    symbolName: params.symbolName,
    content: params.content,
    contentHash,
    chunkingStrategy: params.chunkingStrategy,
    tokenEstimate,
    metadata: params.metadata ?? {}
  };
}

// ---------------------------------------------------------------------------
// chunkTextWithFallback — sliding window
// ---------------------------------------------------------------------------

/**
 * Splits text content into overlapping sliding-window chunks.
 *
 * Used as the fallback strategy when markdown headings or TypeScript symbols
 * are absent, and as a sub-chunker when an individual section or symbol body
 * exceeds `maxTokens`.
 *
 * Split boundaries prefer newline positions to avoid cutting mid-sentence, then
 * fall back to space positions, then hard-cut at the character limit. Each
 * subsequent window starts `overlapTokens * 4` characters before the end of
 * the previous one so cross-boundary context is preserved.
 *
 * A `truncated: true` metadata flag is set on the last chunk when `maxChunks`
 * is reached before the full content is covered.
 *
 * Returns `[]` for empty or whitespace-only content. Never throws on valid text.
 *
 * @example
 * ```typescript
 * const chunks = chunkTextWithFallback({
 *   filePath: "packages/core/src/retrieval/types.ts",
 *   sourceType: "typescript-source",
 *   fileHash: "abc123",
 *   content: longSourceText,
 *   maxTokens: 512,
 *   overlapTokens: 64
 * });
 * console.log(chunks.length);                     // number of produced chunks
 * console.log(chunks[0]?.chunkingStrategy);        // "fallback"
 * ```
 */
export function chunkTextWithFallback(params: FallbackParams): readonly KnowledgeChunk[] {
  if (!params.content.trim()) return [];

  const maxTokens = params.maxTokens ?? 512;
  const overlapTokens = params.overlapTokens ?? 64;
  const maxChunks = params.maxChunks ?? 100;
  const maxChars = maxTokens * 4;
  const overlapChars = overlapTokens * 4;

  // Short content that fits within one chunk: return immediately without slicing.
  if (params.content.length <= maxChars) {
    return [
      createKnowledgeChunk({
        filePath: params.filePath,
        sourceType: params.sourceType,
        fileHash: params.fileHash,
        chunkIndex: 0,
        content: params.content,
        chunkingStrategy: "fallback",
        metadata: params.metadata
      })
    ];
  }

  const chunks: KnowledgeChunk[] = [];
  let start = 0;

  while (start < params.content.length && chunks.length < maxChunks) {
    let end = Math.min(start + maxChars, params.content.length);
    const isFinalWindow = end >= params.content.length;

    if (!isFinalWindow) {
      // Prefer a newline boundary so chunks start at natural paragraph breaks.
      const newlinePos = params.content.lastIndexOf("\n", end);

      if (newlinePos > start + overlapChars) {
        end = newlinePos + 1;
      } else {
        // Fall back to space boundary to avoid splitting words.
        const spacePos = params.content.lastIndexOf(" ", end);

        if (spacePos > start + overlapChars) {
          end = spacePos + 1;
        }
        // Otherwise hard-cut at maxChars — rare for prose, acceptable for minified text.
      }
    }

    const chunkContent = params.content.slice(start, end);
    const willTruncate = !isFinalWindow && chunks.length + 1 >= maxChunks;

    chunks.push(
      createKnowledgeChunk({
        filePath: params.filePath,
        sourceType: params.sourceType,
        fileHash: params.fileHash,
        chunkIndex: chunks.length,
        content: chunkContent,
        chunkingStrategy: "fallback",
        metadata: {
          ...(params.metadata ?? {}),
          ...(willTruncate ? { truncated: true } : {})
        }
      })
    );

    if (isFinalWindow) break;

    // Advance start with overlap so adjacent chunks share context.
    const nextStart = end - overlapChars;

    if (nextStart <= start) break;
    start = nextStart;
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// chunkMarkdownByHeadings — semantic Markdown chunker
// ---------------------------------------------------------------------------

/**
 * Splits a Markdown file into chunks at heading boundaries (H1–H6).
 *
 * Each chunk contains the heading line and all content until the next heading
 * at any depth. Headings inside fenced code blocks (``` or ~~~) are never
 * treated as split points, so code examples that happen to contain `# comment`
 * are preserved intact.
 *
 * The `headingPath` field on each chunk records the ordered ancestry of
 * heading titles from H1 down to the current section, e.g.:
 * `["Retrieval Providers", "Embedding Providers", "MockEmbeddingProvider"]`
 *
 * If an individual section exceeds `maxTokens`, it is sub-chunked with
 * `chunkTextWithFallback` while preserving the `headingPath` context.
 *
 * Falls back entirely to `chunkTextWithFallback` if no headings are found.
 * Never throws on valid text; returns `[]` for empty input.
 *
 * @example
 * ```typescript
 * const chunks = chunkMarkdownByHeadings({
 *   filePath: "docs/04-core-framework/retrieval-providers.md",
 *   sourceType: "framework-doc",
 *   fileHash: "abc123",
 *   content: markdownText
 * });
 * console.log(chunks[0]?.headingPath);         // ["Provider Types"]
 * console.log(chunks[0]?.chunkingStrategy);    // "markdown-heading"
 * ```
 */
export function chunkMarkdownByHeadings(params: ChunkerParams): readonly KnowledgeChunk[] {
  if (!params.content.trim()) return [];

  const maxTokens = params.maxTokens ?? 512;
  const maxChunks = params.maxChunks ?? 100;

  type Section = { headingPath: readonly string[]; content: string };

  const lines = params.content.split(/\r?\n/);
  const sections: Section[] = [];
  // Mutable heading stack: index = depth-1 (H1 at 0, H6 at 5).
  const headingStack: string[] = [];
  let currentLines: string[] = [];
  let inCodeFence = false;

  for (const line of lines) {
    // Track open/close of fenced code blocks; a heading inside a fence is code, not structure.
    if (/^(?:```|~~~)/.test(line)) {
      inCodeFence = !inCodeFence;
      currentLines.push(line);
      continue;
    }

    if (!inCodeFence) {
      const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);

      if (headingMatch) {
        if (currentLines.length > 0) {
          sections.push({ headingPath: [...headingStack], content: currentLines.join("\n") });
        }

        const depth = headingMatch[1]!.length;
        const heading = headingMatch[2]!.trim();

        // Truncate the stack at the current depth level so H3 following H2 doesn't
        // accumulate extra H2-level entries from siblings.
        headingStack.length = depth - 1;
        headingStack[depth - 1] = heading;
        currentLines = [line];
        continue;
      }
    }

    currentLines.push(line);
  }

  // Flush the final section.
  if (currentLines.length > 0) {
    sections.push({ headingPath: [...headingStack], content: currentLines.join("\n") });
  }

  // No headings found: fall back entirely to sliding-window chunker.
  if (sections.every((s) => s.headingPath.length === 0)) {
    return chunkTextWithFallback(params);
  }

  const chunks: KnowledgeChunk[] = [];

  for (const section of sections) {
    if (chunks.length >= maxChunks) break;
    if (!section.content.trim()) continue;

    const sectionTokens = Math.max(1, Math.ceil(section.content.length / 4));
    const headingPath = section.headingPath.length > 0 ? section.headingPath : undefined;

    if (sectionTokens <= maxTokens) {
      chunks.push(
        createKnowledgeChunk({
          filePath: params.filePath,
          sourceType: params.sourceType,
          fileHash: params.fileHash,
          chunkIndex: chunks.length,
          headingPath,
          content: section.content,
          chunkingStrategy: "markdown-heading",
          metadata: params.metadata
        })
      );
    } else {
      // Section is too large: sub-chunk with fallback, preserving headingPath on each sub-chunk.
      const subChunks = chunkTextWithFallback({
        filePath: params.filePath,
        sourceType: params.sourceType,
        fileHash: params.fileHash,
        content: section.content,
        maxTokens,
        maxChunks: maxChunks - chunks.length,
        metadata: params.metadata
      });

      for (const sub of subChunks) {
        if (chunks.length >= maxChunks) break;

        chunks.push(
          createKnowledgeChunk({
            filePath: params.filePath,
            sourceType: params.sourceType,
            fileHash: params.fileHash,
            chunkIndex: chunks.length,
            headingPath,
            content: sub.content,
            chunkingStrategy: "markdown-heading",
            metadata: sub.metadata
          })
        );
      }
    }
  }

  // If no non-empty sections produced any chunks, fall back.
  if (chunks.length === 0) {
    return chunkTextWithFallback(params);
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// chunkTypeScriptBySymbols — TypeScript symbol extraction
// ---------------------------------------------------------------------------

/**
 * Splits a TypeScript or TSX file into chunks at top-level export symbol
 * boundaries using regex pattern matching (no AST dependency).
 *
 * Recognized symbols: `export class`, `export abstract class`,
 * `export interface`, `export type`, `export function`, `export async function`,
 * `export const`, `export enum`, and their `declare` / re-export variants.
 *
 * Each chunk spans from one symbol declaration to the next. If a symbol body
 * exceeds `maxTokens` characters (× 4), it is hard-truncated at a line
 * boundary to avoid oversized chunks. The `symbolName` field carries the
 * extracted identifier for use by the `SymbolCodeProvider`.
 *
 * Falls back to `chunkTextWithFallback` when no symbols are found.
 * Never throws on valid text; returns `[]` for empty input.
 *
 * @example
 * ```typescript
 * const chunks = chunkTypeScriptBySymbols({
 *   filePath: "packages/core/src/retrieval/types.ts",
 *   sourceType: "typescript-source",
 *   fileHash: "abc123",
 *   content: tsSource
 * });
 * console.log(chunks[0]?.symbolName);         // "KNOWLEDGE_SOURCE_TYPES"
 * console.log(chunks[0]?.chunkingStrategy);   // "typescript-ast"
 * ```
 */
export function chunkTypeScriptBySymbols(params: ChunkerParams): readonly KnowledgeChunk[] {
  if (!params.content.trim()) return [];

  const maxTokens = params.maxTokens ?? 512;
  const maxChunks = params.maxChunks ?? 100;
  const maxChars = maxTokens * 4;

  // Regex matches top-level export declarations. The `gm` flags let `^` anchor
  // to line starts, which is critical for not matching nested re-exports inside
  // object literals or function bodies.
  const symbolPattern =
    /^(?:export\s+)?(?:declare\s+)?(?:export\s+)?(?:abstract\s+)?(?:async\s+)?(class|interface|type|function|const|enum)\s+([A-Za-z_$][\w$]*)/gm;

  // Build a parallel array of line-start offsets so we can convert character
  // offsets to line numbers without a second regex pass.
  const lines = params.content.split(/\r?\n/);
  const lineStartOffsets: number[] = [];
  let runningOffset = 0;

  for (const line of lines) {
    lineStartOffsets.push(runningOffset);
    runningOffset += line.length + 1; // +1 for the \n consumed by split
  }

  type SymbolBoundary = {
    readonly name: string;
    readonly kind: string;
    readonly lineNumber: number;
    readonly charOffset: number;
  };

  const boundaries: SymbolBoundary[] = [];

  for (const match of params.content.matchAll(symbolPattern)) {
    const charOffset = match.index ?? 0;
    let lineNumber = 0;

    for (let i = 0; i < lineStartOffsets.length; i++) {
      if ((lineStartOffsets[i + 1] ?? Infinity) > charOffset) {
        lineNumber = i + 1; // 1-based for metadata display
        break;
      }
    }

    boundaries.push({
      name: match[2] ?? "unknown",
      kind: match[1] ?? "symbol",
      lineNumber,
      charOffset
    });
  }

  // No recognizable exports: fall back to sliding-window chunker.
  if (boundaries.length === 0) {
    return chunkTextWithFallback(params);
  }

  const chunks: KnowledgeChunk[] = [];

  for (let i = 0; i < boundaries.length && chunks.length < maxChunks; i++) {
    const boundary = boundaries[i]!;
    const nextBoundary = boundaries[i + 1];
    const start = boundary.charOffset;
    const rawEnd = nextBoundary ? nextBoundary.charOffset : params.content.length;
    let symbolContent = params.content.slice(start, rawEnd).trimEnd();

    // Truncate oversized symbol bodies at a line boundary to preserve readability.
    if (symbolContent.length > maxChars) {
      const truncated = symbolContent.slice(0, maxChars);
      const lastNewline = truncated.lastIndexOf("\n");

      // Keep at least half the max to avoid very short stubs.
      symbolContent = lastNewline > maxChars / 2 ? truncated.slice(0, lastNewline) : truncated;
    }

    chunks.push(
      createKnowledgeChunk({
        filePath: params.filePath,
        sourceType: params.sourceType,
        fileHash: params.fileHash,
        chunkIndex: chunks.length,
        symbolName: boundary.name,
        content: symbolContent,
        chunkingStrategy: "typescript-ast",
        metadata: {
          ...(params.metadata ?? {}),
          symbolKind: boundary.kind,
          lineNumber: boundary.lineNumber
        }
      })
    );
  }

  if (chunks.length === 0) {
    return chunkTextWithFallback(params);
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// dispatchChunker — extension-based dispatch
// ---------------------------------------------------------------------------

/**
 * Routes a file to the appropriate chunking strategy based on its extension.
 *
 * Dispatch table:
 * - `.md`        → `chunkMarkdownByHeadings`
 * - `.ts`        → `chunkTypeScriptBySymbols`
 * - `.tsx`       → `chunkTypeScriptBySymbols`
 * - anything else → `chunkTextWithFallback`
 *
 * Each strategy falls back to `chunkTextWithFallback` internally when its
 * primary split approach finds no usable structure, so callers always receive
 * a non-empty result for non-empty content.
 *
 * Returns `[]` for empty or whitespace-only content regardless of extension.
 *
 * @example
 * ```typescript
 * const mdChunks = dispatchChunker({
 *   filePath: "docs/06-runbooks/retrieval-and-context-setup.md",
 *   sourceType: "runbook",
 *   fileHash: "abc123",
 *   content: markdownText
 * });
 * // mdChunks[0].chunkingStrategy === "markdown-heading"
 *
 * const tsChunks = dispatchChunker({
 *   filePath: "packages/core/src/retrieval/types.ts",
 *   sourceType: "typescript-source",
 *   fileHash: "def456",
 *   content: tsSourceText
 * });
 * // tsChunks[0].chunkingStrategy === "typescript-ast"
 * ```
 */
export function dispatchChunker(params: ChunkerParams): readonly KnowledgeChunk[] {
  const ext = params.filePath.split(".").pop()?.toLowerCase() ?? "";

  if (ext === "md") {
    return chunkMarkdownByHeadings(params);
  }

  if (ext === "ts" || ext === "tsx") {
    return chunkTypeScriptBySymbols(params);
  }

  return chunkTextWithFallback(params);
}
