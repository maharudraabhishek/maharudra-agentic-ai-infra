import {
  DEFAULT_FALLBACK_CHUNK_CHARS,
  MAX_KNOWLEDGE_FILE_BYTES
} from "../../config/mcp-config.js";
import type {
  IncludedKnowledgeScanFile,
  KnowledgeScanReport
} from "../chunking/chunk-types.js";
import { chunkTextWithFallback } from "../chunking/fallback-chunker.js";
import { chunkMarkdownByHeadings } from "../chunking/markdown-chunker.js";
import { chunkTypeScriptByAst } from "../chunking/typescript-ast-chunker.js";
import {
  MOCK_EMBEDDING_DIMENSION,
  MOCK_EMBEDDING_HNSW_EF_CONSTRUCTION,
  MOCK_EMBEDDING_HNSW_M,
  MOCK_EMBEDDING_MODEL,
  MOCK_EMBEDDING_VERSION
} from "../embeddings/embedding-config.js";
import { MockEmbeddingProvider } from "../embeddings/mock-embedding-provider.js";
import {
  assertProjectKnowledgeReindexApprovalText,
  getProjectKnowledgeMockProviderMetadata,
  INDEX_ERROR_EXAMPLE_CAP,
  INDEX_SKIPPED_EXAMPLE_CAP
} from "../indexing/project-knowledge-indexer.js";
import { isIndexableProjectPath } from "../indexing/indexing-policy.js";
import {
  createKnowledgeFileHashes,
  scanProjectKnowledge
} from "../indexing/project-scanner.js";

type EvalStatus = "passed" | "failed";

export type KnowledgePipelineEvalResult = {
  name: string;
  status: EvalStatus;
  expected: string;
  actual: string;
};

export type KnowledgePipelineEvalReport = {
  suiteName: "knowledge-pipeline-evals";
  status: EvalStatus;
  total: number;
  passed: number;
  failed: number;
  results: KnowledgePipelineEvalResult[];
};

function makeEvalFile(params: {
  filePath: string;
  content: string;
}): IncludedKnowledgeScanFile {
  const hashes = createKnowledgeFileHashes({
    filePath: params.filePath,
    sizeBytes: Buffer.byteLength(params.content, "utf8"),
    content: params.content
  });

  return {
    filePath: params.filePath,
    status: "included",
    sourceType: params.filePath.endsWith(".ts")
      ? "typescript-source"
      : "project-doc",
    fileHash: hashes.fileHash,
    contentHash: hashes.contentHash,
    sizeBytes: Buffer.byteLength(params.content, "utf8"),
    isArchived: false
  };
}

function passOrFail(params: {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
}): KnowledgePipelineEvalResult {
  return {
    name: params.name,
    status: params.passed ? "passed" : "failed",
    expected: params.expected,
    actual: params.actual
  };
}

function hasForbiddenContentKey(value: unknown): boolean {
  if (value === null || typeof value !== "object") {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some((item) => hasForbiddenContentKey(item));
  }

  return Object.entries(value as Record<string, unknown>).some(
    ([key, child]) => key.toLowerCase() === "content" || hasForbiddenContentKey(child)
  );
}

function evalPathNotIndexable(params: {
  name: string;
  filePath: string;
  expected: string;
}): KnowledgePipelineEvalResult {
  const result = isIndexableProjectPath(params.filePath);

  return passOrFail({
    name: params.name,
    passed: !result.indexable,
    expected: params.expected,
    actual: result.indexable
      ? "Path was unexpectedly indexable."
      : `Path skipped with reason ${result.skipReason ?? "unknown"}.`
  });
}

function evalPathIndexable(params: {
  name: string;
  filePath: string;
  expected: string;
}): KnowledgePipelineEvalResult {
  const result = isIndexableProjectPath(params.filePath, {
    sizeBytes: Math.min(1024, MAX_KNOWLEDGE_FILE_BYTES)
  });

  return passOrFail({
    name: params.name,
    passed: result.indexable,
    expected: params.expected,
    actual: result.indexable
      ? `Path is indexable as ${result.sourceType}.`
      : `Path skipped with reason ${result.skipReason ?? "unknown"}.`
  });
}

function evalMarkdownChunking(): KnowledgePipelineEvalResult {
  const content = [
    "# Local Knowledge",
    "",
    "Scanner notes.",
    "",
    "## Chunking",
    "",
    "Heading-aware chunking keeps metadata."
  ].join("\n");
  const chunks = chunkMarkdownByHeadings({
    text: content,
    scannedFile: makeEvalFile({
      filePath: "docs/example.md",
      content
    })
  });
  const hasHeadingMetadata = chunks.some(
    (chunk) => chunk.headingPath && chunk.headingPath.length > 0
  );

  return passOrFail({
    name: "markdown-heading-metadata",
    passed: hasHeadingMetadata,
    expected: "Markdown chunking returns at least one chunk with headingPath metadata.",
    actual: `Created ${chunks.length} markdown chunks.`
  });
}

