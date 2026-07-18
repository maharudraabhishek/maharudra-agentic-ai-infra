import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import type {
  EmbeddingInput,
  EmbeddingProvider,
  EmbeddingResult,
  IncludedKnowledgeScanFile,
  KnowledgeChunk,
  KnowledgeIndexSummary,
  KnowledgeIndexStorageCapability,
  KnowledgeScanFile,
  KnowledgeScanReport,
  KnowledgeScanSkipReason,
  KnowledgeSourceType,
  StorageProvider
} from "@maharudra/agentic-ai-infra-core";
import { dispatchChunker } from "./chunkers.js";

// ---------------------------------------------------------------------------
// Policy constants
// ---------------------------------------------------------------------------

/**
 * Maximum number of files the scanner will include before stopping.
 * Prevents runaway indexing on unexpectedly large or misconfigured trees.
 */
export const MAX_SCAN_FILES = 500;

/**
 * Maximum byte size for a single included file (512 KiB).
 * Files larger than this are skipped with reason `"file-too-large"`.
 */
export const MAX_FILE_BYTES = 512 * 1024;

/** Directory name segments that are always excluded from the index. */
const BLOCKED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".git",
  ".turbo",
  ".agentic-local",
  ".cache",
  "tmp",
  "temp"
]);

/**
 * File extensions allowed through the indexer.
 * All other extensions are skipped with reason `"unsupported-extension"`.
 *
 * Mutable so that `_enablePdfSupport` can add `.pdf` at runtime without
 * requiring a rebuild or re-import. The set is never shrunk after startup.
 */
const ALLOWED_EXTENSIONS = new Set([".md", ".ts", ".tsx"]);

// ---------------------------------------------------------------------------
// PDF extension registration state
// ---------------------------------------------------------------------------

/**
 * Whether the PDF extension has been registered via `registerPdfExtension()`.
 *
 * When false, `.pdf` files are filtered by `ALLOWED_EXTENSIONS` before
 * reaching the per-file loop, so this flag is only meaningful inside the
 * pdf branch of `indexProjectKnowledge`.
 */
let _pdfSupported = false;

/**
 * Activates PDF indexing support.
 *
 * Called by `registerPdfExtension()` in the optional pdf package.
 * Adds `.pdf` to `ALLOWED_EXTENSIONS` so `scanProjectFiles` includes PDF
 * files, then sets a flag so `indexProjectKnowledge` routes them through
 * the PDF extraction pipeline.
 *
 * Idempotent — subsequent calls are no-ops.
 *
 * @internal Not part of the public framework API. Exported only so the pdf
 *   package's registration hook can reach it without a circular import.
 */
export function _enablePdfSupport(): void {
  if (_pdfSupported) return;
  ALLOWED_EXTENSIONS.add(".pdf");
  _pdfSupported = true;
}

/**
 * Sensitive path fragment regex. Matched against the full normalized relative
 * path (lower-cased). A match skips the file with reason `"sensitive-path"`.
 *
 * Covers common secret-carrying file name patterns without relying on
 * enumeration — new secret file names matching these patterns are blocked
 * automatically.
 */
const SENSITIVE_PATH_PATTERN =
  /(?:secret|token|credential|password|passwd|private[_-]?key|api[_-]?key|auth[_-]?key)/i;

/**
 * Returns true when a filename (not a path) matches a blocked-filename rule.
 *
 * Rules:
 * - Starts with `.env` → `.env`, `.env.local`, `.env.production`, etc.
 * - Exact matches: `.npmrc`, `id_rsa`, `id_ed25519`, `credentials`, `private-key`
 * - Ends with `.key` or `.pem`
 */
function isBlockedFilename(filename: string): boolean {
  const lower = filename.toLowerCase();

  if (lower.startsWith(".env")) return true;
  if (lower === ".npmrc") return true;
  if (lower === "id_rsa") return true;
  if (lower === "id_ed25519") return true;
  if (lower === "credentials") return true;
  if (lower === "private-key") return true;
  if (lower.endsWith(".key")) return true;
  if (lower.endsWith(".pem")) return true;

  return false;
}

/**
 * Returns true when any path segment (directory or file name) is in the
 * blocked-dirs set.
 */
