import { createHash } from "node:crypto";
import {
  type EmbeddingInput,
  type EmbeddingProvider,
  type EmbeddingResult,
  type FrameworkResult,
  type KnowledgeChunk,
  type KnowledgeIndexStorageCapability,
  type Reranker,
  type RetrievalInput,
  type RetrievalMerger,
  type RetrievalProvider,
  type RetrievalProviderType,
  type RetrievalResult,
  ok,
  validationIssue
} from "@maharudra/agentic-ai-infra-core";
import { recoverable } from "../errors/index.js";
import type { QueryableDatabase } from "../storage/index.js";
import {
  MOCK_EMBEDDING_DIMENSION,
  MOCK_EMBEDDING_MODEL,
  MOCK_EMBEDDING_VERSION
} from "./embedding-config.js";
import { DEFAULT_SOURCE_PRIORITY_MAP } from "./heuristic-reranker.js";

/**
 * Document available to deterministic retrieval providers.
 */
export type IndexedDocument = {
  readonly sourceId: string;
  readonly title: string;
  readonly content: string;
  readonly safePath?: string;
  readonly archived?: boolean;
  readonly sourcePriority?: number;
  readonly sourceVersion?: string;
  readonly contentHash?: string;
};

/**
 * Indexed chunk available to deterministic retrieval providers.
 */
export type IndexedChunk = {
  readonly chunkId: string;
  readonly sourceId: string;
  readonly content: string;
  readonly headingPath?: readonly string[];
  readonly tokenEstimate?: number;
  readonly vector?: readonly number[];
  readonly metadata?: Record<string, string | number | boolean>;
};

/**
 * In-memory corpus used by deterministic providers and tests.
 */
export type RetrievalCorpus = {
  readonly documents: readonly IndexedDocument[];
  readonly chunks: readonly IndexedChunk[];
};

const PREVIEW_LIMIT = 360;

/**
 * Normalizes query and source text into a small lexical form shared by all
 * deterministic providers.
 */
function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_#./-]+/g, " ").trim();
}

/**
 * Splits normalized text into query terms used by deterministic provider
 * scoring.
 */
function terms(value: string): readonly string[] {
  return normalizeText(value).split(/\s+/).filter(Boolean);
}

/**
 * Produces safe bounded previews so retrieval output never becomes a raw full
 * file or unbounded chunk.
 */
function boundedPreview(content: string): string {
  const compact = content.replace(/\s+/g, " ").trim();

  return compact.length > PREVIEW_LIMIT ? `${compact.slice(0, PREVIEW_LIMIT - 3)}...` : compact;
}

/**
 * Estimates tokens with a deterministic character heuristic.
 *
 * This is intentionally provider-neutral so tests and generated projects do not
 * need paid tokenizer dependencies.
 */
function estimateTokens(content: string): number {
  return Math.max(1, Math.ceil(content.length / 4));
}

/**
 * Builds safe result metadata from the owning document plus provider-specific
 * details.
 */
function metadataFor(doc: IndexedDocument, extra: Record<string, string | number | boolean> = {}) {
  return {
    title: doc.title,
    sourceVersion: doc.sourceVersion ?? "unknown",
    archived: doc.archived ?? false,
    sourcePriority: doc.sourcePriority ?? 0,
    ...extra
  };
}

/**
 * Returns a recoverable failure for providers that were never configured.
 */
function notConfigured<T = readonly RetrievalResult[]>(providerId: string): FrameworkResult<T> {
  return recoverable("retrieval.not-configured", `Retrieval provider "${providerId}" is not configured.`);
}

/**
 * Returns a recoverable failure for providers with no usable index data.
 *
 * Providers use this instead of returning fake empty success so callers know
 * the provider did not actually run.
 */
function notIndexed<T = readonly RetrievalResult[]>(providerId: string): FrameworkResult<T> {
  return recoverable("retrieval.not-indexed", `Retrieval provider "${providerId}" has no indexed data.`);
}

/**
 * Returns a recoverable failure when the query shape cannot be handled by a
 * provider.
 */
function unsupported<T = readonly RetrievalResult[]>(providerId: string): FrameworkResult<T> {
  return recoverable("retrieval.unsupported-input", `Retrieval provider "${providerId}" cannot run for this input.`);
}

/**
 * Bridges a flat list of `KnowledgeChunk` objects from a storage provider into
 * the `RetrievalCorpus` shape expected by deterministic retrieval providers.
 *
 * Each unique `filePath` becomes one `IndexedDocument`. The document's `content`
 * is all its chunks joined by newlines so heading extraction (DocumentTreeProvider)
 * and symbol matching (SymbolCodeProvider) work on the full reconstructed source.
 * Individual `IndexedChunk` entries carry the original chunk content and heading
 * path so FullTextProvider can score at chunk granularity.
 *
 * This function is called lazily inside `effectiveCorpus()` — only when a retrieval
 * query arrives and the provider has no static corpus. It does not cache results;
 * calling it twice on the same chunks produces the same corpus.
 *
 * @param chunks - All chunks returned by `KnowledgeIndexStorageCapability.getChunks()`.
 */
function chunksToCorpus(chunks: readonly KnowledgeChunk[]): RetrievalCorpus {
  const docMap = new Map<string, { parts: string[]; hash?: string }>();

  for (const chunk of chunks) {
    const entry = docMap.get(chunk.filePath);

    if (entry) {
      entry.parts.push(chunk.content);
    } else {
      docMap.set(chunk.filePath, { parts: [chunk.content], hash: chunk.fileHash });
    }
  }

  const documents: IndexedDocument[] = [];

  for (const [filePath, { parts, hash }] of docMap) {
    documents.push({
      sourceId: filePath,
      // Derive a readable title from the file name portion of the path.
      title: filePath.split("/").pop() ?? filePath,
      // Join all chunk content so providers that scan whole-file text (heading
      // extraction, symbol matching) see the reconstructed source.
      content: parts.join("\n"),
      safePath: filePath,
      contentHash: hash
    });
  }

  const indexedChunks: IndexedChunk[] = chunks.map((chunk) => ({
    chunkId: chunk.chunkId,
    sourceId: chunk.filePath,
    content: chunk.content,
    headingPath: chunk.headingPath,
    tokenEstimate: chunk.tokenEstimate
  }));

  return { documents, chunks: indexedChunks };
}

/**
 * Base class for deterministic corpus-backed retrieval providers.
 *
 * It centralizes provider honesty checks so concrete providers either run over
 * configured/indexed data or return a typed recoverable failure.
 */
abstract class CorpusRetrievalProvider implements RetrievalProvider {
  abstract readonly type: RetrievalProviderType;

