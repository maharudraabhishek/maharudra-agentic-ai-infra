/**
 * Public export boundary for the PDF ingestion extension package.
 *
 * This package is optional — it must be explicitly installed and registered.
 * The core and runtime packages have no hard dependency on this package.
 *
 * Usage:
 * ```typescript
 * import { PDF_SOURCE_TYPE, PdfExtractor, NoopOcrProvider } from "@maharudra/agentic-ai-infra-pdf";
 * ```
 *
 * @module
 */
export * from "./types.js";
export { PDF_SOURCE_TYPE } from "./types.js";
export { NoopOcrProvider, TesseractOcrProvider, createOcrProvider } from "./ocr.js";
export { PdfExtractor } from "./extractor.js";
export type { ParsePdfFn, PdfExtractorOptions } from "./extractor.js";
export { detectTables } from "./table-detector.js";
export type { TableDetectionResult } from "./table-detector.js";
export { pdfPageChunker } from "./chunker.js";
export type { PdfChunkerParams } from "./chunker.js";
export { registerPdfExtension } from "./register.js";
