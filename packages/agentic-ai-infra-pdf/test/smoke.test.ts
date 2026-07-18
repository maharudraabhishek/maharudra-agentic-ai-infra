/**
 * Stage 17D — P2.5 end-to-end smoke tests.
 *
 * Validates that PdfExtractor → pdfPageChunker → InMemoryStorageProvider →
 * RetrievalRouter compose correctly without any real PDF files, network calls,
 * or database connections. All tests use mock parsePdf (makeTextParsePdf helper)
 * so the suite runs in CI with no pdf-parse execution against a real file.
 */

import { describe, expect, it } from "vitest";
import { PdfExtractor } from "../src/extractor.js";
import { pdfPageChunker } from "../src/chunker.js";
import { NoopOcrProvider } from "../src/ocr.js";
import type { ParsePdfFn } from "../src/extractor.js";
import {
  InMemoryStorageProvider,
  MockEmbeddingProvider,
  FullTextProvider,
  RetrievalRouter
} from "@maharudra/agentic-ai-infra-runtime";

// ---------------------------------------------------------------------------
// makeTextParsePdf helper — copied from extractor.test.ts (not exported).
//
// Builds a mock parsePdf that calls the pagerender callback once per entry in
// `pageTexts`, simulating pdf-parse's per-page rendering protocol. Text is
// returned as a single item so newlines are preserved through the extractor's
// items.map(item => item.str).join(" ") join.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Fixtures — three synthetic pages
// ---------------------------------------------------------------------------

/** Page 1: prose only, no table. > 50 chars to avoid scanned detection. */
const PAGE_1_TEXT = "Introduction to the system. ".repeat(4);

/** Page 2: a complete GFM pipe-grid table with header + separator + 3 data rows. */
const PAGE_2_TEXT = [
  "| Model  | Score | Latency |",
  "| ------ | ----- | ------- |",
  "| GPT-4  | 92    | 120ms   |",
  "| Gemini | 88    | 95ms    |",
  "| Local  | 76    | 15ms    |"
].join("\n");

/** Page 3: prose with a markdown heading. */
const PAGE_3_TEXT = "## Conclusion\n\nThis concludes the analysis.";