  /**
   * Stores the provider id, optional static corpus, and optional storage provider.
   *
   * Either `corpus` or `storage` must be supplied for the provider to serve
   * queries. When only `storage` is supplied, `effectiveCorpus()` builds the
   * corpus on-the-fly from `storage.getChunks()` at query time (vectorless-local
   * path). When `corpus` is supplied it is used directly (test/fixture path).
   */
  protected constructor(
    readonly id: string,
    protected readonly corpus?: RetrievalCorpus,
    protected readonly storage?: KnowledgeIndexStorageCapability
  ) {}

  /**
   * Returns the effective corpus for this provider.
   *
   * Priority:
   * 1. Static corpus passed at construction — used by tests and fixture-based
   *    providers.
   * 2. Corpus built on-the-fly from `storage.getChunks()` — used by the
   *    vectorless-local (InMemory) profile and the Postgres bulk-fetch path for
   *    providers without optimized SQL (DocumentTree, SymbolCode, PageIndex).
   * 3. `undefined` when neither is configured or storage returns no chunks.
   *
   * Async because `getChunks()` is async — Postgres runs a SQL JOIN query here.
   */
  protected async effectiveCorpus(): Promise<RetrievalCorpus | undefined> {
    if (this.corpus) {
      return this.corpus;
    }

    if (this.storage) {
      const chunks = await this.storage.getChunks();

      if (chunks.length > 0) {
        return chunksToCorpus(chunks);
      }
    }

    return undefined;
  }

  /**
   * Validates common provider preconditions and resolves the corpus.
   *
   * Returns the resolved `RetrievalCorpus` on success so callers do not need to
   * call `effectiveCorpus()` a second time. Returns a typed recoverable failure
   * for empty query, missing configuration, or empty index.
   *
   * Async because `effectiveCorpus()` calls `storage.getChunks()` which may run
   * a SQL query for Postgres-backed providers.
   */
  protected async validateInput(input: RetrievalInput): Promise<FrameworkResult<RetrievalCorpus>> {
    // Empty queries are unsupported input.
    if (!input.query.trim()) {
      return unsupported<RetrievalCorpus>(this.id);
    }

    // Neither static corpus nor a storage provider is wired.
    if (!this.corpus && !this.storage) {
      return notConfigured<RetrievalCorpus>(this.id);
    }

    const corpus = await this.effectiveCorpus();

    if (!corpus || (corpus.documents.length === 0 && corpus.chunks.length === 0)) {
      return notIndexed<RetrievalCorpus>(this.id);
    }

    return ok(corpus);
  }

  abstract retrieve(input: RetrievalInput): Promise<FrameworkResult<readonly RetrievalResult[]>>;
}

/**
 * Keyword-oriented provider over indexed chunks and document titles.
 *
 * It favors exact lexical matches and returns bounded chunk previews with safe
 * document metadata. Accepts an optional `storage` reference for the vectorless-local
 * path where no static corpus is pre-built.
 */
export class FullTextProvider extends CorpusRetrievalProvider {
  readonly type = "full-text" as const;

  constructor(id: string, corpus?: RetrievalCorpus, storage?: KnowledgeIndexStorageCapability) {
    super(id, corpus, storage);
  }

  /**
   * Retrieves chunks that contain one or more query terms.
   *
   * SQL path (when storage has a non-null `.db` getter — Postgres with injected
   * database): runs a `ts_rank` / `plainto_tsquery` query using the pre-computed
   * `search_vector` tsvector column on `agentic_chunks`. Returns ranked results
   * without loading the full corpus.
   *
   * In-memory path (all other cases): builds corpus from `getChunks()` and
   * scores with lexical term overlap.
   */
  async retrieve(input: RetrievalInput): Promise<FrameworkResult<readonly RetrievalResult[]>> {
    if (!input.query.trim()) {
      return unsupported(this.id);
    }

    // SQL path: Postgres storage with an injected QueryableDatabase exposes a
    // non-null .db getter. Use the generated search_vector tsvector index for
    // efficient ranked full-text search.
    const storageDb = (this.storage as unknown as { db?: QueryableDatabase })?.db;

    if (storageDb) {
      try {
        type FtRow = {
          readonly chunk_id: string;
          readonly file_path: string;
          readonly heading_path: readonly string[] | null;
          readonly content: string;
          readonly token_estimate: number | null;
          readonly rank: number;
        };

        const limit = input.maxResults ?? 8;
        const result = await storageDb.query<FtRow>(
          `SELECT
            c.chunk_id,
            c.source_id AS file_path,
            c.heading_path,
            c.content,
            c.token_estimate,
            ts_rank(c.search_vector, plainto_tsquery('english', $1)) AS rank
          FROM agentic_chunks c
          WHERE c.search_vector @@ plainto_tsquery('english', $1)
          ORDER BY rank DESC
          LIMIT $2`,
          [input.query, limit]
        );

        if (result.rows.length === 0) {
          return notIndexed(this.id);
        }

        return ok(
          result.rows.map((row) => ({
            providerId: this.id,
            sourceId: row.file_path,
            score: row.rank,
            preview: boundedPreview(row.content),
            content: boundedPreview(row.content),
            tokenEstimate: row.token_estimate ?? estimateTokens(row.content),
            metadata: {
              chunkId: row.chunk_id,
              headingPath: (row.heading_path ?? []).join(" > "),
              retrievalType: "full-text",
              title: row.file_path.split("/").pop() ?? row.file_path,
              sourceVersion: "unknown",
              archived: false,
              sourcePriority: 0,
            }
          }))
        );
      } catch {
        return recoverable(
          "retrieval.not-configured",
          `FullTextProvider "${this.id}": SQL full-text query failed.`
        );
      }
    }

    // In-memory path: validate + get corpus from getChunks() or static fixture.
    const validated = await this.validateInput(input);

    if (!validated.ok) {
      return validated;
    }

    const corpus = validated.value;
    const queryTerms = terms(input.query);

    return ok(
      corpus.chunks
        .map((chunk) => {
          // Join chunk text with the document title so short title-only matches
          // can still surface the relevant chunk preview.
          const doc = corpus.documents.find((item) => item.sourceId === chunk.sourceId);
          const score = queryTerms.reduce((total, term) => {
            const text = normalizeText(`${chunk.content} ${doc?.title ?? ""}`);

            return total + (text.includes(term) ? 1 : 0);
          }, 0);

          return { chunk, doc, score };
        })
        .filter((match) => match.doc && match.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, input.maxResults ?? 8)
        .map(({ chunk, doc, score }) => ({
          providerId: this.id,
          sourceId: chunk.sourceId,
          score,
          preview: boundedPreview(chunk.content),
          content: boundedPreview(chunk.content),
          tokenEstimate: chunk.tokenEstimate ?? estimateTokens(chunk.content),
          metadata: metadataFor(doc!, {
            chunkId: chunk.chunkId,
            retrievalType: "full-text"
          })
        }))
    );
  }
}

