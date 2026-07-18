import { assertExactApprovalText } from "../../security/write-policy.js";
import {
  createProjectFileChunks,
  type ProjectFileChunkResult
} from "../chunking/chunk-project-file.js";
import type {
  IncludedKnowledgeScanFile,
  KnowledgeScanFile,
  KnowledgeScanScope,
} from "../chunking/chunk-types.js";
import {
  MOCK_EMBEDDING_DIMENSION,
  MOCK_EMBEDDING_HNSW_EF_CONSTRUCTION,
  MOCK_EMBEDDING_HNSW_M,
  MOCK_EMBEDDING_INDEX_VERSION,
  MOCK_EMBEDDING_MODEL,
  MOCK_EMBEDDING_VERSION
} from "../embeddings/embedding-config.js";
import { MockEmbeddingProvider } from "../embeddings/mock-embedding-provider.js";
import { ProjectKnowledgeStore } from "../storage/project-knowledge-store.js";
import { scanProjectKnowledge } from "./project-scanner.js";

export const REINDEX_PROJECT_KNOWLEDGE_APPROVAL_TEXT =
  "REINDEX_PROJECT_KNOWLEDGE";

export const INDEX_SKIPPED_EXAMPLE_CAP = 10;
export const INDEX_ERROR_EXAMPLE_CAP = 5;

export type ProjectKnowledgeIndexOptions = {
  scope?: KnowledgeScanScope;
  includeArchived?: boolean;
  forceReindex?: boolean;
  approvalText?: string;
};

export type ProjectKnowledgeSkippedExample = {
  filePath: string;
  reason: string;
};

export type ProjectKnowledgeErrorExample = {
  filePath: string;
  message: string;
};

export type ProjectKnowledgeIndexSummary = {
  status: "completed";
  scope: KnowledgeScanScope;
  includeArchived: boolean;
  forceReindex: boolean;
  filesScanned: number;
  filesIndexed: number;
  filesSkipped: number;
  chunksCreated: number;
  chunksEmbedded: number;
  indexVersion: string;
  embeddingModel: string;
  embeddingVersion: string;
  embeddingDimension: number;
  durationMs: number;
  skippedReasons: Record<string, number>;
  skippedExamples: ProjectKnowledgeSkippedExample[];
  skippedExamplesCap: number;
  errorExamples: ProjectKnowledgeErrorExample[];
  errorExamplesCap: number;
  clearedDocuments: number;
  maintenance: ProjectKnowledgeIndexMaintenanceSummary;
  message: string;
};

export type ProjectKnowledgeIndexMaintenanceSummary = {
  changedFiles: number;
  unchangedFiles: number;
  preSkippedFiles: number;
  postSkippedFiles: number;
  forceReindexRequested: boolean;
  hnsw: {
    indexType: "hnsw";
    m: number;
    efConstruction: number;
    scope: "mock-embedding-local-dev";
  };
  outputSafety: {
    returnsChunks: false;
    returnsVectors: false;
    returnsSql: false;
  };
};

function emptySkipReasonCounts(): Record<string, number> {
  return {};
}

function incrementSkipReason(
  counts: Record<string, number>,
  reason: string
): void {
  counts[reason] = (counts[reason] ?? 0) + 1;
}

function addSkippedExample(
  examples: ProjectKnowledgeSkippedExample[],
  example: ProjectKnowledgeSkippedExample
): void {
  if (examples.length < INDEX_SKIPPED_EXAMPLE_CAP) {
    examples.push(example);
  }
}

function addErrorExample(
  examples: ProjectKnowledgeErrorExample[],
  example: ProjectKnowledgeErrorExample
): void {
  if (examples.length < INDEX_ERROR_EXAMPLE_CAP) {
    examples.push(example);
  }
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Project knowledge indexing failed safely.";
}

function includedFiles(
  files: readonly KnowledgeScanFile[]
): IncludedKnowledgeScanFile[] {
  return files.filter((file): file is IncludedKnowledgeScanFile => {
    const candidate = file as Partial<IncludedKnowledgeScanFile>;

    return (
      candidate.status === "included" &&
      typeof candidate.sourceType === "string" &&
      typeof candidate.fileHash === "string" &&
      typeof candidate.contentHash === "string"
    );
  });
}

export function assertProjectKnowledgeReindexApprovalText(
  approvalText: string
): void {
  assertExactApprovalText({
    actual: approvalText,
    expected: REINDEX_PROJECT_KNOWLEDGE_APPROVAL_TEXT,
    deniedMessage:
      'Reindex denied: approvalText must exactly equal "REINDEX_PROJECT_KNOWLEDGE".'
  });
}

