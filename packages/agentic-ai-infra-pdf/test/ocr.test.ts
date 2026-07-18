/**
 * Stage 17B — OCR provider factory tests.
 *
 * `TesseractOcrProvider` with a real tesseract.js engine is integration-only
 * and is intentionally skipped in CI. This suite covers the runtime fallback
 * path that is safe to verify without the optional peer dependency.
 *
 * `vi.mock("tesseract.js", ...)` forces the dynamic import inside
 * `createOcrProvider` to reject, simulating a missing peer dep regardless of
 * whether tesseract.js is actually installed in the environment.
 */

import { describe, expect, it, vi } from "vitest";
import { createOcrProvider, NoopOcrProvider } from "../src/ocr.js";

// Intercepts `await import("tesseract.js")` inside createOcrProvider.
// The async factory throws → import rejects → createOcrProvider falls back to NoopOcrProvider.
vi.mock("tesseract.js", async () => {
  throw new Error("mock: tesseract.js peer dep not available");
});

describe("createOcrProvider", () => {

  it("returns NoopOcrProvider when tesseract.js import fails", async () => {
    const provider = await createOcrProvider();
    expect(provider).toBeInstanceOf(NoopOcrProvider);
  });

});