type HeadingNode = {
  readonly heading: string;
  readonly depth: number;
  readonly sourceId: string;
  readonly content: string;
};

/**
 * Extracts Markdown heading nodes and nearby content for structure-aware
 * retrieval.
 */
function markdownHeadings(doc: IndexedDocument): readonly HeadingNode[] {
  const lines = doc.content.split(/\r?\n/);
  const nodes: HeadingNode[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(#{1,6})\s+(.+)$/.exec(lines[index] ?? "");

    if (!match) {
      continue;
    }

    const content = lines.slice(index, index + 8).join("\n");

    // Keep only a local window after each heading to avoid returning the full
    // document as one retrieval result.
    nodes.push({
      heading: match[2] ?? "",
      depth: match[1]?.length ?? 1,
      sourceId: doc.sourceId,
      content
    });
  }

  return nodes;
}

/**
 * Structure-aware provider over Markdown and similar heading-based documents.
 * Accepts an optional `storage` reference for the vectorless-local path.
 */
export class DocumentTreeProvider extends CorpusRetrievalProvider {
  readonly type = "document-tree" as const;

  constructor(id: string, corpus?: RetrievalCorpus, storage?: KnowledgeIndexStorageCapability) {
    super(id, corpus, storage);
  }

  /**
   * Retrieves heading nodes whose heading or nearby content matches the query.
   *
   * Uses the in-memory corpus path (no SQL bypass). For Postgres-backed profiles,
   * `getChunks()` returns rows from `agentic_chunks` joined with `agentic_sources`;
   * the reconstructed document content gives heading extraction the full source text.
   */
  async retrieve(input: RetrievalInput): Promise<FrameworkResult<readonly RetrievalResult[]>> {
    const validated = await this.validateInput(input);

    if (!validated.ok) {
      return validated;
    }

    const corpus = validated.value;
    const nodes = corpus.documents.flatMap((doc) => markdownHeadings(doc));

    if (nodes.length === 0) {
      return notIndexed(this.id);
    }

    const queryTerms = terms(input.query);

    return ok(
      nodes
        .map((node) => {
          // Score heading and local content together so high-level sections and
          // their first explanatory lines can both match.
          const doc = corpus.documents.find((item) => item.sourceId === node.sourceId)!;
          const text = normalizeText(`${node.heading} ${node.content}`);
          const score = queryTerms.reduce((total, term) => total + (text.includes(term) ? 1 : 0), 0);

          return { node, doc, score };
        })
        .filter((match) => match.score > 0)
        .sort((left, right) => right.score - left.score || left.node.depth - right.node.depth)
        .slice(0, input.maxResults ?? 8)
        .map(({ node, doc, score }) => ({
          providerId: this.id,
          sourceId: node.sourceId,
          score,
          preview: boundedPreview(node.content),
          content: boundedPreview(node.content),
          tokenEstimate: estimateTokens(node.content),
          metadata: metadataFor(doc, {
            heading: node.heading,
            depth: node.depth,
            retrievalType: "document-tree"
          })
        }))
    );
  }
}

/**
 * Long-document section provider that splits content by headings and page
 * markers. Accepts an optional `storage` reference for the Postgres bulk-fetch
 * path, consistent with the other corpus-backed providers.
 */
export class PageIndexProvider extends CorpusRetrievalProvider {
  readonly type = "page-index" as const;

  constructor(id: string, corpus?: RetrievalCorpus, storage?: KnowledgeIndexStorageCapability) {
    super(id, corpus, storage);
  }

  /**
   * Retrieves page-like sections with bounded section previews.
   *
   * Uses the in-memory corpus path (no SQL bypass). For Postgres-backed profiles,
   * `getChunks()` supplies the corpus via the bulk SQL fetch path.
   */
  async retrieve(input: RetrievalInput): Promise<FrameworkResult<readonly RetrievalResult[]>> {
    const validated = await this.validateInput(input);

    if (!validated.ok) {
      return validated;
    }

    const corpus = validated.value;
    const sections = corpus.documents.flatMap((doc) => {
      // Support both Markdown headings and explicit page markers so generated
      // docs and imported long-form docs can use the same provider.
      const parts = doc.content.split(/(?:^#{1,3}\s+|<!--\s*page:\s*[^>]+-->)/m).filter((part) => part.trim());

      return parts.map((part, index) => ({ doc, part, index }));
    });

    if (sections.length === 0) {
      return notIndexed(this.id);
    }

    const queryTerms = terms(input.query);

    return ok(
      sections
        .map((section) => {
          const text = normalizeText(section.part);
          const score = queryTerms.reduce((total, term) => total + (text.includes(term) ? 1 : 0), 0);

          return { ...section, score };
        })
        .filter((section) => section.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, input.maxResults ?? 8)
        .map((section) => ({
          providerId: this.id,
          sourceId: section.doc.sourceId,
          score: section.score,
          preview: boundedPreview(section.part),
          content: boundedPreview(section.part),
          tokenEstimate: estimateTokens(section.part),
          metadata: metadataFor(section.doc, {
            section: section.index,
            retrievalType: "page-index"
          })
        }))
    );
  }
}

type SymbolEntry = {
  readonly name: string;
  readonly kind: string;
  readonly sourceId: string;
  readonly lineNumber: number;
  readonly preview: string;
};

/**
 * Conservatively extracts TypeScript-like top-level symbols from source text.
 *
 * This fallback keeps the provider dependency-light while leaving room for a
 * future TypeScript AST implementation behind the same provider contract.
 */
function extractSymbols(doc: IndexedDocument): readonly SymbolEntry[] {
  const entries: SymbolEntry[] = [];
  const lines = doc.content.split(/\r?\n/);
  const pattern = /\b(?:export\s+)?(?:async\s+)?(class|interface|type|function|const|let|var|enum)\s+([A-Za-z_$][\w$]*)/;

  for (const [index, line] of lines.entries()) {
    const match = pattern.exec(line);

    if (match) {
      // Store line number and preview only; do not return a raw file body.
      entries.push({
        kind: match[1] ?? "symbol",
        name: match[2] ?? "unknown",
        sourceId: doc.sourceId,
        lineNumber: index + 1,
        preview: line.trim()
      });
    }
  }

  return entries;
}

/**
 * Code-aware provider that finds TypeScript-style symbols by name and kind.
 * Accepts an optional `storage` reference for the vectorless-local path.
 */
export class SymbolCodeProvider extends CorpusRetrievalProvider {
  readonly type = "symbol-code" as const;

  constructor(id: string, corpus?: RetrievalCorpus, storage?: KnowledgeIndexStorageCapability) {
    super(id, corpus, storage);
  }

  /**
   * Retrieves symbols matching exact or term-based code queries.
   *
   * Uses the in-memory corpus path (no SQL bypass). For vectorless-local, the
   * corpus comes from `InMemoryStorageProvider.getChunks()`. For Postgres
   * profiles, the corpus is built from the `getChunks()` SQL bulk-fetch path.
   */
  async retrieve(input: RetrievalInput): Promise<FrameworkResult<readonly RetrievalResult[]>> {
    const validated = await this.validateInput(input);

    if (!validated.ok) {
      return validated;
    }

    const corpus = validated.value;
    const symbols = corpus.documents.flatMap((doc) => extractSymbols(doc));

    if (symbols.length === 0) {
      return notIndexed(this.id);
    }

    const query = normalizeText(input.query);

    return ok(
      symbols
        .map((symbol) => {
          const doc = corpus.documents.find((item) => item.sourceId === symbol.sourceId)!;
          const symbolText = normalizeText(`${symbol.kind} ${symbol.name} ${symbol.preview}`);
          // Exact normalized symbol matches receive a stronger score than loose
          // term overlap so targeted code queries rise above broad text hits.
          const score = symbolText.includes(query) ? 3 : terms(input.query).filter((term) => symbolText.includes(term)).length;

          return { symbol, doc, score };
        })
        .filter((match) => match.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, input.maxResults ?? 8)
        .map(({ symbol, doc, score }) => ({
          providerId: this.id,
          sourceId: symbol.sourceId,
          score,
          preview: symbol.preview,
          content: symbol.preview,
          tokenEstimate: estimateTokens(symbol.preview),
          metadata: metadataFor(doc, {
            symbol: symbol.name,
            kind: symbol.kind,
            lineNumber: symbol.lineNumber,
            retrievalType: "symbol-code"
          })
        }))
    );
  }
}

/**
 * Creates deterministic mock vectors for local tests and schema-path checks.
 *
 * These vectors are not semantic embeddings. They are deliberately simple so
 * pgvector-compatible flow can be tested without paid provider SDKs.
 */
function deterministicVector(input: string, dimensions = 32): readonly number[] {
  const values = new Array<number>(dimensions).fill(0);

  for (const [index, char] of [...input].entries()) {
    // Fold character codes into a fixed-size vector to produce stable local
    // values for identical input text.
    values[index % dimensions] += char.charCodeAt(0) % 31;
  }

  const magnitude = Math.sqrt(values.reduce((total, value) => total + value * value, 0)) || 1;

  return values.map((value) => value / magnitude);
}

/**
 * Computes cosine similarity for deterministic vectors.
 */
function cosine(left: readonly number[], right: readonly number[]): number {
  return left.reduce((total, value, index) => total + value * (right[index] ?? 0), 0);
}

// ---------------------------------------------------------------------------
// Embedding providers
// ---------------------------------------------------------------------------

/**
 * Deterministic, dependency-free mock embedding provider for local tests and
 * vectorless RAG setups.
 *
 * Produces 1024-dimensional unit-normalized vectors using chained SHA-256
 * passes over the input text. Each pass feeds the previous output as input;
 * 32 passes yield 1024 bytes (one per dimension), producing a uniform
 * distribution fully deterministic and free of external dependencies or
 * network calls.
 *
 * These vectors are NOT semantically meaningful — similar texts do not produce
 * similar vectors. The provider is useful for exercising the pgvector code path,
 * testing index schema and migrations, and running framework-level integration
 * tests without a local model server.
 *
 * @example
 * ```typescript
 * const provider = new MockEmbeddingProvider();
 * const result = await provider.embedText("retrieval context");
 * console.log(result.model);            // "agentic-ai-infra-mock-embedding"
 * console.log(result.embedding.length); // 1024
 * ```
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly model = MOCK_EMBEDDING_MODEL;
  readonly version = MOCK_EMBEDDING_VERSION;
  readonly dimension = MOCK_EMBEDDING_DIMENSION;

  /**
   * Embeds a single text string using chained SHA-256 derivation and returns
   * a unit-normalized 1024-dimensional vector with full provenance fields.
   */
  async embedText(text: string): Promise<EmbeddingResult> {
    return {
      embedding: this.computeEmbedding(text),
      model: this.model,
      version: this.version,
      dimension: this.dimension
    };
  }

  /**
   * Embeds a batch by calling `embedText` for each input in order, echoing
   * correlation ids so callers can reconcile results by id rather than position.
   *
   * Sequential processing is intentional: the mock has no external rate limits
   * or concurrency concerns, and preserving call order makes test assertions
   * straightforward.
   */
  async embedBatch(inputs: readonly EmbeddingInput[]): Promise<readonly EmbeddingResult[]> {
    return Promise.all(
      inputs.map(async (input) => {
        const result = await this.embedText(input.text);

        return input.id !== undefined ? { ...result, id: input.id } : result;
      })
    );
  }

  /**
   * Produces a deterministic 1024-dimensional unit vector via chained SHA-256
   * passes (32 passes × 32 bytes = 1024 bytes → 1024 dimensions).
   *
   * Each pass feeds the previous digest as input so all dimensions receive
   * a SHA-256-derived byte. Each byte is scaled to [0, 1] before normalization
   * so every dimension starts with a non-negative component.
   */
  private computeEmbedding(text: string): readonly number[] {
    const passCount = Math.ceil(MOCK_EMBEDDING_DIMENSION / 32);
    const passes: Buffer[] = [];
    let prev: Buffer = createHash("sha256").update(text, "utf8").digest();
    passes.push(prev);
    for (let p = 1; p < passCount; p++) {
      prev = createHash("sha256").update(prev).digest();
      passes.push(prev);
    }

    const values = new Array<number>(MOCK_EMBEDDING_DIMENSION);
    for (let i = 0; i < MOCK_EMBEDDING_DIMENSION; i++) {
      values[i] = (passes[Math.floor(i / 32)]?.[i % 32] ?? 0) / 255;
    }

    // Unit normalization so cosine similarity equals the dot product directly.
    const magnitude = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0)) || 1;

    return values.map((v) => v / magnitude);
  }
}