export function getProjectKnowledgeMockProviderMetadata(): {
  embeddingModel: string;
  embeddingVersion: string;
  embeddingDimension: number;
  indexVersion: string;
} {
  return {
    embeddingModel: MOCK_EMBEDDING_MODEL,
    embeddingVersion: MOCK_EMBEDDING_VERSION,
    embeddingDimension: MOCK_EMBEDDING_DIMENSION,
    indexVersion: MOCK_EMBEDDING_INDEX_VERSION
  };
}

async function isAlreadyIndexed(params: {
  store: ProjectKnowledgeStore;
  file: ProjectFileChunkResult;
}): Promise<boolean> {
  return params.store.hasCompleteDocumentIndex({
    filePath: params.file.filePath,
    fileHash: params.file.fileHash,
    contentHash: params.file.contentHash,
    indexVersion: MOCK_EMBEDDING_INDEX_VERSION,
    expectedChunks: params.file.totalChunks,
    embeddingModel: MOCK_EMBEDDING_MODEL,
    embeddingVersion: MOCK_EMBEDDING_VERSION,
    embeddingDimension: MOCK_EMBEDDING_DIMENSION
  });
}

async function isAlreadyIndexedBeforeChunking(params: {
  store: ProjectKnowledgeStore;
  file: IncludedKnowledgeScanFile;
}): Promise<boolean> {
  const result = await params.store.checkCompleteScannedFileIndex({
    filePath: params.file.filePath,
    fileHash: params.file.fileHash,
    contentHash: params.file.contentHash,
    indexVersion: MOCK_EMBEDDING_INDEX_VERSION,
    embeddingModel: MOCK_EMBEDDING_MODEL,
    embeddingVersion: MOCK_EMBEDDING_VERSION,
    embeddingDimension: MOCK_EMBEDDING_DIMENSION
  });

  return result.complete;
}

async function storeChunkEmbeddings(params: {
  store: ProjectKnowledgeStore;
  provider: MockEmbeddingProvider;
  documentId: string;
  file: ProjectFileChunkResult;
}): Promise<number> {
  const embeddings = await params.provider.embedBatch(
    params.file.chunks.map((chunk) => ({
      id: chunk.chunkId,
      text: chunk.content
    }))
  );
  let embedded = 0;

  for (const chunk of params.file.chunks) {
    const chunkDbId = await params.store.upsertChunk({
      documentId: params.documentId,
      chunk
    });
    const embedding = embeddings.find((result) => result.id === chunk.chunkId);

    if (!embedding) {
      throw new Error("Mock embedding result missing for chunk.");
    }

    await params.store.upsertEmbedding({
      chunkId: chunkDbId,
      embedding: embedding.embedding,
      embeddingModel: embedding.model,
      embeddingVersion: embedding.version,
      embeddingDimension: embedding.dimension,
      contentHash: chunk.contentHash,
      metadata: {
        provider: "mock",
        sourceChunkId: chunk.chunkId
      }
    });
    embedded += 1;
  }

  return embedded;
}

/**
 * Manual indexing is the only Milestone 3 write path.
 *
 * It reads only files admitted by the existing scanner/chunker policy, writes
 * only to the local AI database index, and always uses the mock embedding
 * provider. It never mutates project source files or chooses a paid provider.
 */