function containsBlockedDir(segments: readonly string[]): boolean {
  return segments.some((segment) => BLOCKED_DIRS.has(segment));
}

// ---------------------------------------------------------------------------
// Source type classification
// ---------------------------------------------------------------------------

/**
 * Classifies a POSIX-normalized project-relative file path into a
 * `KnowledgeSourceType` based on its location in the project tree.
 *
 * Mapping:
 * - Root-level `.md` files → `"project-policy"`
 * - `.agents/skills/` subtree → `"skill"`
 * - `docs/02-architecture/` → `"architecture-doc"`
 * - `docs/03-cli/` → `"cli-doc"`
 * - `docs/04-core-framework/` → `"framework-doc"`
 * - `docs/05-security/` → `"security-doc"`
 * - `docs/06-runbooks/` → `"runbook"`
 * - `docs/internal/learning-notes/` → `"learning-journal"`
 * - Any other `docs/` path → `"project-doc"`
 * - `packages/` source files (`.ts`, `.tsx`) → `"typescript-source"`
 * - `examples/` subtree → `"example"`
 * - Everything else → `"project-doc"`
 */
function classifySourceType(relativePosixPath: string): KnowledgeSourceType {
  const p = relativePosixPath.toLowerCase();

  // Root-level Markdown files: AGENTS.md, CLAUDE.md, README.md, STATUS.md, etc.
  if (!p.includes("/") && p.endsWith(".md")) return "project-policy";

  if (p.startsWith(".agents/skills/")) return "skill";

  if (p.startsWith("docs/02-architecture/")) return "architecture-doc";
  if (p.startsWith("docs/03-cli/")) return "cli-doc";
  if (p.startsWith("docs/04-core-framework/")) return "framework-doc";
  if (p.startsWith("docs/05-security/")) return "security-doc";
  if (p.startsWith("docs/06-runbooks/")) return "runbook";
  if (p.startsWith("docs/internal/learning-notes/")) return "learning-journal";
  if (p.startsWith("docs/internal/")) return "learning-journal";
  if (p.startsWith("docs/")) return "project-doc";

  if (p.startsWith("packages/") && (p.endsWith(".ts") || p.endsWith(".tsx"))) {
    return "typescript-source";
  }

  if (p.startsWith("examples/")) return "example";

  return "project-doc";
}

// ---------------------------------------------------------------------------
// isIndexablePath
// ---------------------------------------------------------------------------

/**
 * Result of `isIndexablePath`. Either a pass with the classified source type,
 * or a skip with the reason why the path was blocked.
 */
export type IndexablePathResult =
  | { readonly ok: true; readonly sourceType: KnowledgeSourceType }
  | { readonly ok: false; readonly reason: KnowledgeScanSkipReason };

/**
 * Options for `isIndexablePath`.
 */
export type IsIndexablePathOptions = {
  /**
   * Absolute path to the project root.
   *
   * When provided, the path is converted to a project-relative POSIX path
   * before applying policy checks and source-type classification.
   * When absent, `filePath` is used as-is (normalized to POSIX separators).
   */
  readonly projectRoot?: string;
};

/**
 * Applies the full indexing policy to a single file path without performing
 * any I/O.
 *
 * All policy checks run in a fail-fast order that avoids reaching expensive
 * checks (extension, sensitive-path) for files already blocked by a cheaper
 * rule (blocked-dir, blocked-filename):
 *
 * 1. Any path segment is a blocked directory → `"blocked-dir"`
 * 2. Filename matches a blocked-filename pattern → `"blocked-filename"`
 * 3. Extension is not `.md`, `.ts`, or `.tsx` → `"unsupported-extension"`
 * 4. Normalized path matches the sensitive-path pattern → `"sensitive-path"`
 * 5. Pass — returns the classified `KnowledgeSourceType`
 *
 * @example
 * ```typescript
 * isIndexablePath("docs/04-core-framework/retrieval-providers.md", { projectRoot: "/project" });
 * // → { ok: true, sourceType: "framework-doc" }
 *
 * isIndexablePath("node_modules/lodash/index.js");
 * // → { ok: false, reason: "blocked-dir" }
 *
 * isIndexablePath("config/.env.local");
 * // → { ok: false, reason: "blocked-filename" }
 * ```
 */