function evalTypeScriptChunking(): KnowledgePipelineEvalResult {
  const content = [
    "export function safeExample(): string {",
    "  return \"ok\";",
    "}",
    "",
    "export type SafeShape = { value: string };"
  ].join("\n");
  const chunks = chunkTypeScriptByAst({
    text: content,
    scannedFile: makeEvalFile({
      filePath: "mcp/rudraloka-dev-mcp/src/example.ts",
      content
    })
  });
  const hasSymbolOrFallback = chunks.some(
    (chunk) =>
      Boolean(chunk.symbolName) ||
      typeof chunk.metadata.safeFallbackReason === "string"
  );

  return passOrFail({
    name: "typescript-symbol-or-safe-fallback",
    passed: chunks.length > 0 && hasSymbolOrFallback,
    expected:
      "TypeScript chunking returns at least one symbol-aware chunk or safe fallback chunk.",
    actual: `Created ${chunks.length} TypeScript chunks.`
  });
}

function evalFallbackBounds(): KnowledgePipelineEvalResult {
  const content = "A".repeat(DEFAULT_FALLBACK_CHUNK_CHARS * 2 + 200);
  const chunks = chunkTextWithFallback({
    text: content,
    scannedFile: makeEvalFile({
      filePath: "docs/fallback-example.md",
      content
    })
  });
  const withinBounds = chunks.every(
    (chunk) => chunk.content.length <= DEFAULT_FALLBACK_CHUNK_CHARS
  );

  return passOrFail({
    name: "fallback-chunker-bounds",
    passed: chunks.length > 1 && withinBounds,
    expected: "Fallback chunker creates bounded chunks.",
    actual: `Created ${chunks.length} fallback chunks.`
  });
}

function evalScannerOmitsContents(report: KnowledgeScanReport): KnowledgePipelineEvalResult {
  const includesContent = hasForbiddenContentKey(report);

  return passOrFail({
    name: "scanner-report-omits-full-contents",
    passed: !includesContent,
    expected: "Scanner report contains file metadata and hashes, but no full file contents.",
    actual: includesContent
      ? "Scanner report contained a forbidden content key."
      : `Scanner report returned ${report.files.length} metadata entries.`
  });
}

async function evalMockEmbeddingDeterministic(): Promise<KnowledgePipelineEvalResult> {
  const provider = new MockEmbeddingProvider();
  const first = await provider.embedText("same local mock text");
  const second = await provider.embedText("same local mock text");
  const deterministic =
    JSON.stringify(first.embedding) === JSON.stringify(second.embedding);

  return passOrFail({
    name: "mock-embedding-deterministic",
    passed: deterministic,
    expected: "MockEmbeddingProvider returns the same vector for the same input text.",
    actual: deterministic
      ? "Repeated mock embedding calls matched exactly."
      : "Repeated mock embedding calls differed."
  });
}

async function evalMockEmbeddingDimension(): Promise<KnowledgePipelineEvalResult> {
  const provider = new MockEmbeddingProvider();
  const result = await provider.embedText("dimension check");

  return passOrFail({
    name: "mock-embedding-dimension-matches-config",
    passed:
      provider.dimension === MOCK_EMBEDDING_DIMENSION &&
      result.embedding.length === MOCK_EMBEDDING_DIMENSION,
    expected: "Mock embedding vectors use the configured 64-dimensional shape.",
    actual: `Provider dimension ${provider.dimension}; vector length ${result.embedding.length}.`
  });
}

function evalIndexerUsesMockProviderOnly(): KnowledgePipelineEvalResult {
  const metadata = getProjectKnowledgeMockProviderMetadata();
  const passed =
    metadata.embeddingModel === MOCK_EMBEDDING_MODEL &&
    metadata.embeddingVersion === MOCK_EMBEDDING_VERSION &&
    metadata.embeddingDimension === MOCK_EMBEDDING_DIMENSION;

  return passOrFail({
    name: "indexer-uses-mock-provider-only",
    passed,
    expected:
      "Milestone 3 indexing metadata is tied to the deterministic mock provider only.",
    actual: passed
      ? `${metadata.embeddingModel}/${metadata.embeddingVersion}/${metadata.embeddingDimension}.`
      : "Indexer metadata did not match mock provider constants."
  });
}

