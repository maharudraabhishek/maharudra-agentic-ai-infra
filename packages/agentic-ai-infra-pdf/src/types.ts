import type { KnowledgeSourceType } from "@maharudra/agentic-ai-infra-core";

/**
 * One extracted page from a PDF document.
 *
 * `isScanned` is true when the text layer contains fewer than 50 characters —
 * a heuristic indicating the page is image-only and requires OCR to be readable.
 */
export type ExtractedPage = {
  readonly pageNumber: number;
  readonly text: string;
  readonly isScanned: boolean;
};

/**
 * A table detected within a page's text content.
 *
 * Tables are preserved as single chunks to keep row/column relationships intact.
 * `markdown` contains the table rendered as a GFM markdown table.
 */
export type MarkdownTable = {
  readonly pageNumber: number;
  readonly markdown: string;
  readonly rowCount: number;
  readonly colCount: number;
};

/**
 * Aggregate result of extracting all pages from a PDF file.
 */
export type PdfExtractionResult = {
  readonly filePath: string;
  readonly pageCount: number;
  readonly pages: readonly ExtractedPage[];
  readonly tables: readonly MarkdownTable[];
  /** ISO-8601 timestamp of when extraction completed. */
  readonly extractedAt: string;
  /**
   * Non-fatal warnings from extraction (scanned pages without OCR, etc.).
   * Empty array when extraction completed without any degraded pages.
   */
  readonly warnings: readonly string[];
};

/**
 * Interface for an OCR provider that can extract text from image data.
 *
 * Implementations must be safe to call when the underlying OCR library is absent —
 * they must return an empty string and log a warning rather than throwing.
 */
export interface OcrProvider {
  /**
   * Extracts text from a rasterized page image.
   *
   * @param imageBuffer - Raw image bytes (PNG or JPEG).
   * @returns Extracted text, or an empty string when OCR is unavailable.
   */
  recognize(imageBuffer: Buffer): Promise<string>;
}

/**
 * Source type constant for PDF chunks.
 *
 * Typed as `KnowledgeSourceType` to satisfy the core contract; the value `"pdf"` was
 * added to `KNOWLEDGE_SOURCE_TYPES` in P2.5 Stage 17A.
 */
export const PDF_SOURCE_TYPE: KnowledgeSourceType = "pdf";
