/**
 * OCR provider implementations for the PDF ingestion extension.
 *
 * `NoopOcrProvider` is the safe default: it returns an empty string and never
 * throws. `TesseractOcrProvider` wraps tesseract.js via a dynamic import so
 * the package compiles and runs correctly when tesseract.js is not installed.
 * `createOcrProvider()` is the recommended factory — it probes at runtime.
 *
 * @module
 */

import type { OcrProvider } from "./types.js";

/**
 * No-op OCR provider used when OCR is not configured or the peer dep is absent.
 *
 * Always returns an empty string. Safe to call in any environment.
 *
 * @example
 * ```typescript
 * const provider = new NoopOcrProvider();
 * const text = await provider.recognize(imageBuffer); // always ""
 * ```
 */
export class NoopOcrProvider implements OcrProvider {
  async recognize(_imageBuffer: Buffer): Promise<string> {
    return "";
  }
}

/**
 * OCR provider backed by tesseract.js (optional peer dependency).
 *
 * Falls back to an empty string with a console warning when tesseract.js is
 * not installed — never throws. Callers should prefer `createOcrProvider()`
 * over constructing this directly.
 *
 * @example
 * ```typescript
 * const provider = new TesseractOcrProvider();
 * const text = await provider.recognize(pngBuffer);
 * ```
 */
export class TesseractOcrProvider implements OcrProvider {
  async recognize(imageBuffer: Buffer): Promise<string> {
    try {
      // Dynamic import keeps the package compilable when tesseract.js is absent.
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng");

      try {
        const { data } = await worker.recognize(imageBuffer);
        return data.text ?? "";
      } finally {
        await worker.terminate();
      }
    } catch {
      console.warn(
        "[agentic-ai-infra-pdf] tesseract.js unavailable — OCR skipped for this page. " +
          "Install tesseract.js as a peer dependency to enable OCR."
      );
      return "";
    }
  }
}

/**
 * Factory that returns a `TesseractOcrProvider` when tesseract.js is resolvable,
 * otherwise returns a `NoopOcrProvider`.
 *
 * Use this in production code. It performs a cheap module-resolution probe at
 * call time rather than at import time so the package always loads successfully.
 *
 * @returns `TesseractOcrProvider` when tesseract.js is installed, `NoopOcrProvider` otherwise.
 *
 * @example
 * ```typescript
 * const ocrProvider = await createOcrProvider();
 * const extractor = new PdfExtractor(parsePdf, { ocrProvider });
 * ```
 */
export async function createOcrProvider(): Promise<OcrProvider> {
  try {
    await import("tesseract.js");
    return new TesseractOcrProvider();
  } catch {
    return new NoopOcrProvider();
  }
}
