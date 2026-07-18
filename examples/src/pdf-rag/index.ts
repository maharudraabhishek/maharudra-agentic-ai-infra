/**
 * @fileoverview pdf-rag end-to-end example — MahaRudra Agentic AI Infra
 *
 * Demonstrates the complete PDF ingestion pipeline without a database,
 * Docker, or network calls. A 3-page PDF is generated in-process using
 * pdf-lib, extracted with pdf-parse, chunked by pdfPageChunker (preserving
 * table structure), embedded with MockEmbeddingProvider, stored in
 * InMemoryStorageProvider, and retrieved via RetrievalRouter.
 *
 * This example shows the lower-level pipeline directly (not via
 * indexProjectKnowledge) because the PDF is never written to disk.
 * For disk-based PDFs in production use registerPdfExtension() +
 * indexProjectKnowledge() as documented in docs/08-examples/pdf-rag.md.
 *
 * Prerequisites: Node >= 20, pnpm install. Nothing else.
 *
 * How to run:
 * ```sh
 * pnpm --filter @maharudra/agentic-ai-infra-examples start:pdf-rag
 * ```
 *
 * Expected output:
 * - Diagnostic progress on stderr (pdf generation, extraction, chunking,
 *   embedding, storage, retrieval).
 * - One JSON object on stdout: { profile, pageCount, chunkCount,
 *   retrievalQuery, results, resultCount }
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import pdfParse from "pdf-parse";
import { createHash } from "node:crypto";
import {
  PdfExtractor,
  pdfPageChunker,
  NoopOcrProvider
} from "@maharudra/agentic-ai-infra-pdf";
import {
  DefaultProfileResolver
} from "@maharudra/agentic-ai-infra-core";
import {
  createRuntimeServiceContainer,
  LocalStdioMcpRuntimeAdapter,
  MockEmbeddingProvider,
  hasIndexStorageCapability
} from "@maharudra/agentic-ai-infra-runtime";

/**
 * Runs the pdf-rag example: generate → extract → chunk → embed → store → retrieve → print.
 *
 * All diagnostic output goes to stderr. Only the final JSON search result goes to
 * stdout so the output remains compatible with MCP STDIO framing if a transport is
 * later attached to the same process.
 */