function evalForceReindexRequiresApproval(): KnowledgePipelineEvalResult {
  try {
    assertProjectKnowledgeReindexApprovalText("REINDEX_WITHOUT_APPROVAL");

    return passOrFail({
      name: "force-reindex-approval-required",
      passed: false,
      expected:
        "Force reindex is denied unless approvalText exactly matches REINDEX_PROJECT_KNOWLEDGE.",
      actual: "Approval check unexpectedly accepted the wrong text."
    });
  } catch (error) {
    return passOrFail({
      name: "force-reindex-approval-required",
      passed:
        error instanceof Error &&
        /REINDEX_PROJECT_KNOWLEDGE|must exactly equal/i.test(error.message),
      expected:
        "Force reindex is denied unless approvalText exactly matches REINDEX_PROJECT_KNOWLEDGE.",
      actual: error instanceof Error ? error.message : String(error)
    });
  }
}

function evalIndexOutputCaps(): KnowledgePipelineEvalResult {
  const passed = INDEX_SKIPPED_EXAMPLE_CAP <= 10 && INDEX_ERROR_EXAMPLE_CAP <= 5;

  return passOrFail({
    name: "index-output-example-caps",
    passed,
    expected:
      "Indexing summaries cap skipped examples at 10 and error examples at 5.",
    actual: `skipped cap ${INDEX_SKIPPED_EXAMPLE_CAP}; error cap ${INDEX_ERROR_EXAMPLE_CAP}.`
  });
}

function evalHnswDefaultsDocumentedInConfig(): KnowledgePipelineEvalResult {
  const passed =
    MOCK_EMBEDDING_HNSW_M === 8 &&
    MOCK_EMBEDDING_HNSW_EF_CONSTRUCTION === 32;

  return passOrFail({
    name: "mock-hnsw-defaults-config-aware",
    passed,
    expected:
      "Mock embedding HNSW defaults remain the documented local-dev values without rewriting migrations.",
    actual: `m=${MOCK_EMBEDDING_HNSW_M}; efConstruction=${MOCK_EMBEDDING_HNSW_EF_CONSTRUCTION}.`
  });
}

function evalNoPaidProviderSurface(): KnowledgePipelineEvalResult {
  const provider = new MockEmbeddingProvider();
  const providerShape = [provider.model, provider.version].join(" ");
  const mentionsPaidProvider =
    /openai|anthropic|cohere|voyage|hosted|api[-_ ]?key/i.test(providerShape);

  return passOrFail({
    name: "no-paid-provider-surface",
    passed: !mentionsPaidProvider,
    expected:
      "Milestone 3 exposes only the local deterministic mock embedding provider.",
    actual: mentionsPaidProvider
      ? `Provider metadata looked paid/hosted: ${providerShape}.`
      : `Provider metadata is local mock-only: ${providerShape}.`
  });
}

export async function runKnowledgePipelineEvals(): Promise<KnowledgePipelineEvalReport> {
  const results: KnowledgePipelineEvalResult[] = [];

  results.push(
    evalPathNotIndexable({
      name: "env-not-indexable",
      filePath: ".env",
      expected: ".env is denied by indexing policy."
    })
  );
  results.push(
    evalPathNotIndexable({
      name: "node-modules-not-indexable",
      filePath: "node_modules/example.md",
      expected: "node_modules is denied by indexing policy."
    })
  );
  results.push(
    evalPathNotIndexable({
      name: "archive-excluded-by-default",
      filePath: "docs/99-archive/example.md",
      expected: "docs/99-archive is excluded unless includeArchived is explicit."
    })
  );
  results.push(
    evalPathIndexable({
      name: "agents-md-indexable",
      filePath: "AGENTS.md",
      expected: "AGENTS.md is an approved project policy source."
    })
  );
  results.push(
    evalPathIndexable({
      name: "docs-markdown-indexable",
      filePath: "docs/04-ai-infra/local-mcp-agentic-context-rag-design-spec.md",
      expected: "Approved docs Markdown files are indexable."
    })
  );
  results.push(
    evalPathIndexable({
      name: "mcp-typescript-source-indexable",
      filePath: "mcp/rudraloka-dev-mcp/src/server.ts",
      expected: "MCP TypeScript source files are indexable."
    })
  );
  results.push(evalMarkdownChunking());
  results.push(evalTypeScriptChunking());
  results.push(evalFallbackBounds());
  results.push(await evalMockEmbeddingDeterministic());
  results.push(await evalMockEmbeddingDimension());
  results.push(evalIndexerUsesMockProviderOnly());
  results.push(evalForceReindexRequiresApproval());
  results.push(evalIndexOutputCaps());
  results.push(evalHnswDefaultsDocumentedInConfig());
  results.push(evalNoPaidProviderSurface());

  const scanReport = await scanProjectKnowledge({
    scope: "docs-and-mcp",
    includeArchived: false
  });
  results.push(evalScannerOmitsContents(scanReport));

  const passed = results.filter((result) => result.status === "passed").length;
  const failed = results.length - passed;

  return {
    suiteName: "knowledge-pipeline-evals",
    status: failed === 0 ? "passed" : "failed",
    total: results.length,
    passed,
    failed,
    results
  };
}