export function isIndexablePath(
  filePath: string,
  options?: IsIndexablePathOptions
): IndexablePathResult {
  // Normalize to POSIX and make relative when a project root is known.
  let normalized: string;

  if (options?.projectRoot) {
    normalized = path.relative(options.projectRoot, filePath).replace(/\\/g, "/");
  } else {
    normalized = filePath.replace(/\\/g, "/");
  }

  const segments = normalized.split("/");
  const filename = segments[segments.length - 1] ?? "";

  // 1. Blocked directory in any segment.
  if (containsBlockedDir(segments)) {
    return { ok: false, reason: "blocked-dir" };
  }

  // 2. Blocked filename pattern.
  if (isBlockedFilename(filename)) {
    return { ok: false, reason: "blocked-filename" };
  }

  // 3. Unsupported extension.
  const extMatch = /\.([^.]+)$/.exec(filename);
  const ext = extMatch ? `.${extMatch[1]!.toLowerCase()}` : "";

  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { ok: false, reason: "unsupported-extension" };
  }

  // 4. Sensitive path pattern (checked after extension filter to reduce false positives
  //    from e.g. minified JS that would never reach this step anyway).
  if (SENSITIVE_PATH_PATTERN.test(normalized)) {
    return { ok: false, reason: "sensitive-path" };
  }

  return { ok: true, sourceType: classifySourceType(normalized) };
}

// ---------------------------------------------------------------------------
// scanProjectFiles
// ---------------------------------------------------------------------------

/**
 * Options for `scanProjectFiles`.
 */
export type ScanProjectFilesOptions = {
  /** Override maximum included files (default: `MAX_SCAN_FILES = 500`). */
  readonly maxFiles?: number;
  /** Override maximum included file size in bytes (default: `MAX_FILE_BYTES = 512 KiB`). */
  readonly maxFileSizeBytes?: number;
};

/**
 * Recursively walks `projectRoot` and applies the full indexing policy to
 * every discovered file, producing a `KnowledgeScanReport`.
 *
 * Safety guarantees:
 * - Symbolic links are never followed (`lstat` only).
 * - File content is read only after all path-policy checks pass.
 * - Hashes are computed over raw file bytes; content is not stored in the report.
 * - Scanning stops when `MAX_SCAN_FILES` included entries are reached; further
 *   entries are recorded as `"too-many-files"`.
 * - Files exceeding `MAX_FILE_BYTES` are skipped with `"file-too-large"`.
 * - Read errors are recorded as `"read-error"` without throwing.
 *
 * @example
 * ```typescript
 * const report = await scanProjectFiles("/project");
 * console.log(report.includedCount);  // number of indexable files
 * console.log(report.skippedCount);   // number of blocked/skipped files
 * ```
 */