async function main(): Promise<void> {
  // -----------------------------------------------------------------------
  // Step 1: Generate PDF buffer with pdf-lib.
  //
  // A 3-page PDF is constructed entirely in memory — no file on disk.
  // Page 1: prose introduction (>50 chars to pass scanned-page detection).
  // Page 2: "Performance Data" heading + pipe-grid table rows.
  // Page 3: conclusion prose.
  // -----------------------------------------------------------------------
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // Page 1 — Introduction
  const page1 = pdfDoc.addPage();
  const p1Height = page1.getHeight();
  page1.drawText("Introduction", {
    x: 50, y: p1Height - 80,
    font, size: 14, color: rgb(0, 0, 0)
  });
  page1.drawText(
    "This document describes the MahaRudra Agentic AI Infra PDF ingestion pipeline. " +
    "The pipeline extracts text from PDF pages, detects embedded tables, chunks the " +
    "content by heading structure, and stores the resulting knowledge chunks for " +
    "retrieval.",
    {
      x: 50, y: p1Height - 120,
      font, size: 11, color: rgb(0, 0, 0),
      maxWidth: 500, lineHeight: 18
    }
  );

  // Page 2 — Performance Data (table rows drawn individually to ensure content length)
  const page2 = pdfDoc.addPage();
  const p2Height = page2.getHeight();
  page2.drawText("Performance Data", {
    x: 50, y: p2Height - 80,
    font, size: 14, color: rgb(0, 0, 0)
  });

  const tableRows = [
    "| Model  | Score | Latency |",
    "| ------ | ----- | ------- |",
    "| GPT-4  | 92    | 120ms   |",
    "| Gemini | 88    | 95ms    |",
    "| Local  | 76    | 15ms    |"
  ];
  let rowY = p2Height - 130;
  for (const row of tableRows) {
    page2.drawText(row, {
      x: 50, y: rowY,
      font, size: 10, color: rgb(0, 0, 0)
    });
    rowY -= 18;
  }

  // Page 3 — Conclusion
  const page3 = pdfDoc.addPage();
  const p3Height = page3.getHeight();
  page3.drawText("Conclusion", {
    x: 50, y: p3Height - 80,
    font, size: 14, color: rgb(0, 0, 0)
  });
  page3.drawText(
    "This concludes the PDF ingestion pipeline demonstration. The framework " +
    "supports both disk-based and in-memory PDF sources. Use registerPdfExtension() " +
    "with indexProjectKnowledge() for production disk-based ingestion.",
    {
      x: 50, y: p3Height - 120,
      font, size: 11, color: rgb(0, 0, 0),
      maxWidth: 500, lineHeight: 18
    }
  );

  const pdfBuffer = Buffer.from(await pdfDoc.save());
  process.stderr.write(`[example] pdf generated: ${pdfDoc.getPageCount()} pages\n`);

  // -----------------------------------------------------------------------
  // Step 2: Extract pages with PdfExtractor + real pdf-parse.
  //
  // PdfExtractor uses pdf-parse's pagerender callback to collect per-page
  // text. The parsePdf function is injected via the constructor — this is the
  // same DI pattern used in tests, but here we pass the real pdf-parse.
  //
  // Note: pdf-parse's getTextContent() returns items joined with spaces,
  // so the table rows on page 2 appear as space-separated text rather than
  // newline-separated markdown. Table detection in pdfPageChunker requires
  // newline-separated rows; this demo may produce 0 table chunks depending
  // on how pdf.js groups the text items from the generated PDF.
  // -----------------------------------------------------------------------
  const extractor = new PdfExtractor(pdfParse, { ocrProvider: new NoopOcrProvider() });
  const result = await extractor.extractPages("in-memory-generated.pdf", pdfBuffer);

  process.stderr.write(
    `[example] extracted: ${result.pages.length} pages, ` +
    `${result.warnings.length} warnings\n`
  );

  if (result.warnings.length > 0) {
    for (const w of result.warnings) {
      process.stderr.write(`[example] warning: ${w}\n`);
    }
  }

  // -----------------------------------------------------------------------
  // Step 3: Concatenate pages with markers.
  //
  // The indexer's PDF branch writes this format. pdfPageChunker expects it.
  // -----------------------------------------------------------------------
  const concatenated = result.pages
    .map((page) => `\n<!-- page-${page.pageNumber} -->\n${page.text}`)
    .join("");

  // -----------------------------------------------------------------------
  // Step 4: Chunk with pdfPageChunker.
  //
  // Tables (pipe-grid rows) are preserved as single chunks with isTable:true
  // in metadata. Prose is split by heading structure (heading-based chunker)
  // or sliding window (fallback). Page number is prepended to headingPath.
  // -----------------------------------------------------------------------
  const fileHash = createHash("sha256").update(pdfBuffer).digest("hex");
  const chunks = pdfPageChunker({
    filePath: "in-memory-generated.pdf",
    sourceType: "pdf",
    fileHash,
    content: concatenated,
    maxChunks: 500
  });

  const tableChunkCount = chunks.filter((c) => c.metadata.isTable === true).length;
  const sampleHeadings = chunks.slice(0, 3).map((c) => c.headingPath?.[0] ?? "(none)");

  process.stderr.write(
    `[example] chunks: ${chunks.length} total, ${tableChunkCount} table chunk(s)\n`
  );
  process.stderr.write(
    `[example] sample headingPath[0]: [${sampleHeadings.join(", ")}]\n`
  );

  // -----------------------------------------------------------------------
  // Step 5: Resolve the vectorless-local profile and create the container.
  //
  // The vectorless-local profile auto-wires InMemoryStorageProvider and a
  // RetrievalRouter backed by it — identical to the vectorless-local example.
  // -----------------------------------------------------------------------
  const resolver = new DefaultProfileResolver();
  const configResult = resolver.resolve({
    project: { name: "pdf-rag-example", slug: "pdf-rag-example" },
    profiles: ["vectorless-local"]
  });

  if (!configResult.ok) {
    process.stderr.write(
      `[example] profile resolution failed: ${configResult.error.message}\n`
    );
    process.exit(1);
  }

  const resolvedConfig = configResult.value;
  process.stderr.write(
    `[example] profile resolved: ${resolvedConfig.profiles.join(", ")}\n`
  );

  const containerResult = createRuntimeServiceContainer({ config: resolvedConfig });

  if (!containerResult.ok) {
    process.stderr.write(
      `[example] container creation failed: ${containerResult.error.message}\n`
    );
    process.exit(1);
  }

  const container = containerResult.value;
  const storageProvider = container.storageProvider;

  if (!storageProvider) {
    process.stderr.write(
      "[example] storageProvider not auto-wired — check profile config.\n"
    );
    process.exit(1);
  }

  const handleResult = await new LocalStdioMcpRuntimeAdapter(container).start();

  if (!handleResult.ok) {
    process.stderr.write(
      `[example] adapter start failed: ${handleResult.error.message}\n`
    );
    process.exit(1);
  }

  const handle = handleResult.value;
  process.stderr.write(
    `[example] runtime ready: mode=${handle.mode}, tools=${handle.registeredTools.length}\n`
  );

  try {
    // -----------------------------------------------------------------------
    // Step 6: Embed chunks and store in InMemoryStorageProvider.
    //
    // MockEmbeddingProvider produces deterministic SHA-256 vectors (1024 dims,
    // no network, no API key). hasIndexStorageCapability guards the store call
    // so TypeScript accepts storeKnowledgeChunks on the StorageProvider type.
    // -----------------------------------------------------------------------
    const embeddingProvider = new MockEmbeddingProvider();
    const inputs = chunks.map((chunk) => ({ id: chunk.chunkId, text: chunk.content }));
    const embeddings = await embeddingProvider.embedBatch(inputs);

    if (hasIndexStorageCapability(storageProvider)) {
      await storageProvider.storeKnowledgeChunks(chunks, embeddings);
      process.stderr.write(`[example] stored ${chunks.length} chunks\n`);
    } else {
      process.stderr.write("[example] storage does not support indexing\n");
      process.exit(1);
    }

    // -----------------------------------------------------------------------
    // Step 7: Retrieve via the agentic.retrieval.search tool handler.
    //
    // The handler delegates to the auto-wired RetrievalRouter which queries
    // the InMemoryStorageProvider chunks stored in Step 6 via getChunks().
    // -----------------------------------------------------------------------
    const searchTool = container.tools.find((t) => t.id === "agentic.retrieval.search");
    const searchHandler = container.handlers.get("agentic.retrieval.search");

    if (!searchHandler || !searchTool) {
      throw new Error(
        "agentic.retrieval.search not found in container. " +
        "Verify the tool contract is registered."
      );
    }

    const searchResult = await Promise.resolve(
      searchHandler(
        { query: "performance data table" },
        {
          runtimeMode: "local-stdio-mcp",
          traceId: "pdf-rag-trace",
          runId: "pdf-rag-run",
          tool: searchTool,
          startedAt: new Date().toISOString()
        }
      )
    );

    // -----------------------------------------------------------------------
    // Step 8: Print the result to stdout as JSON.
    //
    // stdout is reserved for the MCP protocol if a transport is attached.
    // All diagnostic output went to stderr to avoid corrupting protocol framing.
    // -----------------------------------------------------------------------
    type SearchOutput = {
      status?: string;
      query?: string;
      results?: unknown[];
      resultCount?: number;
    };

    const searchOutput = searchResult.ok
      ? (searchResult.value.output as SearchOutput)
      : undefined;

    const output = {
      profile: "vectorless-local",
      pageCount: result.pages.length,
      chunkCount: chunks.length,
      tableChunkCount,
      retrievalQuery: "performance data table",
      results: searchOutput ?? [],
      resultCount: searchOutput?.results?.length ?? 0
    };

    process.stdout.write(JSON.stringify(output, null, 2) + "\n");
  } finally {
    // -----------------------------------------------------------------------
    // Step 9: Stop cleanly.
    //
    // handle.stop() is the typed shutdown point for the local STDIO adapter.
    // It calls storageProvider.close() internally — clearing the in-memory Maps.
    // -----------------------------------------------------------------------
    await handle.stop();
    process.stderr.write("[example] stopped.\n");
  }
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[example] fatal: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(1);
});
