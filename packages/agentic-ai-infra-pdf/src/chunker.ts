/**
 * PDF-aware chunker: splits concatenated page text (with page markers) into
 * `KnowledgeChunk` records.
 *
 * Tables detected on each page are emitted as single preserved chunks
 * (never split mid-row). Remaining prose is routed through
 * `chunkMarkdownByHeadings` so heading structure inside PDFs is preserved.
 *
 * @module
 */

import type { KnowledgeChunk, KnowledgeChunkMetadata, KnowledgeSourceType } from "@maharudra/agentic-ai-infra-core";
import {
  createKnowledgeChunk,
  chunkMarkdownByHeadings,
  chunkTextWithFallback
} from "@maharudra/agentic-ai-infra-runtime";
import { detectTables } from "./table-detector.js";

// ---------------------------------------------------------------------------
// PdfChunkerParams
// ---------------------------------------------------------------------------

/**
 * Parameters for `pdfPageChunker`.
 *
 * `ChunkerParams` from `runtime/src/retrieval/chunkers.ts` is not exported,
 * so this is a compatible local definition (structural typing satisfies the
 * contract — Decision D-17C-6).
 */
export type PdfChunkerParams = {
  /**
   * Project-relative file path; recorded on every produced chunk.
   */
  readonly filePath: string;
  /**
   * Source type for all chunks produced from this file.
   * Should be `"pdf"` for PDF-sourced content.
   */
  readonly sourceType: KnowledgeSourceType;
  /**
   * SHA-256 hex digest of the raw PDF file bytes; used for freshness checks.
   */
  readonly fileHash: string;
  /**
   * Full concatenated page text with page markers.
   *
   * Expected format (emitted by the indexer's PDF branch):
   * ```
   * \n<!-- page-1 -->\n<page 1 text>\n<!-- page-2 -->\n<page 2 text>...
   * ```
   */
  readonly content: string;
  /**
   * Maximum tokens per prose chunk (fallback / heading).
   * Token estimate: `Math.ceil(content.length / 4)`.
   * Default: 512.
   */
  readonly maxTokens?: number;
  /**
   * Maximum total chunks to produce across all pages.
   *
   * **Default: 500** — intentionally higher than the default of 100 used for
   * text files. PDF documents can span hundreds of pages; capping at 100 would
   * silently discard most of a large document. Decision D-17C-4.
   */
  readonly maxChunks?: number;
  /**
   * Caller-supplied metadata merged into every produced chunk.
   */
  readonly metadata?: KnowledgeChunkMetadata;
};

// ---------------------------------------------------------------------------
// splitByPageMarkers — internal helper
// ---------------------------------------------------------------------------

type PageEntry = { readonly pageNumber: number; readonly text: string };

/**
 * Splits content produced by the indexer's PDF branch into per-page entries.
 *
 * Recognises the marker format `\n<!-- page-N -->\n` written by the indexer.
 * Text before the first marker is treated as page 0 and included only when
 * it is non-empty (edge case: some PDF libraries emit preamble text).
 *
 * Uses `String.split` with a capturing group so page numbers are extracted
 * from the same pass as the content split — no second pass needed.
 */
function splitByPageMarkers(content: string): PageEntry[] {
  // With a capturing group, split alternates: [before, num, text, num, text, ...]
  const parts = content.split(/\n<!-- page-(\d+) -->\n/);
  const result: PageEntry[] = [];

  // parts[0] is text before the first marker.
  const preamble = parts[0] ?? "";

  if (preamble.trim()) {
    result.push({ pageNumber: 0, text: preamble });
  }

  // Subsequent pairs: parts[i] = page number, parts[i+1] = page text.
  for (let i = 1; i < parts.length; i += 2) {
    const pageNumber = parseInt(parts[i] ?? "0", 10);
    const text = parts[i + 1] ?? "";
    result.push({ pageNumber, text });
  }

  return result;
}

// ---------------------------------------------------------------------------
// pdfPageChunker — public API
// ---------------------------------------------------------------------------

