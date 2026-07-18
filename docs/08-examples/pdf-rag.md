# PDF RAG Example Walkthrough

The `pdf-rag` example shows the complete MahaRudra Agentic AI Infra PDF ingestion
pipeline running entirely in process memory — no database, no Docker, no network
calls, no PDF files on disk.

## Source location

```txt
examples/src/pdf-rag/index.ts
```

## Prerequisites

- Node >= 20
- `pnpm install` — installs `pdf-lib`, `pdf-parse`, and workspace packages
- `@maharudra/agentic-ai-infra-pdf` workspace package (already listed as a dep)
- No database, no Docker, no network calls

## How to run

```sh
pnpm --filter @maharudra/agentic-ai-infra-examples start:pdf-rag
```

## What this example demonstrates

- Generating a 3-page PDF entirely in memory using `pdf-lib` (no file on disk)
- Extracting per-page text with `PdfExtractor` and real `pdf-parse`
- Detecting pipe-grid tables with `pdfPageChunker` (table rows preserved as single chunks)
- Computing deterministic embeddings with `MockEmbeddingProvider` (no API key, no network)
- Storing chunks in `InMemoryStorageProvider` via `storeKnowledgeChunks`
- Running a retrieval query via `RetrievalRouter` backed by the stored chunks
- Printing a structured JSON result to stdout

## Pipeline diagram

```txt
  pdf-lib (in-process)
      │  generates 3-page PDF buffer
      ▼
  PdfExtractor + real pdf-parse
      │  per-page text via pagerender callback
      ▼
  Concatenate with page markers
      │  \n<!-- page-N -->\n format
      ▼
  pdfPageChunker
      │  table chunks (isTable:true) + prose chunks (markdown-heading)
      ▼
  MockEmbeddingProvider.embedBatch
      │  SHA-256 deterministic 1024-dim vectors
      ▼
  InMemoryStorageProvider.storeKnowledgeChunks
      │  chunks stored in fileChunks Map
      ▼
  RetrievalRouter → FullTextProvider
      │  lexical term overlap scoring against getChunks()
      ▼
  stdout JSON result
```

## What each step does

### Step 1 — Generate PDF in memory

A `PDFDocument` is created with `pdf-lib`. Three pages are added:

- **Page 1**: Introduction heading + prose paragraphs (> 50 chars — passes scanned-page detection)
- **Page 2**: Performance Data heading + pipe-grid table rows drawn at discrete y positions
- **Page 3**: Conclusion heading + prose

```typescript
const pdfDoc = await PDFDocument.create();
const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
const page1 = pdfDoc.addPage();
page1.drawText("Introduction", { x: 50, y: page1.getHeight() - 80, font, size: 14 });
// ... prose text ...
const pdfBuffer = Buffer.from(await pdfDoc.save());
```

No temporary file is written to disk. The buffer is passed directly to the extractor.

### Step 2 — Extract pages

`PdfExtractor` accepts `pdf-parse` as an injected dependency so tests can mock it.
The real `pdfParse` function is passed here:

```typescript
const extractor = new PdfExtractor(pdfParse, { ocrProvider: new NoopOcrProvider() });
const result = await extractor.extractPages("in-memory-generated.pdf", pdfBuffer);
```

The extractor uses pdf-parse's `pagerender` callback to collect per-page text.
Pages whose extracted text is shorter than 50 characters are flagged as `isScanned: true`
and a warning is recorded. Scanned pages produce empty text in this demo (no
`rasterizePage` callback configured).

### Step 3 — Chunk with pdfPageChunker

Pages are concatenated with markers and passed to `pdfPageChunker`:

```typescript
const concatenated = result.pages
  .map((page) => `\n<!-- page-${page.pageNumber} -->\n${page.text}`)
  .join("");

const chunks = pdfPageChunker({
  filePath: "in-memory-generated.pdf",
  sourceType: "pdf",
  fileHash,         // SHA-256 of the PDF buffer
  content: concatenated,
  maxChunks: 500
});
```