/**
 * Configuration for `LocalEmbeddingProvider`.
 *
 * @example
 * ```typescript
 * const config: LocalEmbeddingProviderConfig = {
 *   baseUrl: "http://localhost:11434", // Ollama root URL
 *   model: "nomic-embed-text",
 *   dimension: 768
 * };
 * ```
 */
export type LocalEmbeddingProviderConfig = {
  /**
   * Root URL of the local embedding service (no trailing slash).
   *
   * The provider POSTs to `<baseUrl>/api/embeddings`. Values per server:
   * - Ollama:   `"http://localhost:11434"`
   * - LocalAI:  `"http://localhost:8080"`
   * - LM Studio (Ollama-compat mode): `"http://localhost:11434"`
   */
  readonly baseUrl: string;
  /** Model name passed in the request body, e.g. `"nomic-embed-text"`. */
  readonly model: string;
  /**
   * Expected vector dimension.
   *
   * The provider validates that every response vector matches this length.
   * Common model dimensions: nomic-embed-text → 768, mxbai-embed-large → 1024,
   * all-minilm → 384.
   */
  readonly dimension: number;
  /**
   * Version label included in every `EmbeddingResult`.
   *
   * Auto-derived as `local-<model>` when absent.
   */
  readonly version?: string;
  /**
   * JSON body field that carries the input text.
   *
   * Default: `"prompt"` (Ollama API).
   * Use `"input"` for OpenAI-compatible endpoints (LocalAI in OpenAI mode).
   */
  readonly promptField?: string;
  /**
   * JSON response field that contains the embedding array.
   *
   * Default: `"embedding"` (Ollama API).
   * The provider auto-detects both flat (`body[embeddingField]`) and
   * OpenAI-compatible nested (`body.data[0][embeddingField]`) response formats
   * without additional configuration.
   */
  readonly embeddingField?: string;
};