const DUMMY_BUFFER = Buffer.from("");
const DUMMY_PATH = "/path/to/doc.pdf";
const FILE_HASH = "abc123def456";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("P2.5 smoke: PDF pipeline end-to-end", () => {

  it("smoke: extracted pages have correct page count", async () => {
    const extractor = new PdfExtractor(
      makeTextParsePdf([PAGE_1_TEXT, PAGE_2_TEXT, PAGE_3_TEXT]),
      { ocrProvider: new NoopOcrProvider() }
    );
    const result = await extractor.extractPages(DUMMY_PATH, DUMMY_BUFFER);
    expect(result.pages).toHaveLength(3);
  });

  it("smoke: pdfPageChunker produces chunks from 3-page content", async () => {
    const extractor = new PdfExtractor(
      makeTextParsePdf([PAGE_1_TEXT, PAGE_2_TEXT, PAGE_3_TEXT])
    );
    const result = await extractor.extractPages(DUMMY_PATH, DUMMY_BUFFER);

    const concatenated = result.pages
      .map((page) => `\n<!-- page-${page.pageNumber} -->\n${page.text}`)
      .join("");

    const chunks = pdfPageChunker({
      filePath: DUMMY_PATH,
      sourceType: "pdf",
      fileHash: FILE_HASH,
      content: concatenated,
      maxChunks: 500
    });

    expect(chunks.length).toBeGreaterThan(0);
  });

  it("smoke: page-2 table chunk is preserved as single chunk with isTable metadata", async () => {
    const extractor = new PdfExtractor(
      makeTextParsePdf([PAGE_1_TEXT, PAGE_2_TEXT, PAGE_3_TEXT])
    );
    const result = await extractor.extractPages(DUMMY_PATH, DUMMY_BUFFER);

    const concatenated = result.pages
      .map((page) => `\n<!-- page-${page.pageNumber} -->\n${page.text}`)
      .join("");

    const chunks = pdfPageChunker({
      filePath: DUMMY_PATH,
      sourceType: "pdf",
      fileHash: FILE_HASH,
      content: concatenated,
      maxChunks: 500
    });

    const tableChunks = chunks.filter((c) => c.content.includes("| GPT-4"));
    expect(tableChunks).toHaveLength(1);
    expect(tableChunks[0]?.metadata.isTable).toBe(true);
  });

  it("smoke: all chunk headingPaths start with page-N", async () => {
    const extractor = new PdfExtractor(
      makeTextParsePdf([PAGE_1_TEXT, PAGE_2_TEXT, PAGE_3_TEXT])
    );
    const result = await extractor.extractPages(DUMMY_PATH, DUMMY_BUFFER);

    const concatenated = result.pages
      .map((page) => `\n<!-- page-${page.pageNumber} -->\n${page.text}`)
      .join("");

    const chunks = pdfPageChunker({
      filePath: DUMMY_PATH,
      sourceType: "pdf",
      fileHash: FILE_HASH,
      content: concatenated,
      maxChunks: 500
    });

    for (const chunk of chunks) {
      expect(chunk.headingPath?.[0]).toMatch(/^page-\d+$/);
    }
  });

  it("smoke: chunks can be stored in InMemoryStorageProvider without error", async () => {
    const extractor = new PdfExtractor(
      makeTextParsePdf([PAGE_1_TEXT, PAGE_2_TEXT, PAGE_3_TEXT])
    );
    const result = await extractor.extractPages(DUMMY_PATH, DUMMY_BUFFER);

    const concatenated = result.pages
      .map((page) => `\n<!-- page-${page.pageNumber} -->\n${page.text}`)
      .join("");

    const chunks = pdfPageChunker({
      filePath: DUMMY_PATH,
      sourceType: "pdf",
      fileHash: FILE_HASH,
      content: concatenated,
      maxChunks: 500
    });

    const storageProvider = new InMemoryStorageProvider("smoke-pdf-store");
    const embeddingProvider = new MockEmbeddingProvider();
    const inputs = chunks.map((c) => ({ id: c.chunkId, text: c.content }));
    const embeddings = await embeddingProvider.embedBatch(inputs);

    await expect(
      storageProvider.storeKnowledgeChunks(chunks, embeddings)
    ).resolves.toBeUndefined();
  });

  it("smoke: stored chunks are retrievable via RetrievalRouter", async () => {
    const extractor = new PdfExtractor(
      makeTextParsePdf([PAGE_1_TEXT, PAGE_2_TEXT, PAGE_3_TEXT])
    );
    const result = await extractor.extractPages(DUMMY_PATH, DUMMY_BUFFER);

    const concatenated = result.pages
      .map((page) => `\n<!-- page-${page.pageNumber} -->\n${page.text}`)
      .join("");

    const chunks = pdfPageChunker({
      filePath: DUMMY_PATH,
      sourceType: "pdf",
      fileHash: FILE_HASH,
      content: concatenated,
      maxChunks: 500
    });

    const storageProvider = new InMemoryStorageProvider("smoke-pdf-retrieve");
    const embeddingProvider = new MockEmbeddingProvider();
    const inputs = chunks.map((c) => ({ id: c.chunkId, text: c.content }));
    const embeddings = await embeddingProvider.embedBatch(inputs);
    await storageProvider.storeKnowledgeChunks(chunks, embeddings);

    const fullTextProvider = new FullTextProvider(
      "smoke-ft",
      undefined,
      storageProvider
    );
    const router = new RetrievalRouter([fullTextProvider]);

    const retrieved = await router.retrieve({ query: "score latency" });
    expect(retrieved.ok).toBe(true);

    if (retrieved.ok) {
      expect(retrieved.value.length).toBeGreaterThan(0);
      const previewText = retrieved.value
        .map((r) => r.preview ?? r.content)
        .join(" ");
      expect(previewText).toMatch(/GPT-4|Score|Latency/i);
    }
  });

  it("smoke: sourceType is pdf on all stored chunks", async () => {
    const extractor = new PdfExtractor(
      makeTextParsePdf([PAGE_1_TEXT, PAGE_2_TEXT, PAGE_3_TEXT])
    );
    const result = await extractor.extractPages(DUMMY_PATH, DUMMY_BUFFER);

    const concatenated = result.pages
      .map((page) => `\n<!-- page-${page.pageNumber} -->\n${page.text}`)
      .join("");

    const chunks = pdfPageChunker({
      filePath: DUMMY_PATH,
      sourceType: "pdf",
      fileHash: FILE_HASH,
      content: concatenated,
      maxChunks: 500
    });

    const storageProvider = new InMemoryStorageProvider("smoke-pdf-type");
    const embeddingProvider = new MockEmbeddingProvider();
    const inputs = chunks.map((c) => ({ id: c.chunkId, text: c.content }));
    const embeddings = await embeddingProvider.embedBatch(inputs);
    await storageProvider.storeKnowledgeChunks(chunks, embeddings);

    const stored = await storageProvider.getChunks();
    expect(stored.length).toBeGreaterThan(0);
    for (const chunk of stored) {
      expect(chunk.sourceType).toBe("pdf");
    }
  });

});
