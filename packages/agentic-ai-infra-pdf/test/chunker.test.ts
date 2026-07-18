/**
 * Stage 17C — pdfPageChunker + detectTables unit tests.
 *
 * All tests use synthetic string fixtures — no real PDF files, no network,
 * no disk reads. The fixture matches the page-marker format written by the
 * indexer's PDF branch so the chunker's splitByPageMarkers logic is exercised.
 */

import { describe, expect, it } from "vitest";
import { pdfPageChunker } from "../src/chunker.js";
import { detectTables } from "../src/table-detector.js";

// ---------------------------------------------------------------------------
// Synthetic fixture — three pages including a table on page 2
// ---------------------------------------------------------------------------

const SAMPLE_PDF_TEXT = [
  "\n<!-- page-1 -->\n",
  "## Introduction\n\nThis is the introduction text.\n",
  "\n<!-- page-2 -->\n",
  "## Data Table\n\n",
  "| Name | Score | Grade |\n",
  "| ---- | ----- | ----- |\n",
  "| Alice | 95 | A |\n",
  "| Bob | 82 | B |\n",
  "\n## Summary\n\nSummary text here.\n",
  "\n<!-- page-3 -->\n",
  "## Conclusion\n\nConcluding remarks.\n"
].join("");

const DUMMY_FILE_PATH = "reports/sample.pdf";
const DUMMY_HASH = "abc123def456";

// ---------------------------------------------------------------------------
// pdfPageChunker tests
// ---------------------------------------------------------------------------

describe("pdfPageChunker", () => {

  it("returns empty array for empty content", () => {
    const chunks = pdfPageChunker({
      filePath: DUMMY_FILE_PATH,
      sourceType: "pdf",
      fileHash: DUMMY_HASH,
      content: ""
    });
    expect(chunks).toHaveLength(0);
  });

  it("returns empty array for whitespace-only content", () => {
    const chunks = pdfPageChunker({
      filePath: DUMMY_FILE_PATH,
      sourceType: "pdf",
      fileHash: DUMMY_HASH,
      content: "   \n   "
    });
    expect(chunks).toHaveLength(0);
  });

  it("produces chunks for single-page text content", () => {
    const singlePage = "\n<!-- page-1 -->\n## Intro\n\nSome content here.\n";
    const chunks = pdfPageChunker({
      filePath: DUMMY_FILE_PATH,
      sourceType: "pdf",
      fileHash: DUMMY_HASH,
      content: singlePage
    });
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("each chunk headingPath starts with page-N", () => {
    const chunks = pdfPageChunker({
      filePath: DUMMY_FILE_PATH,
      sourceType: "pdf",
      fileHash: DUMMY_HASH,
      content: SAMPLE_PDF_TEXT
    });

    expect(chunks.length).toBeGreaterThan(0);

    for (const chunk of chunks) {
      // Every chunk must have a headingPath whose first element is "page-N".
      expect(chunk.headingPath).toBeDefined();
      expect(chunk.headingPath![0]).toMatch(/^page-\d+$/);
    }
  });

  it("table on page 2 is preserved as a single chunk", () => {
    const chunks = pdfPageChunker({
      filePath: DUMMY_FILE_PATH,
      sourceType: "pdf",
      fileHash: DUMMY_HASH,
      content: SAMPLE_PDF_TEXT
    });

    const tableChunk = chunks.find((c) => c.content.includes("| Alice |"));
    expect(tableChunk).toBeDefined();

    // All four table lines must be in the same chunk (never split mid-table).
    expect(tableChunk!.content).toContain("| Name | Score | Grade |");
    expect(tableChunk!.content).toContain("| ---- | ----- | ----- |");
    expect(tableChunk!.content).toContain("| Alice | 95 | A |");
    expect(tableChunk!.content).toContain("| Bob | 82 | B |");

    // Table chunks get only the page prefix — no sub-heading from surrounding context.
    expect(tableChunk!.headingPath).toEqual(["page-2"]);

    // Tables use "fallback" strategy (no new ChunkingStrategy value — D-17C-3).
    expect(tableChunk!.chunkingStrategy).toBe("fallback");
  });

  it("non-table text produces markdown-heading chunks", () => {
    const chunks = pdfPageChunker({
      filePath: DUMMY_FILE_PATH,
      sourceType: "pdf",
      fileHash: DUMMY_HASH,
      content: SAMPLE_PDF_TEXT
    });

    const headingChunks = chunks.filter((c) => c.chunkingStrategy === "markdown-heading");
    expect(headingChunks.length).toBeGreaterThan(0);
  });

  it("chunk count is within maxChunks limit", () => {
    const chunks = pdfPageChunker({
      filePath: DUMMY_FILE_PATH,
      sourceType: "pdf",
      fileHash: DUMMY_HASH,
      content: SAMPLE_PDF_TEXT,
      maxChunks: 3
    });
    expect(chunks.length).toBeLessThanOrEqual(3);
  });

  it("default maxChunks is 500 not 100", () => {
    // Generate synthetic content with 200 short pages; each page yields at
    // least 1 chunk (heading + text). With maxChunks=100, we would get 100.
    // With the correct default of 500, we should get well above 100.
    let syntheticContent = "";

    for (let p = 1; p <= 200; p++) {
      syntheticContent += `\n<!-- page-${p} -->\n## Section ${p}\nContent for page ${p}.\n`;
    }

    const chunks = pdfPageChunker({
      filePath: DUMMY_FILE_PATH,
      sourceType: "pdf",
      fileHash: DUMMY_HASH,
      content: syntheticContent
      // maxChunks omitted — should default to 500
    });

    // 200 pages × ≥1 chunk each = ≥200. A maxChunks=100 default would cap this at 100.
    expect(chunks.length).toBeGreaterThan(100);
  });

  it("all chunks carry the correct filePath and fileHash", () => {
    const chunks = pdfPageChunker({
      filePath: DUMMY_FILE_PATH,
      sourceType: "pdf",
      fileHash: DUMMY_HASH,
      content: SAMPLE_PDF_TEXT
    });

    expect(chunks.length).toBeGreaterThan(0);

    for (const chunk of chunks) {
      expect(chunk.filePath).toBe(DUMMY_FILE_PATH);
      expect(chunk.fileHash).toBe(DUMMY_HASH);
    }
  });

  it("table chunk metadata includes isTable: true and pageNumber", () => {
    const chunks = pdfPageChunker({
      filePath: DUMMY_FILE_PATH,
      sourceType: "pdf",
      fileHash: DUMMY_HASH,
      content: SAMPLE_PDF_TEXT
    });

    const tableChunk = chunks.find((c) => c.content.includes("| Alice |"));
    expect(tableChunk).toBeDefined();

    expect((tableChunk!.metadata as Record<string, unknown>)["isTable"]).toBe(true);
    expect((tableChunk!.metadata as Record<string, unknown>)["pageNumber"]).toBe(2);
  });

});

// ---------------------------------------------------------------------------
// detectTables tests
// ---------------------------------------------------------------------------

describe("detectTables", () => {

  it("returns empty tables and full text for non-tabular content", () => {
    const prose = "This is plain prose.\nNo pipes or tabs here.\nJust normal text.";
    const { tables, remainingText } = detectTables(prose, 1);

    expect(tables).toHaveLength(0);
    expect(remainingText).toBe(prose);
  });

});