/**
 * HTTP-based embedding provider for local model servers compatible with
 * Ollama, LocalAI, and LM Studio (in Ollama-compatible mode).
 *
 * POSTs to `<baseUrl>/api/embeddings` with a JSON body containing the model
 * name and input text. Default field names match the Ollama API; override
 * `promptField` and `embeddingField` for other local server variants.
 *
 * All error paths (network failure, non-OK HTTP status, invalid JSON, missing
 * field, dimension mismatch) throw with descriptive messages so setup problems
 * surface immediately during provider configuration rather than silently
 * producing empty results.
 *
 * @example
 * ```typescript
 * // Ollama quick-start:
 * // 1. Install Ollama: https://ollama.ai/download
 * // 2. Pull a model: ollama pull nomic-embed-text
 * // 3. Ollama starts automatically on http://localhost:11434.
 *
 * const provider = new LocalEmbeddingProvider({
 *   baseUrl: "http://localhost:11434",
 *   model: "nomic-embed-text",
 *   dimension: 768
 * });
 * const result = await provider.embedText("retrieval context engineering");
 * console.log(result.embedding.length); // 768
 * ```
 *
 * Transparently supports both the flat Ollama response format
 * (`{ embedding: [...] }`) and the OpenAI-compatible nested format
 * (`{ data: [{ embedding: [...] }] }`). No additional config is required —
 * the flat format is checked first; if absent, the nested path is tried.
 *
 * Recommended free models (via Ollama):
 * - `nomic-embed-text` — 768 dims, good general-purpose quality
 * - `mxbai-embed-large` — 1024 dims, higher quality, larger download
 * - `all-minilm` — 384 dims, fast and lightweight
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly version: string;
  readonly dimension: number;

  private readonly baseUrl: string;
  private readonly promptField: string;
  private readonly embeddingField: string;

  /**
   * Creates a local HTTP embedding provider with the given server configuration.
   *
   * Trailing slashes on `baseUrl` are stripped so URL construction is
   * predictable regardless of how callers format the base URL.
   */
  constructor(config: LocalEmbeddingProviderConfig) {
    this.model = config.model;
    this.version = config.version ?? `local-${config.model}`;
    this.dimension = config.dimension;
    // Normalize trailing slashes so URL construction is deterministic.
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.promptField = config.promptField ?? "prompt";
    this.embeddingField = config.embeddingField ?? "embedding";
  }

  /**
   * Sends a single embedding request to the configured local server.
   *
   * Tries body[embeddingField] first (Ollama flat format), then
   * body.data[0][embeddingField] (OpenAI-compat nested format). Throws with a
   * descriptive message naming both paths if neither is found.
   *
   * Errors are thrown (not returned as `FrameworkResult`) so each failure mode
   * surfaces with a distinct message:
   * - Network error: the server is unreachable or refused the connection.
   * - HTTP error: the server returned a non-2xx status.
   * - JSON error: the response body could not be parsed.
   * - Missing field: the expected embedding array field was absent in both paths.
   * - Dimension mismatch: the returned vector length differs from `dimension`.
   */
  async embedText(text: string): Promise<EmbeddingResult> {
    const url = `${this.baseUrl}/api/embeddings`;
    let response: Response;

    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, [this.promptField]: text })
      });
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);

      throw new Error(`LocalEmbeddingProvider: network error connecting to ${url}: ${detail}`);
    }

    if (!response.ok) {
      throw new Error(
        `LocalEmbeddingProvider: HTTP ${response.status} ${response.statusText} from ${url}`
      );
    }

    let body: unknown;

    try {
      body = await response.json();
    } catch {
      throw new Error(`LocalEmbeddingProvider: invalid JSON response from ${url}`);
    }

    // Auto-detect response format.
    // (a) Flat Ollama format:       { "embedding": [...] }
    // (b) OpenAI-compat nested:     { "data": [{ "embedding": [...] }] }
    // Flat is checked first — it is the Ollama default and the most common case.
    const bodyRecord = body as Record<string, unknown>;
    let rawEmbedding: unknown = bodyRecord[this.embeddingField];

    if (!Array.isArray(rawEmbedding)) {
      // Try OpenAI-compat nested path: body.data[0][embeddingField]
      const dataArray = bodyRecord["data"];
      if (Array.isArray(dataArray) && dataArray.length > 0) {
        rawEmbedding = (dataArray[0] as Record<string, unknown>)[this.embeddingField];
      }
    }

    if (!Array.isArray(rawEmbedding)) {
      throw new Error(
        `LocalEmbeddingProvider: response from ${url} missing "${this.embeddingField}" ` +
        `field. Checked flat body["${this.embeddingField}"] and ` +
        `nested body.data[0]["${this.embeddingField}"] (OpenAI-compat). ` +
        `Configure embeddingField if your server uses a different field name.`
      );
    }

    if (rawEmbedding.length !== this.dimension) {
      throw new Error(
        `LocalEmbeddingProvider: expected ${this.dimension}-dimensional vector from ${url}` +
          ` but got ${rawEmbedding.length}`
      );
    }

    return {
      embedding: rawEmbedding as readonly number[],
      model: this.model,
      version: this.version,
      dimension: this.dimension
    };
  }

  /**
   * Embeds a batch sequentially, echoing correlation ids from inputs to results.
   *
   * Sequential processing is intentional: most local model servers run on a
   * single thread and concurrent requests do not improve throughput. Callers
   * that need parallel batching for performance should subclass and override.
   */
  async embedBatch(inputs: readonly EmbeddingInput[]): Promise<readonly EmbeddingResult[]> {
    const results: EmbeddingResult[] = [];

    for (const input of inputs) {
      const result = await this.embedText(input.text);

      results.push(input.id !== undefined ? { ...result, id: input.id } : result);
    }

    return results;
  }
}