export async function scanProjectFiles(
  projectRoot: string,
  options?: ScanProjectFilesOptions
): Promise<KnowledgeScanReport> {
  const maxFiles = options?.maxFiles ?? MAX_SCAN_FILES;
  const maxFileSizeBytes = options?.maxFileSizeBytes ?? MAX_FILE_BYTES;
  const scannedAt = new Date().toISOString();
  const files: KnowledgeScanFile[] = [];
  let includedCount = 0;
  let skippedCount = 0;
  let totalBytesIncluded = 0;

  // Collect all entries recursively. Node 20+ supports { recursive: true }.
  let allEntries: string[];

  try {
    allEntries = (await fs.readdir(projectRoot, { recursive: true })) as string[];
  } catch {
    // Unreadable root — return empty report rather than throw.
    return { projectRoot, scannedAt, files: [], includedCount: 0, skippedCount: 0, totalBytesIncluded: 0 };
  }

  for (const relEntryRaw of allEntries) {
    const relEntry = relEntryRaw.replace(/\\/g, "/");
    const absEntry = path.join(projectRoot, relEntry);

    // Skip if already over the file cap.
    if (includedCount >= maxFiles) {
      files.push({ filePath: relEntry, status: "skipped", skipReason: "too-many-files" });
      skippedCount++;
      continue;
    }

    // lstat — reject symlinks without following them.
    let stat: Awaited<ReturnType<typeof fs.lstat>>;

    try {
      stat = await fs.lstat(absEntry);
    } catch {
      files.push({ filePath: relEntry, status: "skipped", skipReason: "read-error" });
      skippedCount++;
      continue;
    }

    if (stat.isDirectory()) {
      // Directories appear in the recursive listing but are not files to index.
      continue;
    }

    if (stat.isSymbolicLink()) {
      files.push({ filePath: relEntry, status: "skipped", skipReason: "symlink" });
      skippedCount++;
      continue;
    }

    // Apply path policy checks before touching file content.
    const policyResult = isIndexablePath(relEntry);

    if (!policyResult.ok) {
      files.push({ filePath: relEntry, status: "skipped", skipReason: policyResult.reason });
      skippedCount++;
      continue;
    }

    if (stat.size > maxFileSizeBytes) {
      files.push({ filePath: relEntry, status: "skipped", skipReason: "file-too-large" });
      skippedCount++;
      continue;
    }

    // All checks passed — read content and hash it.
    let fileBuffer: Buffer;

    try {
      fileBuffer = await fs.readFile(absEntry);
    } catch {
      files.push({ filePath: relEntry, status: "skipped", skipReason: "read-error" });
      skippedCount++;
      continue;
    }

    const fileHash = createHash("sha256").update(fileBuffer).digest("hex");

    files.push({
      filePath: relEntry,
      status: "included",
      sourceType: policyResult.sourceType,
      fileHash,
      fileSizeBytes: stat.size
    });

    includedCount++;
    totalBytesIncluded += stat.size;
  }

  return {
    projectRoot,
    scannedAt,
    files,
    includedCount,
    skippedCount,
    totalBytesIncluded
  };
}

// ---------------------------------------------------------------------------
// Chunk-storage capability duck-type guard (runtime-only)
// ---------------------------------------------------------------------------

/**
 * Duck-type guard for `KnowledgeIndexStorageCapability`.
 *
 * `KnowledgeIndexStorageCapability` is defined in `@maharudra/agentic-ai-infra-core`
 * so framework users can implement it on custom storage providers. The guard
 * lives here in runtime because it exists for `indexProjectKnowledge`'s internal
 * persistence check. It is also exported so smoke tests can assert the expected
 * behaviour for in-memory stubs (returns false) and full providers (returns true)
 * without a real Postgres instance.
 *
 * Returns true only when the provider exposes all three required methods as
 * callable functions, confirming it can persist indexed chunks and record runs.
 *
 * @example
 * ```typescript
 * const memoryStore: StorageProvider = { id: "mem", type: "memory", healthCheck: async () => ok(...) };
 * hasIndexStorageCapability(memoryStore); // false — no persistence methods
 * hasIndexStorageCapability(postgresProvider); // true — implements all three
 * ```
 */
export function hasIndexStorageCapability(
  provider: StorageProvider
): provider is StorageProvider & KnowledgeIndexStorageCapability {
  const candidate = provider as Partial<KnowledgeIndexStorageCapability>;

  return (
    typeof candidate.lookupIndexedFileHash === "function" &&
    typeof candidate.storeKnowledgeChunks === "function" &&
    typeof candidate.recordIndexRun === "function"
  );
}

// ---------------------------------------------------------------------------
// indexProjectKnowledge
// ---------------------------------------------------------------------------

/**
 * Options for `indexProjectKnowledge`.
 */