/**
 * Splits PDF page text (concatenated with page markers) into `KnowledgeChunk`
 * records, preserving tables as atomic chunks and splitting prose by headings.
 *
 * **Algorithm (per page):**
 * 1. `detectTables()` — identifies pipe-grid and tab-separated table regions.
 * 2. Each table → single preserved chunk (`chunkingStrategy: "fallback"`, never split).
 *    Metadata: `{ isTable: true, pageNumber: N }`.
 * 3. Remaining text → `chunkMarkdownByHeadings`, with `headingPath` prefixed by
 *    `"page-N"` so every chunk carries its page of origin.
 * 4. Processing stops when `maxChunks` is reached (default 500 — see D-17C-4).
 *
 * **Why `chunkingStrategy: "fallback"` for tables?**
 * No new `ChunkingStrategy` value is added to core (Decision D-17C-3).
 * Tables are preserved as opaque blobs — `"fallback"` correctly signals that
 * the content was not structurally analysed.
 *
 * @returns An array of `KnowledgeChunk` records, possibly empty for blank input.
 *
 * @example
 * ```typescript
 * const chunks = pdfPageChunker({
 *   filePath: "reports/q1-2025.pdf",
 *   sourceType: "pdf",
 *   fileHash: "abc123",
 *   content: extractedText,  // from the indexer's PDF branch
 *   maxChunks: 500
 * });
 * console.log(chunks.length);                   // total chunks produced
 * console.log(chunks[0]?.headingPath?.[0]);      // "page-1"
 * ```
 */
export function pdfPageChunker(params: PdfChunkerParams): readonly KnowledgeChunk[] {
  if (!params.content.trim()) return [];

  const maxChunks = params.maxChunks ?? 500;
  const maxTokens = params.maxTokens ?? 512;

  const pages = splitByPageMarkers(params.content);
  const allChunks: KnowledgeChunk[] = [];

  for (const page of pages) {
    if (allChunks.length >= maxChunks) break;
    if (!page.text.trim()) continue;

    const { tables, remainingText } = detectTables(page.text, page.pageNumber);

    // --- TABLE CHUNKS: one chunk per detected table, never split ---
    for (const table of tables) {
      if (allChunks.length >= maxChunks) break;

      allChunks.push(
        createKnowledgeChunk({
          filePath: params.filePath,
          sourceType: params.sourceType,
          fileHash: params.fileHash,
          chunkIndex: allChunks.length,
          headingPath: [`page-${page.pageNumber}`],
          content: table.markdown,
          // Tables are preserved as opaque blobs; "fallback" is the correct
          // strategy since no structural analysis is applied (D-17C-3).
          chunkingStrategy: "fallback",
          metadata: {
            ...(params.metadata ?? {}),
            isTable: true,
            pageNumber: page.pageNumber
          }
        })
      );
    }

    // --- PROSE CHUNKS: heading-based then sliding-window fallback ---
    if (remainingText.trim()) {
      const headingChunks = chunkMarkdownByHeadings({
        filePath: params.filePath,
        sourceType: params.sourceType,
        fileHash: params.fileHash,
        content: remainingText,
        maxTokens,
        maxChunks: maxChunks - allChunks.length,
        metadata: params.metadata
      });

      // Also try chunkTextWithFallback if headingChunks is empty
      const proseChunks =
        headingChunks.length > 0
          ? headingChunks
          : chunkTextWithFallback({
              filePath: params.filePath,
              sourceType: params.sourceType,
              fileHash: params.fileHash,
              content: remainingText,
              maxTokens,
              maxChunks: maxChunks - allChunks.length,
              metadata: params.metadata
            });

      for (const hc of proseChunks) {
        if (allChunks.length >= maxChunks) break;

        // Prepend "page-N" to the heading path so every chunk carries its
        // page of origin. KnowledgeChunk is readonly so we create a new chunk.
        const prefixedHeadingPath: readonly string[] = [
          `page-${page.pageNumber}`,
          ...(hc.headingPath ?? [])
        ];

        allChunks.push(
          createKnowledgeChunk({
            filePath: params.filePath,
            sourceType: params.sourceType,
            fileHash: params.fileHash,
            chunkIndex: allChunks.length,
            headingPath: prefixedHeadingPath,
            content: hc.content,
            chunkingStrategy: hc.chunkingStrategy,
            metadata: {
              ...(hc.metadata ?? {}),
              pageNumber: page.pageNumber
            }
          })
        );
      }
    }
  }

  return allChunks;
}