// ---------------------------------------------------------------------------
// PgVectorProvider — vector similarity retrieval with optional real embeddings
// ---------------------------------------------------------------------------

/**
 * Pgvector-ready provider that supports both deterministic mock vectors and
 * real semantic embeddings from an `EmbeddingProvider`.
 *
 * When constructed with a real `EmbeddingProvider`, query vectors come from
 * that provider and produce semantically meaningful ranked results. Without a
 * provider the fallback to deterministic mock vectors exercises the vector
 * code path but does not prove semantic retrieval quality, and a warning is
 * emitted on every successful result.
 */
export class PgVectorProvider extends CorpusRetrievalProvider {
  readonly type = "pgvector" as const;

  /**
   * Creates a pgvector provider.
   *
   * @param id - Provider identifier used in result metadata.
   * @param corpus - Optional in-memory document and chunk store for tests.
   * @param embeddingProvider - Optional real embedding provider for semantic
   *   queries. Required for the SQL path (Postgres with injected database).
   *   When absent on the SQL path, the provider returns `not-configured` rather
   *   than falling back to mock embeddings for production queries. On the
   *   in-memory path, absent provider falls back to deterministic mock vectors
   *   with a `retrieval.mock-embedding` warning.
   * @param storage - Optional storage provider. When it exposes a non-null `.db`
   *   getter (PostgresStorageProvider with injected database), the SQL path runs
   *   a pgvector `<=>` cosine distance query instead of in-memory scoring.
   */
  constructor(
    id: string,
    corpus?: RetrievalCorpus,
    private readonly embeddingProvider?: EmbeddingProvider,
    storage?: KnowledgeIndexStorageCapability
  ) {
    super(id, corpus, storage);
  }

  /**
   * Retrieves vector-indexed chunks ranked by cosine similarity.
   *
   * SQL path (when storage has a non-null `.db` getter and an EmbeddingProvider
   * is injected): embeds the query with the provider, then runs a pgvector `<=>`
   * cosine distance query against `agentic_embeddings`. Returns `not-configured`
   * when the embedding provider is absent on the SQL path — no mock fallback for
   * production SQL queries.
   *
   * In-memory path (all other cases):
   * - Real provider present → `provider.embedText(query)` is called.
   * - No provider → deterministic mock vector; `retrieval.mock-embedding` warning.
   */
  async retrieve(input: RetrievalInput): Promise<FrameworkResult<readonly RetrievalResult[]>> {
    if (!input.query.trim()) {
      return unsupported(this.id);
    }

    // SQL path: Postgres storage with injected QueryableDatabase. Require a real
    // EmbeddingProvider — no mock-vector fallback for production SQL queries.
    const storageDb = (this.storage as unknown as { db?: QueryableDatabase })?.db;

    if (storageDb) {
      if (!this.embeddingProvider) {
        // Cannot run vector SQL without an embedding provider. Return not-configured
        // so the router can fall back to other providers (e.g. FullTextProvider).
        return notConfigured(this.id);
      }

      let queryVec: readonly number[];

      try {
        const embResult = await this.embeddingProvider.embedText(input.query);
        queryVec = embResult.embedding;
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);

        return recoverable(
          "retrieval.embedding-failed",
          `PgVectorProvider "${this.id}": embedding provider failed: ${detail}`
        );
      }

      try {
        type VecRow = {
          readonly chunk_id: string;
          readonly file_path: string;
          readonly heading_path: readonly string[] | null;
          readonly content: string;
          readonly token_estimate: number | null;
          readonly similarity: number;
        };

        const limit = input.maxResults ?? 8;
        // pgvector expects '[0.1,0.2,...]' literal format cast with ::vector.
        const vectorLiteral = `[${queryVec.join(",")}]`;
        const result = await storageDb.query<VecRow>(
          `SELECT
            c.chunk_id,
            c.source_id AS file_path,
            c.heading_path,
            c.content,
            c.token_estimate,
            1 - (e.embedding <=> $1::vector) AS similarity
          FROM agentic_embeddings e
          JOIN agentic_chunks c ON c.chunk_id = e.chunk_id
          WHERE e.embedding IS NOT NULL
          ORDER BY e.embedding <=> $1::vector
          LIMIT $2`,
          [vectorLiteral, limit]
        );

        if (result.rows.length === 0) {
          return notIndexed(this.id);
        }

        return ok(
          result.rows.map((row) => ({
            providerId: this.id,
            sourceId: row.file_path,
            score: row.similarity,
            preview: boundedPreview(row.content),
            content: boundedPreview(row.content),
            tokenEstimate: row.token_estimate ?? estimateTokens(row.content),
            metadata: {
              chunkId: row.chunk_id,
              headingPath: (row.heading_path ?? []).join(" > "),
              retrievalType: "pgvector",
              title: row.file_path.split("/").pop() ?? row.file_path,
              sourceVersion: "unknown",
              archived: false,
              sourcePriority: 0,
            }
          }))
        );
      } catch {
        return recoverable(
          "retrieval.not-configured",
          `PgVectorProvider "${this.id}": SQL vector query failed.`
        );
      }
    }

    // In-memory path: validate + resolve corpus.
    const validated = await this.validateInput(input);

    if (!validated.ok) {
      return validated;
    }

    const corpus = validated.value;
    const vectorChunks = corpus.chunks.filter((chunk) => chunk.vector?.length);

    // A configured provider without vectors is not indexed.
    if (vectorChunks.length === 0) {
      return notIndexed(this.id);
    }

    let queryVector: readonly number[];
    let usingMockVector = false;

    if (this.embeddingProvider) {
      let embeddingResult: EmbeddingResult;

      try {
        embeddingResult = await this.embeddingProvider.embedText(input.query);
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);

        return recoverable(
          "retrieval.embedding-failed",
          `PgVectorProvider "${this.id}": embedding provider failed: ${detail}`
        );
      }