export type IndexProjectKnowledgeOptions = {
  /**
   * Embedding provider used to compute vectors for each chunk.
   * Required — chunking without embeddings produces incomplete index entries.
   */
  readonly embeddingProvider: EmbeddingProvider;
  /**
   * Storage provider for persisting chunks and vectors.
   *
   * If the provider also satisfies `KnowledgeIndexStorageCapability` (implements
   * `lookupIndexedFileHash` and `storeKnowledgeChunks`), persistence is
   * performed. Otherwise, chunking and embedding still run but chunks are not
   * written to durable storage — useful for dry-run analysis.
   */
  readonly storageProvider: StorageProvider;
  /**
   * Absolute path to the project root to index.
   * Defaults to `process.cwd()` when absent.
   */
  readonly projectRoot?: string;
  /**
   * When true, forces re-indexing of all files regardless of stored hashes.
   *
   * Requires `approvalText === "REINDEX_AGENTIC_AI_KNOWLEDGE"` (exact string
   * match, same approval pattern as `DefaultApprovalPolicy`). The approval
   * check is enforced to prevent accidental full re-indexes which may be slow
   * and expensive for large projects.
   *
   * **IMPORTANT**: never log or echo the approval text to user-visible output.
   */
  readonly forceReindex?: boolean;
  /**
   * Exact approval string required when `forceReindex` is true.
   *
   * Must equal `"REINDEX_AGENTIC_AI_KNOWLEDGE"`. Any other value (including
   * undefined) causes `indexProjectKnowledge` to throw before touching the
   * filesystem.
   */
  readonly approvalText?: string;
};

/** Exact approval string required to trigger a forced full re-index. */
const FORCE_REINDEX_APPROVAL = "REINDEX_AGENTIC_AI_KNOWLEDGE";

/**
 * Indexes project knowledge: scans files, chunks them by strategy, computes
 * embeddings, and persists chunks with their vectors.
 *
 * **Pipeline (per file):**
 * 1. Assert approval if `forceReindex` is set.
 * 2. `scanProjectFiles()` — walk and policy-filter the project tree.
 * 3. PDF branch — when `registerPdfExtension()` has been called and the file
 *    has `.pdf` extension: dynamically import the pdf package, extract pages,
 *    run `pdfPageChunker`, embed, persist, and `continue` — the text pipeline
 *    is bypassed entirely for PDF files.
 * 4. Pre-chunking freshness check (text) — skip files whose stored hash +
 *    index version match the current file (requires storage capability).
 * 5. `dispatchChunker()` — split text file content by extension strategy.
 * 6. Post-chunking skip check — skip if no chunks were produced.
 * 7. `embeddingProvider.embedBatch()` — compute vectors for each chunk.
 * 8. Persist chunks + vectors via storage capability (if available).
 * 9. Per-file errors are caught and counted; a single file error never aborts
 *    the full indexing run.
 *
 * **Output safety:**
 * The returned `KnowledgeIndexSummary` contains only aggregate counts and the
 * index version string. It never includes chunk content, raw file paths beyond
 * the project root, SQL, or embedding vectors.
 *
 * **Approval text:**
 * The string `"REINDEX_AGENTIC_AI_KNOWLEDGE"` must never appear in logs,
 * console output, error messages, or observability sinks. The approval check
 * uses an exact string comparison so partial matches (prefix, suffix, case
 * variants) are rejected.
 *
 * @example
 * ```typescript
 * import {
 *   MockEmbeddingProvider,
 *   indexProjectKnowledge
 * } from "@maharudra/agentic-ai-infra-runtime";
 *
 * const summary = await indexProjectKnowledge({
 *   embeddingProvider: new MockEmbeddingProvider(),
 *   storageProvider: myStorageProvider,
 *   projectRoot: "/my/project"
 * });
 *
 * console.log(summary.filesIndexed);    // files chunked and embedded
 * console.log(summary.chunksCreated);   // total new chunks
 * console.log(summary.indexVersion);    // "agentic-ai-infra-mock-embedding:mock-embedding-v1:dim64"
 * ```
 */
