/**
 * PDF extension registration for the MahaRudra Agentic AI Infra runtime.
 *
 * This module provides the single opt-in call that activates PDF support
 * in the runtime indexer. The runtime package has no hard dependency on this
 * package — PDF support is always gated behind `registerPdfExtension()`.
 *
 * @module
 */

import { _enablePdfSupport } from "@maharudra/agentic-ai-infra-runtime";

/**
 * Registers the PDF extension with the runtime indexer.
 *
 * This call adds `.pdf` to the indexer's `ALLOWED_EXTENSIONS` set and sets an
 * internal flag so that `indexProjectKnowledge` routes `.pdf` files through
 * the PDF extraction and chunking pipeline rather than skipping them.
 *
 * **Contract:**
 * - Call once during application setup, before invoking `indexProjectKnowledge`.
 * - Idempotent — subsequent calls are no-ops.
 * - Uses a static import of `_enablePdfSupport` (Decision D-17C-1) — the
 *   registration path is synchronous and does not require a dynamic import.
 *
 * **Architecture note:**
 * The leading underscore on `_enablePdfSupport` signals that it is an
 * internal framework API not intended for general callers. It is exported
 * from the runtime solely for this registration hook.
 *
 * @example
 * ```typescript
 * import { registerPdfExtension } from "@maharudra/agentic-ai-infra-pdf";
 *
 * // Call once before starting the runtime or invoking indexProjectKnowledge.
 * registerPdfExtension();
 *
 * // PDF files are now processed by the indexer.
 * await indexProjectKnowledge({ embeddingProvider, storageProvider, projectRoot });
 * ```
 */
export function registerPdfExtension(): void {
  _enablePdfSupport();
}