The chunker:
1. Splits on `<!-- page-N -->` markers to recover per-page text.
2. Runs `detectTables()` on each page's text (GFM pipe-grid heuristic).
3. Each detected table → single preserved chunk (`isTable: true` in metadata, never split).
4. Remaining prose → `chunkMarkdownByHeadings` with `"page-N"` prepended to headingPath.

**Note:** pdf-parse's `getTextContent()` joins text items with spaces, not newlines.
Table rows drawn at separate y positions may appear space-separated rather than
newline-separated in the extracted text, so `detectTables` may produce 0 table chunks
for this in-memory generated PDF. The smoke test (`pdf/test/smoke.test.ts`) validates
table detection using mock page text where newlines are preserved.

### Step 4 — Embed and store

`MockEmbeddingProvider` computes deterministic 1024-dim vectors from SHA-256 hashing:

```typescript
const embeddingProvider = new MockEmbeddingProvider();
const embeddings = await embeddingProvider.embedBatch(
  chunks.map((c) => ({ id: c.chunkId, text: c.content }))
);
await storageProvider.storeKnowledgeChunks(chunks, embeddings);
```

The vectorless-local profile auto-wires `InMemoryStorageProvider`, so
`container.storageProvider` is available without explicit construction.
`hasIndexStorageCapability(storageProvider)` narrows the TypeScript type before calling
`storeKnowledgeChunks`.

### Step 5 — Retrieve

The `agentic.retrieval.search` handler is called directly against the stored chunks:

```typescript
const searchResult = await Promise.resolve(
  searchHandler(
    { query: "performance data table" },
    { runtimeMode: "local-stdio-mcp", traceId: "pdf-rag-trace", ... }
  )
);
```

The handler routes to `FullTextProvider`, which calls `getChunks()` on the storage,
converts the chunks to an in-memory corpus, and scores against the query using
normalised lexical term overlap. Results are bounded: previews ≤ 300 chars, max 8 results.

Expected result shape:

```json
{
  "status": "ok",
  "query": "performance data table",
  "results": [
    {
      "chunkId": "abc123...",
      "relPath": "in-memory-generated.pdf",
      "headingPath": ["page-2"],
      "preview": "Introduction to the system. ...",
      "score": 1
    }
  ],
  "resultCount": 2
}
```

## Expected output (stderr)

```txt
[example] pdf generated: 3 pages
[example] extracted: 3 pages, 0 warnings
[example] chunks: N total, M table chunk(s)
[example] sample headingPath[0]: [page-1, page-2, page-3]
[example] profile resolved: vectorless-local
[example] runtime ready: mode=local-stdio-mcp, tools=7
[example] stored N chunks
[example] stopped.
```

Chunk counts (N, M) depend on how pdf.js extracts text from the pdf-lib generated PDF.

## Expected output (stdout)

```json
{
  "profile": "vectorless-local",
  "pageCount": 3,
  "chunkCount": 4,
  "tableChunkCount": 0,
  "retrievalQuery": "performance data table",
  "results": {
    "status": "ok",
    "query": "performance data table",
    "results": [...],
    "resultCount": 2
  },
  "resultCount": 2
}
```

Actual values will vary. `tableChunkCount` may be 0 depending on how pdf-parse
extracts text from the in-memory PDF (see Step 3 note above).

## Upgrading to disk-based PDFs

For real PDF files on disk, use `registerPdfExtension()` + `indexProjectKnowledge()`
instead. This wires the full indexer pipeline — the example above shows the lower-level
components directly because the PDF is never written to disk.

```typescript
import { registerPdfExtension } from "@maharudra/agentic-ai-infra-pdf";

// Call once at startup — idempotent.
registerPdfExtension();

// Then call indexProjectKnowledge with a directory that contains .pdf files:
await indexProjectKnowledge({
  embeddingProvider: new MockEmbeddingProvider(),
  storageProvider,
  projectRoot: "/path/with/pdfs"
});
```

The indexer reads `.pdf` files, calls `PdfExtractor` internally (no parsePdf injection
needed — it dynamic-imports pdf-parse at runtime), chunks with `pdfPageChunker`, embeds,
and persists. The full pipeline is identical to this example but operated through the
framework indexer rather than manually.