export async function indexProjectKnowledge(
  options: IndexProjectKnowledgeOptions
): Promise<KnowledgeIndexSummary> {
  const { embeddingProvider, storageProvider, forceReindex } = options;

  // Step 1 — Assert approval for forced full re-index before any I/O.
  if (forceReindex) {
    // Approval text must match exactly. We deliberately do NOT include the
    // expected string in the error message to avoid leaking it into logs.
    if (options.approvalText !== FORCE_REINDEX_APPROVAL) {
      throw new Error(
        "indexProjectKnowledge: forceReindex requires an exact approval string. " +
          "Set options.approvalText to the documented approval value."
      );
    }
  }

  const projectRoot = options.projectRoot ?? process.cwd();
  const indexVersion = `${embeddingProvider.model}:${embeddingProvider.version}:dim${embeddingProvider.dimension}`;
  const canPersist = hasIndexStorageCapability(storageProvider);

  // Step 2 — Scan the project tree.
  const report = await scanProjectFiles(projectRoot);

  const includedFiles = report.files.filter(
    (f): f is IncludedKnowledgeScanFile => f.status === "included"
  );

  let filesIndexed = 0;
  let filesSkipped = report.skippedCount;
  let chunksCreated = 0;
  let chunksSkipped = 0;
  let embeddingsCreated = 0;
  let fileErrorCount = 0;

  for (const file of includedFiles) {
    try {
      // ---------------------------------------------------------------------------
      // PDF BRANCH — activated when registerPdfExtension() has been called.
      // Dynamic import keeps runtime free of a hard dependency on the pdf package.
      // Runs BEFORE the text pipeline; `continue` skips the text path entirely.
      // ---------------------------------------------------------------------------
      const fileExt = path.extname(file.filePath).toLowerCase();

      if (fileExt === ".pdf") {
        // Minimal local interface for the dynamically-loaded pdf module.
        // @maharudra/agentic-ai-infra-pdf is an optional extension — it is NOT
        // in the runtime's dependencies. TypeScript cannot resolve the module at
        // compile time; we describe the subset we need here and cast after import.
        type PdfPage = { readonly pageNumber: number; readonly text: string };
        type PdfExtractResult = { readonly pages: readonly PdfPage[] };
        type PdfExtractorInstance = {
          extractPages(filePath: string): Promise<PdfExtractResult>;
        };
        type PdfChunkParams = {
          filePath: string;
          sourceType: KnowledgeSourceType;
          fileHash: string;
          content: string;
          maxChunks: number;
        };
        type PdfModInterface = {
          PdfExtractor: new () => PdfExtractorInstance;
          pdfPageChunker: (params: PdfChunkParams) => readonly KnowledgeChunk[];
        };

        let pdfMod: PdfModInterface;

        try {
          // @ts-ignore — optional peer dep, not in runtime's package.json;
          // graceful skip when not installed or failing to load (architecture invariant 1).
          pdfMod = (await import("@maharudra/agentic-ai-infra-pdf")) as PdfModInterface;
        } catch {
          console.warn(
            `[indexer] Skipping ${file.filePath}: ` +
              `@maharudra/agentic-ai-infra-pdf not installed or failed to load.`
          );
          filesSkipped++;
          continue;
        }

        // Step 3 (pdf) — pre-chunking freshness check (same logic as text files).
        if (!forceReindex && canPersist) {
          const storedHash = await (
            storageProvider as StorageProvider & KnowledgeIndexStorageCapability
          ).lookupIndexedFileHash(file.filePath, indexVersion);

          if (storedHash === file.fileHash) {
            filesSkipped++;
            continue;
          }
        }

        // Step 4 (pdf) — extract pages and build concatenated page-marker text.
        // PdfExtractor reads the file from absPath when no buffer is supplied.
        // sourceType is hardcoded to "pdf" — classifySourceType returns "project-doc"
        // for binary formats and must not be polluted with extension logic (D-17C-5).
        const absPath = path.join(projectRoot, file.filePath);
        let extractedText: string;

        try {
          const extractor = new pdfMod.PdfExtractor();
          const result = await extractor.extractPages(absPath);
          // Concatenate pages with markers consumed by pdfPageChunker.
          extractedText = result.pages
            .map((page: PdfPage) => `\n<!-- page-${page.pageNumber} -->\n${page.text}`)
            .join("");
        } catch {
          fileErrorCount++;
          continue;
        }

        // Step 5 (pdf) — chunk with the PDF-aware chunker.
        // "pdf" is a literal KnowledgeSourceType value added in Stage 17A.
        // Not imported from the pdf package to avoid a static runtime→pdf dep (D-17C-2).
        const pdfSourceType = "pdf" as KnowledgeSourceType;
        const chunks = pdfMod.pdfPageChunker({
          filePath: file.filePath,
          sourceType: pdfSourceType,
          fileHash: file.fileHash,
          content: extractedText,
          maxChunks: 500
        });

        if (chunks.length === 0) {
          chunksSkipped++;
          filesSkipped++;
          continue;
        }

        // Steps 6–8 (pdf) — identical to the text pipeline.
        const pdfEmbeddingInputs: EmbeddingInput[] = chunks.map((chunk: KnowledgeChunk) => ({
          id: chunk.chunkId,
          text: chunk.content
        }));

        let pdfEmbeddings: readonly EmbeddingResult[];

        try {
          pdfEmbeddings = await embeddingProvider.embedBatch(pdfEmbeddingInputs);
        } catch {
          fileErrorCount++;
          continue;
        }

        if (canPersist) {
          try {
            await (
              storageProvider as StorageProvider & KnowledgeIndexStorageCapability
            ).storeKnowledgeChunks(chunks, pdfEmbeddings);
          } catch {
            fileErrorCount++;
            continue;
          }
        }

        chunksCreated += chunks.length;
        embeddingsCreated += pdfEmbeddings.length;
        filesIndexed++;
        continue; // skip fall-through to text pipeline
      }

      // Step 3 — Pre-chunking freshness check (storage capability required).
      if (!forceReindex && canPersist) {
        const storedHash = await (
          storageProvider as StorageProvider & KnowledgeIndexStorageCapability
        ).lookupIndexedFileHash(file.filePath, indexVersion);

        if (storedHash === file.fileHash) {
          // File is already indexed under the current provider version — skip.
          filesSkipped++;
          continue;
        }
      }

      // Read the file content for chunking. Content is read here (not in the
      // scanner) so the scanner report contains only hashes, never raw text.
      const absPath = path.join(projectRoot, file.filePath);
      let content: string;

      try {
        content = await fs.readFile(absPath, "utf8");
      } catch {
        fileErrorCount++;
        continue;
      }

      // Step 4 — Dispatch to the appropriate chunker strategy.
      const chunks = dispatchChunker({
        filePath: file.filePath,
        sourceType: file.sourceType,
        fileHash: file.fileHash,
        content
      });

      // Step 5 — Post-chunking skip check.
      if (chunks.length === 0) {
        chunksSkipped++;
        filesSkipped++;
        continue;
      }

      // Step 6 — Compute embeddings for all chunks in one batch call.
      const embeddingInputs: EmbeddingInput[] = chunks.map((chunk) => ({
        id: chunk.chunkId,
        text: chunk.content
      }));

      let embeddings: readonly EmbeddingResult[];

      try {
        embeddings = await embeddingProvider.embedBatch(embeddingInputs);
      } catch (cause) {
        // Embedding failures count as a file error; the file is skipped.
        fileErrorCount++;
        continue;
      }

      // Step 7 — Persist chunks + vectors when storage capability is available.
      if (canPersist) {
        try {
          await (
            storageProvider as StorageProvider & KnowledgeIndexStorageCapability
          ).storeKnowledgeChunks(chunks, embeddings);
        } catch {
          // Persistence failure counts as a file error but does not block the run.
          fileErrorCount++;
          continue;
        }
      }

      // Step 8 — Accumulate summary counts only after all steps succeed.
      chunksCreated += chunks.length;
      embeddingsCreated += embeddings.length;
      filesIndexed++;
    } catch {
      // Per-file errors are counted but never propagated so one bad file
      // cannot abort the rest of the indexing run.
      fileErrorCount++;
    }
  }

  // Build the final summary once so the same object is returned and recorded.
  const indexedAt = new Date().toISOString();
  const summary: KnowledgeIndexSummary = {
    indexedAt,
    projectRoot,
    filesIndexed,
    filesSkipped,
    chunksCreated,
    chunksSkipped,
    embeddingsCreated,
    fileErrorCount,
    indexVersion
  };

  // Record the completed run for observability and audit. Failures here must
  // never block or invalidate the index — they are swallowed silently.
  if (canPersist) {
    try {
      await (
        storageProvider as StorageProvider & KnowledgeIndexStorageCapability
      ).recordIndexRun(summary);
    } catch {
      // Recording failure does not invalidate the index run.
    }
  }

  return summary;
}
