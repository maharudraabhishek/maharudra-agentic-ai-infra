/**
 * PDF text extractor using pdf-parse with optional OCR for scanned pages.
 *
 * @module
 */

import { promises as fsPromises } from "node:fs";
import type { OcrProvider, ExtractedPage, PdfExtractionResult } from "./types.js";
import { NoopOcrProvider } from "./ocr.js";

/**
 * pdf-parse compatible parse function signature.
 *
 * Typed as a narrow subset of the real pdf-parse API so tests can inject a
 * mock without depending on the real library. Production callers pass the
 * real `pdf-parse` default export.
 */
export type ParsePdfFn = (
  buffer: Buffer,
  options?: { pagerender?: (pageData: unknown) => Promise<string> }
) => Promise<{ numpages: number; text: string }>;

/**
 * Options for `PdfExtractor`.
 */
export type PdfExtractorOptions = {
  /**
   * OCR provider invoked for scanned pages.
   *
   * Defaults to `NoopOcrProvider`. Pass a `TesseractOcrProvider` or custom
   * implementation to enable OCR. The provider must never throw — it must
   * return an empty string on failure.
   */
  ocrProvider?: OcrProvider;

  /**
   * Rasterizes a PDF page to an image buffer for OCR.
   *
   * Called only when a page is detected as scanned (`text.length < scannedPageThreshold`)
   * and an `ocrProvider` is configured. When absent, scanned pages are left with
   * empty text and a warning is appended — CI remains clean.
   *
   * @param pageNumber - 1-indexed page number.
   * @returns Image buffer (PNG or JPEG), or `null` to skip this page.
   */
  rasterizePage?: (pageNumber: number) => Promise<Buffer | null>;

  /**
   * Number of characters below which a page is considered scanned (image-only).
   *
   * Default: 50. Increase for PDFs with sparse text layouts.
   */
  scannedPageThreshold?: number;
};

/** Minimum text length for a page to be considered text-bearing (not scanned). */
const DEFAULT_SCANNED_THRESHOLD = 50;

/**
 * Extracts text from PDF files on a per-page basis.
 *
 * Scanned pages (text layer < `scannedPageThreshold` chars) are detected and,
 * when a `rasterizePage` callback and `ocrProvider` are supplied, submitted
 * for OCR. Without those, scanned pages produce empty text with a warning in
 * `PdfExtractionResult.warnings` — the extractor never crashes.
 *
 * `parsePdf` is injected rather than imported at module level so tests can
 * supply a mock without module-patching. When not provided (e.g. when the
 * indexer calls `new PdfExtractor()` from a dynamic import), `pdf-parse` is
 * loaded dynamically at the point of extraction — keeping CI clean and
 * avoiding a mandatory static import in environments that don't use PDF.
 *
 * Similarly, `fileBuffer` is optional in `extractPages`: when omitted the
 * file is read from `filePath` so the indexer can call `extractPages(absPath)`
 * without reading the buffer itself. Tests still pass an explicit buffer for
 * determinism (backward-compatible: the second parameter was required before
 * Stage 17C).
 *
 * @example
 * ```typescript
 * // Test usage (mock injected):
 * const extractor = new PdfExtractor(mockParsePdf);
 * const result = await extractor.extractPages("/path/to/doc.pdf", buffer);
 *
 * // Runtime usage (no injection — pdf-parse and file read are automatic):
 * const extractor = new PdfExtractor();
 * const result = await extractor.extractPages("/path/to/doc.pdf");
 * ```
 */
export class PdfExtractor {
  private readonly ocrProvider: OcrProvider;
  private readonly rasterizePage?: (pageNumber: number) => Promise<Buffer | null>;
  private readonly scannedThreshold: number;

  constructor(
    private readonly parsePdf?: ParsePdfFn,
    options: PdfExtractorOptions = {}
  ) {
    this.ocrProvider = options.ocrProvider ?? new NoopOcrProvider();
    this.rasterizePage = options.rasterizePage;
    this.scannedThreshold = options.scannedPageThreshold ?? DEFAULT_SCANNED_THRESHOLD;
  }

  /**
   * Extracts all pages from a PDF file or buffer.
   *
   * When `fileBuffer` is omitted the file is read from `filePath`. When
   * `parsePdf` was not supplied to the constructor, `pdf-parse` is imported
   * dynamically (requires the package to be installed at runtime).
   *
   * Each page is represented as an `ExtractedPage`. Pages whose text layer
   * falls below `scannedPageThreshold` chars are marked `isScanned: true`.
   * When a `rasterizePage` callback is present, scanned pages are submitted
   * to the configured `ocrProvider`; otherwise they produce empty text and
   * a warning is recorded.
   *
   * @param filePath - Absolute path to the PDF file.
   * @param fileBuffer - Raw PDF bytes. When absent the file is read from `filePath`.
   * @returns `PdfExtractionResult` containing all pages, tables (populated by
   *   the chunker from the indexer's PDF branch), and any non-fatal warnings.
   */
  async extractPages(filePath: string, fileBuffer?: Buffer): Promise<PdfExtractionResult> {
    const warnings: string[] = [];
    const perPageTexts: string[] = [];

    // Resolve the file buffer — read from disk when the caller did not supply it.
    const resolvedBuffer: Buffer =
      fileBuffer ?? (await fsPromises.readFile(filePath));

    // Resolve the parse function — dynamic import when not injected via constructor.
    const parseFn: ParsePdfFn =
      this.parsePdf ??
      ((await import("pdf-parse")) as { default: ParsePdfFn }).default;

    // pdf-parse collects per-page text via the pagerender callback.
    // Each invocation pushes to perPageTexts in page order.
    await parseFn(resolvedBuffer, {
      pagerender: async (pageData: unknown) => {
        // pdf-parse passes a PDF.js page object. Cast to access getTextContent.
        const page = pageData as {
          getTextContent: () => Promise<{ items: Array<{ str: string }> }>;
        };
        const content = await page.getTextContent();
        const text = content.items.map((item) => item.str).join(" ");
        perPageTexts.push(text);
        return text;
      }
    });

    // Build per-page results, running OCR on scanned pages when possible.
    const pages: ExtractedPage[] = [];

    for (let i = 0; i < perPageTexts.length; i++) {
      const pageNumber = i + 1;
      const rawText = perPageTexts[i] ?? "";
      const isScanned = rawText.length < this.scannedThreshold;

      let finalText = rawText;

      if (isScanned) {
        if (this.rasterizePage) {
          const imageBuffer = await this.rasterizePage(pageNumber);

          if (imageBuffer) {
            finalText = await this.ocrProvider.recognize(imageBuffer);
          } else {
            warnings.push(
              `Page ${pageNumber}: scanned page detected but rasterizePage returned null — text will be empty.`
            );
          }
        } else {
          warnings.push(
            `Page ${pageNumber}: scanned page detected (text < ${this.scannedThreshold} chars). ` +
              `No rasterizePage callback configured — text will be empty. ` +
              `Pass rasterizePage + an OcrProvider to enable OCR.`
          );
        }
      }

      pages.push({ pageNumber, text: finalText, isScanned });
    }

    return {
      filePath,
      pageCount: pages.length,
      pages,
      tables: [], // Table detection runs in pdfPageChunker (Stage 17C)
      extractedAt: new Date().toISOString(),
      warnings
    };
  }
}