      queryVector = embeddingResult.embedding;
    } else {
      // No real provider — fall back to deterministic mock vectors for local
      // and test environments.
      queryVector = deterministicVector(input.query);
      usingMockVector = true;
    }

    const results = vectorChunks
      .map((chunk) => {
        const doc = corpus.documents.find((item) => item.sourceId === chunk.sourceId)!;

        return {
          chunk,
          doc,
          score: cosine(queryVector, chunk.vector ?? deterministicVector(chunk.content))
        };
      })
      .sort((left, right) => right.score - left.score)
      .slice(0, input.maxResults ?? 8)
      .map(({ chunk, doc, score }) => ({
        providerId: this.id,
        sourceId: chunk.sourceId,
        score,
        preview: boundedPreview(chunk.content),
        content: boundedPreview(chunk.content),
        tokenEstimate: chunk.tokenEstimate ?? estimateTokens(chunk.content),
        // Attach the chunk's stored embedding vector so ContextOptimizer can use
        // cosine similarity for near-duplicate detection without a second embed call.
        // Only set when chunk.vector is non-null (real pgvector path, not mock).
        embedding: chunk.vector ? [...chunk.vector] : undefined,
        metadata: metadataFor(doc, {
          chunkId: chunk.chunkId,
          retrievalType: "pgvector",
          ...(usingMockVector ? { mockEmbedding: true } : {})
        })
      }));

    return usingMockVector
      ? ok(results, [
          validationIssue({
            path: this.id,
            code: "retrieval.mock-embedding",
            message:
              "Deterministic mock embeddings verify the vector path but do not prove semantic retrieval quality."
          })
        ])
      : ok(results);
  }
}

type GraphEdge = {
  readonly from: string;
  readonly to: string;
  readonly relationship: string;
  readonly sourceId: string;
};

/**
 * Extracts lightweight relationship edges from imports and Markdown links.
 */
function extractGraphEdges(doc: IndexedDocument): readonly GraphEdge[] {
  const edges: GraphEdge[] = [];
  const imports = [...doc.content.matchAll(/import\s+.*?\s+from\s+["']([^"']+)["']/g)];
  const links = [...doc.content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)];

  for (const match of imports) {
    // Imports model code-level dependency edges.
    edges.push({ from: doc.sourceId, to: match[1] ?? "", relationship: "imports", sourceId: doc.sourceId });
  }

  for (const match of links) {
    // Links model documentation/reference edges.
    edges.push({ from: doc.sourceId, to: match[1] ?? "", relationship: "links", sourceId: doc.sourceId });
  }

  return edges;
}

/**
 * Relationship provider over imports, links, and source references.
 */
export class GraphProvider extends CorpusRetrievalProvider {
  readonly type = "graph" as const;

  /**
   * Retrieves graph edges that match relationship-style queries.
   *
   * Uses the in-memory corpus path (no SQL bypass). For Postgres-backed profiles,
   * `getChunks()` supplies the corpus via the bulk SQL fetch path.
   */
  async retrieve(input: RetrievalInput): Promise<FrameworkResult<readonly RetrievalResult[]>> {
    const validated = await this.validateInput(input);

    if (!validated.ok) {
      return validated;
    }

    const corpus = validated.value;
    const edges = corpus.documents.flatMap((doc) => extractGraphEdges(doc));

    if (edges.length === 0) {
      return notIndexed(this.id);
    }

    const queryTerms = terms(input.query);

    return ok(
      edges
        .map((edge) => {
          const doc = corpus.documents.find((item) => item.sourceId === edge.sourceId)!;
          // Score edge endpoints and relation labels together so questions can
          // match either the source, target, or relationship type.
          const text = normalizeText(`${edge.from} ${edge.to} ${edge.relationship} ${doc.title}`);
          const score = queryTerms.reduce((total, term) => total + (text.includes(term) ? 1 : 0), 0);

          return { edge, doc, score };
        })
        .filter((match) => match.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, input.maxResults ?? 8)
        .map(({ edge, doc, score }) => ({
          providerId: this.id,
          sourceId: edge.sourceId,
          score,
          preview: `${edge.from} ${edge.relationship} ${edge.to}`,
          tokenEstimate: estimateTokens(`${edge.from} ${edge.relationship} ${edge.to}`),
          metadata: metadataFor(doc, {
            relationship: edge.relationship,
            target: edge.to,
            retrievalType: "graph"
          })
        }))
    );
  }
}

/** Retrieval route selected by the router for a query. */
export type RetrievalRoute = "exact-code" | "conceptual" | "long-document" | "relationship" | "hybrid";

/**
 * Optional configuration for merger and reranker injection into `RetrievalRouter`.
 *
 * Pass this as the second argument to the constructor to activate multi-provider
 * fusion (RRF) and/or heuristic reranking. When absent, the router behaves as it
 * did before Stage 18: sequential providers, simple concat-dedup, no reranking.
 */
export type RetrievalRouterOptions = {
  /**
   * Merger applied after all providers run.
   *
   * When present, provider results are collected into separate lists and passed
   * to `merger.merge([...lists])`. When absent, results are concatenated and
   * deduplicated by sourceId+preview.
   */
  merger?: RetrievalMerger;
  /**
   * Reranker applied after merging.
   *
   * When present, the merged list is passed to `reranker.rerank(list, query)`
   * before `maxResults` is applied. When absent, the merged list is used as-is.
   */
  reranker?: Reranker;
  /**
   * Optional maxResults override.
   *
   * Applied after reranking. When absent, `input.maxResults` controls the limit.
   */
  maxResults?: number;
  /**
   * Source-type priority map used to stamp `RetrievalResult.sourcePriority`.
   *
   * When absent, `DEFAULT_SOURCE_PRIORITY_MAP` is used.
   */
  sourcePriorityMap?: Record<string, number>;
};

/**
 * Routes queries to the provider set most likely to answer them, optionally
 * merges results across providers with ReciprocalRankFusion, and optionally
 * reranks with HeuristicReranker.
 *
 * Processing pipeline:
 * 1. Classify query → determine preferred provider order.
 * 2. Run all selected providers concurrently via Promise.allSettled.
 * 3. If `merger` is set: merge per-provider lists via the merger.
 *    Otherwise: concatenate + deduplicate results.
 * 4. If `reranker` is set: rerank the merged list.
 * 5. Apply maxResults limit.
 */
export class RetrievalRouter {
  private readonly merger?: RetrievalMerger;
  private readonly reranker?: Reranker;
  private readonly maxResultsConfig?: number;
  private readonly sourcePriorityMap: Record<string, number>;

  /**
   * Creates a RetrievalRouter.
   *
   * @param providers - Providers in caller priority order. The router reorders
   *   them per query but preserves the full list for fallback coverage.
   * @param options - Optional merger, reranker, maxResults, and sourcePriorityMap
   *   configuration. When omitted, the router behaves identically to prior versions.
   */
  constructor(
    private readonly providers: readonly RetrievalProvider[],
    options?: RetrievalRouterOptions
  ) {
    this.merger = options?.merger;
    this.reranker = options?.reranker;
    this.maxResultsConfig = options?.maxResults;
    this.sourcePriorityMap = options?.sourcePriorityMap ?? DEFAULT_SOURCE_PRIORITY_MAP;
  }

