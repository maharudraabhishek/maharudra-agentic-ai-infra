/**
 * Stage 17B — PdfExtractor unit tests.
 *
 * All tests use a mock `parsePdf` function — no real files, no network, no disk reads.
 * The mock simulates pdf-parse's pagerender callback protocol so tests verify
 * per-page text extraction, scanned-page detection, and OCR integration paths.
 */

import { describe, expect, it, vi } from "vitest";
import type { OcrProvider } from "../src/types.js";
import { NoopOcrProvider } from "../src/ocr.js";
import { PdfExtractor } from "../src/extractor.js";
import type { ParsePdfFn } from "../src/extractor.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a mock parsePdf that calls the pagerender callback once per entry in
 * `pageTexts`, simulating pdf-parse's per-page rendering protocol.
 */
function makeTextParsePdf(pageTexts: string[]): ParsePdfFn {
  return async (_buffer, options) => {
    if (options?.pagerender) {
      for (const text of pageTexts) {
        await options.pagerender({
          getTextContent: async () => ({
            items: [{ str: text }]
          })
        });
      }
    }
    return { numpages: pageTexts.length, text: pageTexts.join(" ") };
  };
}

const LONG_TEXT = "a".repeat(60);  // 60 chars — safely above default threshold of 50
const SHORT_TEXT = "short";        // 5 chars — safely below default threshold of 50
const DUMMY_BUFFER = Buffer.from("");
const DUMMY_PATH = "/path/to/doc.pdf";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PdfExtractor", () => {

  describe("extractPages — text extraction", () => {

    it("returns one ExtractedPage per page from parsePdf", async () => {
      const extractor = new PdfExtractor(makeTextParsePdf([LONG_TEXT, LONG_TEXT]));
      const result = await extractor.extractPages(DUMMY_PATH, DUMMY_BUFFER);
      expect(result.pages).toHaveLength(2);
    });

    it("sets isScanned: false when page text exceeds threshold", async () => {
      const extractor = new PdfExtractor(makeTextParsePdf([LONG_TEXT]));
      const result = await extractor.extractPages(DUMMY_PATH, DUMMY_BUFFER);
      expect(result.pages[0].isScanned).toBe(false);
    });

    it("sets pageNumber correctly (1-indexed)", async () => {
      const extractor = new PdfExtractor(makeTextParsePdf([LONG_TEXT, LONG_TEXT]));
      const result = await extractor.extractPages(DUMMY_PATH, DUMMY_BUFFER);
      expect(result.pages[0].pageNumber).toBe(1);
      expect(result.pages[1].pageNumber).toBe(2);
    });

    it("returns empty tables array (Stage 17C deferred)", async () => {
      const extractor = new PdfExtractor(makeTextParsePdf([LONG_TEXT]));
      const result = await extractor.extractPages(DUMMY_PATH, DUMMY_BUFFER);
      expect(result.tables).toEqual([]);
    });

    it("sets extractedAt as a valid ISO-8601 string", async () => {
      const extractor = new PdfExtractor(makeTextParsePdf([LONG_TEXT]));
      const result = await extractor.extractPages(DUMMY_PATH, DUMMY_BUFFER);
      expect(new Date(result.extractedAt).toISOString()).toBe(result.extractedAt);
    });

  });

  describe("scanned page detection", () => {

    it("sets isScanned: true when page text is below default threshold (50 chars)", async () => {
      const extractor = new PdfExtractor(makeTextParsePdf([SHORT_TEXT]));
      const result = await extractor.extractPages(DUMMY_PATH, DUMMY_BUFFER);
      expect(result.pages[0].isScanned).toBe(true);
    });

    it("sets isScanned: false when page text exactly equals threshold", async () => {
      const exactText = "a".repeat(50);
      const extractor = new PdfExtractor(makeTextParsePdf([exactText]));
      const result = await extractor.extractPages(DUMMY_PATH, DUMMY_BUFFER);
      expect(result.pages[0].isScanned).toBe(false);
    });

    it("respects custom scannedPageThreshold from options", async () => {
      const text = "a".repeat(30);
      const extractor = new PdfExtractor(makeTextParsePdf([text]), { scannedPageThreshold: 100 });
      const result = await extractor.extractPages(DUMMY_PATH, DUMMY_BUFFER);
      expect(result.pages[0].isScanned).toBe(true);
    });

    it("appends a warning when scanned page has no rasterizePage callback", async () => {
      const extractor = new PdfExtractor(makeTextParsePdf([SHORT_TEXT]));
      const result = await extractor.extractPages(DUMMY_PATH, DUMMY_BUFFER);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("Page 1");
    });

    it("does NOT append a warning for non-scanned pages", async () => {
      const extractor = new PdfExtractor(makeTextParsePdf([LONG_TEXT]));
      const result = await extractor.extractPages(DUMMY_PATH, DUMMY_BUFFER);
      expect(result.warnings).toHaveLength(0);
    });

  });

  describe("OCR integration", () => {

    it("calls rasterizePage with correct 1-indexed page number for scanned pages", async () => {
      const rasterizePage = vi.fn().mockResolvedValue(Buffer.from("img"));
      const ocrProvider: OcrProvider = { recognize: vi.fn().mockResolvedValue("ocr text") };
      const extractor = new PdfExtractor(
        makeTextParsePdf([LONG_TEXT, SHORT_TEXT]),
        { rasterizePage, ocrProvider }
      );
      await extractor.extractPages(DUMMY_PATH, DUMMY_BUFFER);
      expect(rasterizePage).toHaveBeenCalledWith(2);
      expect(rasterizePage).not.toHaveBeenCalledWith(1);
    });

    it("calls ocrProvider.recognize with the buffer from rasterizePage", async () => {
      const imgBuffer = Buffer.from("img data");
      const rasterizePage = vi.fn().mockResolvedValue(imgBuffer);
      const ocrProvider: OcrProvider = { recognize: vi.fn().mockResolvedValue("ocr text") };
      const extractor = new PdfExtractor(
        makeTextParsePdf([SHORT_TEXT]),
        { rasterizePage, ocrProvider }
      );
      await extractor.extractPages(DUMMY_PATH, DUMMY_BUFFER);
      expect(ocrProvider.recognize).toHaveBeenCalledWith(imgBuffer);
    });

    it("uses OCR result as the page text when isScanned and rasterizePage provided", async () => {
      const rasterizePage = vi.fn().mockResolvedValue(Buffer.from("img"));
      const ocrProvider: OcrProvider = { recognize: vi.fn().mockResolvedValue("recognized text from ocr") };
      const extractor = new PdfExtractor(
        makeTextParsePdf([SHORT_TEXT]),
        { rasterizePage, ocrProvider }
      );
      const result = await extractor.extractPages(DUMMY_PATH, DUMMY_BUFFER);
      expect(result.pages[0].text).toBe("recognized text from ocr");
    });

    it("appends warning when rasterizePage returns null for a scanned page", async () => {
      const rasterizePage = vi.fn().mockResolvedValue(null);
      const ocrProvider: OcrProvider = { recognize: vi.fn().mockResolvedValue("ocr text") };
      const extractor = new PdfExtractor(
        makeTextParsePdf([SHORT_TEXT]),
        { rasterizePage, ocrProvider }
      );
      const result = await extractor.extractPages(DUMMY_PATH, DUMMY_BUFFER);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("rasterizePage returned null");
    });

    it("does NOT call rasterizePage for non-scanned pages", async () => {
      const rasterizePage = vi.fn();
      const ocrProvider: OcrProvider = { recognize: vi.fn().mockResolvedValue("") };
      const extractor = new PdfExtractor(
        makeTextParsePdf([LONG_TEXT]),
        { rasterizePage, ocrProvider }
      );
      await extractor.extractPages(DUMMY_PATH, DUMMY_BUFFER);
      expect(rasterizePage).not.toHaveBeenCalled();
    });

  });

  describe("NoopOcrProvider", () => {

    it("returns empty string without throwing", async () => {
      const provider = new NoopOcrProvider();
      const result = await provider.recognize(Buffer.from("img"));
      expect(result).toBe("");
    });

  });

});