export async function indexProjectKnowledge(
  options: ProjectKnowledgeIndexOptions = {}
): Promise<ProjectKnowledgeIndexSummary> {
  const startedAtMs = Date.now();
  const scope = options.scope ?? "docs-and-mcp";
  const includeArchived = options.includeArchived === true;
  const forceReindex = options.forceReindex === true;
  const skippedReasons = emptySkipReasonCounts();
  const skippedExamples: ProjectKnowledgeSkippedExample[] = [];
  const errorExamples: ProjectKnowledgeErrorExample[] = [];
  const store = new ProjectKnowledgeStore();
  const provider = new MockEmbeddingProvider();
  let filesIndexed = 0;
  let filesSkipped = 0;
  let chunksCreated = 0;
  let chunksEmbedded = 0;
  let clearedDocuments = 0;
  let preSkippedFiles = 0;
  let postSkippedFiles = 0;
  let runId: string | undefined;

  if (scope !== "docs-and-mcp") {
    throw new Error("Access denied: unsupported project knowledge indexing scope.");
  }

  if (forceReindex) {
    assertProjectKnowledgeReindexApprovalText(options.approvalText ?? "");
  }

  const scanReport = await scanProjectKnowledge({
    scope,
    includeArchived
  });

  for (const [reason, count] of Object.entries(scanReport.skipReasonCounts)) {
    if (count > 0) {
      skippedReasons[reason] = count;
    }
  }

  for (const file of scanReport.files) {
    if (file.status === "skipped") {
      filesSkipped += 1;
      addSkippedExample(skippedExamples, {
        filePath: file.filePath,
        reason: file.skipReason ?? "skipped"
      });
    }
  }

  try {
    await store.assertReady();

    runId = await store.startIndexRun({
      indexVersion: MOCK_EMBEDDING_INDEX_VERSION,
      metadata: {
        scope,
        includeArchived,
        forceReindex,
        embeddingModel: provider.model,
        embeddingVersion: provider.version,
        embeddingDimension: provider.dimension
      }
    });

    if (forceReindex) {
      clearedDocuments = await store.clearCurrentMockIndex();
    }

    for (const scannedFile of includedFiles(scanReport.files)) {
      try {
        if (
          !forceReindex &&
          (await isAlreadyIndexedBeforeChunking({ store, file: scannedFile }))
        ) {
          filesSkipped += 1;
          preSkippedFiles += 1;
          incrementSkipReason(skippedReasons, "unchanged-pre-skip");
          addSkippedExample(skippedExamples, {
            filePath: scannedFile.filePath,
            reason: "unchanged-pre-skip"
          });
          continue;
        }

        const chunkResult = await createProjectFileChunks({
          scannedFile
        });

        if (await isAlreadyIndexed({ store, file: chunkResult })) {
          filesSkipped += 1;
          postSkippedFiles += 1;
          incrementSkipReason(skippedReasons, "unchanged");
          addSkippedExample(skippedExamples, {
            filePath: chunkResult.filePath,
            reason: "unchanged"
          });
          continue;
        }

        const documentId = await store.upsertDocument({
          filePath: chunkResult.filePath,
          sourceType: chunkResult.sourceType,
          fileHash: chunkResult.fileHash,
          contentHash: chunkResult.contentHash,
          indexVersion: MOCK_EMBEDDING_INDEX_VERSION,
          isArchived: chunkResult.isArchived,
          metadata: {
            sizeBytes: chunkResult.sizeBytes,
            totalChunks: chunkResult.totalChunks,
            chunkingStrategies: chunkResult.chunkingStrategies,
            warnings: chunkResult.warnings
          }
        });
        const embedded = await storeChunkEmbeddings({
          store,
          provider,
          documentId,
          file: chunkResult
        });

        filesIndexed += 1;
        chunksCreated += chunkResult.totalChunks;
        chunksEmbedded += embedded;
      } catch (error) {
        filesSkipped += 1;
        incrementSkipReason(skippedReasons, "indexing-error");
        addErrorExample(errorExamples, {
          filePath: scannedFile.filePath,
          message: safeErrorMessage(error)
        });
      }
    }

    await store.completeIndexRun({
      runId,
      filesScanned: scanReport.filesConsidered,
      filesIndexed,
      chunksCreated,
      chunksEmbedded,
      metadata: {
        scope,
        includeArchived,
        forceReindex,
        filesSkipped,
        skippedReasons,
        skippedExamplesReturned: skippedExamples.length,
        errorExamplesReturned: errorExamples.length,
        clearedDocuments,
        preSkippedFiles,
        postSkippedFiles
      }
    });
  } catch (error) {
    if (runId) {
      await store.failIndexRun({
        runId,
        filesScanned: scanReport.filesConsidered,
        filesIndexed,
        chunksCreated,
        chunksEmbedded,
        errorMessage: safeErrorMessage(error),
        metadata: {
          scope,
          includeArchived,
          forceReindex,
          filesSkipped,
          skippedReasons,
          clearedDocuments,
          preSkippedFiles,
          postSkippedFiles
        }
      });
    }

    throw error;
  }

  return {
    status: "completed",
    scope,
    includeArchived,
    forceReindex,
    filesScanned: scanReport.filesConsidered,
    filesIndexed,
    filesSkipped,
    chunksCreated,
    chunksEmbedded,
    indexVersion: MOCK_EMBEDDING_INDEX_VERSION,
    embeddingModel: provider.model,
    embeddingVersion: provider.version,
    embeddingDimension: provider.dimension,
    durationMs: Date.now() - startedAtMs,
    skippedReasons,
    skippedExamples,
    skippedExamplesCap: INDEX_SKIPPED_EXAMPLE_CAP,
    errorExamples,
    errorExamplesCap: INDEX_ERROR_EXAMPLE_CAP,
    clearedDocuments,
    maintenance: {
      changedFiles: filesIndexed,
      unchangedFiles: preSkippedFiles + postSkippedFiles,
      preSkippedFiles,
      postSkippedFiles,
      forceReindexRequested: forceReindex,
      hnsw: {
        indexType: "hnsw",
        m: MOCK_EMBEDDING_HNSW_M,
        efConstruction: MOCK_EMBEDDING_HNSW_EF_CONSTRUCTION,
        scope: "mock-embedding-local-dev"
      },
      outputSafety: {
        returnsChunks: false,
        returnsVectors: false,
        returnsSql: false
      }
    },
    message:
      errorExamples.length === 0
        ? "Project knowledge indexed with mock embeddings."
        : "Project knowledge indexing completed with capped per-file errors."
  };
}