  /**
   * Classifies the query into a high-level retrieval route.
   */
  classify(query: string): RetrievalRoute {
    const normalized = normalizeText(query);

    // Code markers, symbols, and call-like syntax favor symbol and exact text
    // providers.
    if (/\b(import|function|class|interface|type|symbol|code)\b/.test(normalized) || /[A-Za-z_$][\w$]*\(/.test(query)) {
      return "exact-code";
    }

    // Relationship words favor graph retrieval.
    if (/\b(related|relationship|depends|imports|links|graph)\b/.test(normalized)) {
      return "relationship";
    }

    // Section/page vocabulary favors structure-aware long-document providers.
    if (/\b(section|page|heading|document|chapter|long)\b/.test(normalized)) {
      return "long-document";
    }

    return "conceptual";
  }

  /**
   * Runs routed providers, merges successful results, optionally reranks, and
   * returns bounded previews with score metadata.
   *
   * Providers run in parallel (Promise.allSettled). A thrown exception from any
   * one provider is treated as a skipped failure; other providers continue normally.
   *
   * When a `RetrievalMerger` is configured (e.g. `ReciprocalRankFusion`), each
   * provider's result list is kept separate and passed to the merger. Otherwise
   * results are concatenated and deduplicated by sourceId+preview (legacy path).
   *
   * When a `Reranker` is configured (e.g. `HeuristicReranker`), it is applied
   * after merging and before the final `maxResults` slice.
   */
  async retrieve(input: RetrievalInput): Promise<FrameworkResult<readonly RetrievalResult[]>> {
    if (this.providers.length === 0) {
      return recoverable("retrieval.not-configured", "No retrieval providers are configured.");
    }

    const route = this.classify(input.query);
    // Provider preference is intentionally simple and deterministic. More
    // advanced reranking can be added without changing provider contracts.
    const preferredTypes: readonly RetrievalProviderType[] =
      route === "exact-code"
        ? ["symbol-code", "full-text"]
        : route === "relationship"
          ? ["graph", "full-text"]
          : route === "long-document"
            ? ["document-tree", "page-index", "full-text"]
            : ["pgvector", "document-tree", "full-text"];
    const selected = [
      ...this.providers.filter((provider) => preferredTypes.includes(provider.type)),
      ...this.providers.filter((provider) => !preferredTypes.includes(provider.type))
    ];

    // Collect per-provider result lists when a merger is configured; otherwise
    // collect into a flat array (legacy path, no behavior change).
    const perProviderLists: RetrievalResult[][] = [];
    const flatCollected: RetrievalResult[] = [];

    // Execute all selected providers concurrently (Stage 21 parallelism fix).
    //
    // Promise.allSettled is used instead of Promise.all so a single provider
    // exception (thrown rather than returned as FrameworkResult) does not abort
    // other providers. This matches the existing "recoverable failures are skipped"
    // contract — the `for` loop previously silently skipped failed providers.
    //
    // Results are processed in the same order as `selected` so deduplication and
    // merger input ordering remain deterministic.
    const settled = await Promise.allSettled(
      selected.map((provider) => provider.retrieve(input))
    );

    for (const outcome of settled) {
      // A rejected promise means the provider threw unexpectedly (not returned
      // FrameworkResult) — treat as an unrecoverable provider failure and skip.
      if (outcome.status === "rejected") continue;

      const result = outcome.value;
      if (result.ok) {
        if (this.merger) {
          perProviderLists.push([...result.value]);
        } else {
          flatCollected.push(...result.value);
        }
      }
    }

    // Step 2: Merge — use the configured merger or fall back to concat+dedup.
    let merged: RetrievalResult[];

    if (this.merger && perProviderLists.length > 0) {
      merged = this.merger.merge(perProviderLists);
    } else {
      // Legacy path: deduplicate by sourceId+preview, sort by sourcePriority+score.
      const seen = new Set<string>();
      merged = flatCollected
        .filter((result) => result.metadata?.archived !== true)
        .sort((left, right) => {
          const lp = Number(left.metadata?.sourcePriority ?? 0);
          const rp = Number(right.metadata?.sourcePriority ?? 0);

          return rp - lp || right.score - left.score;
        })
        .filter((result) => {
          const key = `${result.sourceId}:${result.preview}`;

          if (seen.has(key)) {
            return false;
          }

          seen.add(key);
          return true;
        });
    }

    // Step 3: Rerank — apply the optional heuristic reranker.
    const reranked = this.reranker ? this.reranker.rerank(merged, input.query) : merged;

    // Step 4: Apply maxResults limit and re-bound previews.
    const limit = this.maxResultsConfig ?? input.maxResults ?? 8;

    return ok(
      reranked.slice(0, limit).map((result) => ({
        ...result,
        // Re-bound previews after merging so no provider can bypass the shared
        // output safety contract.
        preview: boundedPreview(result.preview),
        content: result.content ? boundedPreview(result.content) : undefined,
        // Stamp resolved sourcePriority as first-class field (Stage 22).
        sourcePriority:
          result.sourcePriority ??
          (result.sourceType ? (this.sourcePriorityMap[result.sourceType] ?? 0) : 0),
        metadata: {
          ...(result.metadata ?? {}),
          routedAs: route,
          scoreBreakdown: `${result.providerId}:${result.score.toFixed(3)}`
        }
      }))
    );
  }
}

/**
 * Public helper for tests and future indexers that need deterministic local
 * vectors compatible with the mock pgvector path.
 */
export function createDeterministicVector(content: string): readonly number[] {
  return deterministicVector(content);
}

// Re-export embedding config constants so callers can use them for index
// version checks and pgvector schema decisions without importing the internal
// config module directly.
export {
  MOCK_EMBEDDING_DIMENSION,
  MOCK_EMBEDDING_HNSW_EF_CONSTRUCTION,
  MOCK_EMBEDDING_HNSW_M,
  MOCK_EMBEDDING_INDEX_VERSION,
  MOCK_EMBEDDING_MODEL,
  MOCK_EMBEDDING_VERSION
} from "./embedding-config.js";

// createEmbeddingProvider factory — config-driven construction of EmbeddingProvider.
export { createEmbeddingProvider } from "./embedding-factory.js";

// Chunking pipeline — chunk factories, strategy implementations, dispatch router.
export * from "./chunkers.js";

// Project knowledge indexer — path policy, scanner, full index pipeline.
export * from "./indexer.js";

// Stage 18: multi-provider merger and heuristic reranker implementations.
export * from "./rrf-merger.js";
export * from "./heuristic-reranker.js";
