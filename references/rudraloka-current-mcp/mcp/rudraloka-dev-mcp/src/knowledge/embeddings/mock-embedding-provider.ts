import { sha256 } from "../../utils/crypto.js";
import {
  MOCK_EMBEDDING_DIMENSION,
  MOCK_EMBEDDING_MODEL,
  MOCK_EMBEDDING_VERSION
} from "./embedding-config.js";
import type {
  EmbeddingInput,
  EmbeddingProvider,
  EmbeddingResult
} from "./embedding-provider.js";

function bytesForText(text: string): number[] {
  const bytes: number[] = [];
  let block = 0;

  while (bytes.length < MOCK_EMBEDDING_DIMENSION) {
    const digest = Buffer.from(sha256(`${MOCK_EMBEDDING_VERSION}:${block}:${text}`), "hex");
    bytes.push(...digest);
    block += 1;
  }

  return bytes.slice(0, MOCK_EMBEDDING_DIMENSION);
}

function normalizeVector(values: number[]): number[] {
  const raw = values.map((value) => (value - 127.5) / 127.5);
  const magnitude = Math.sqrt(
    raw.reduce((sum, value) => sum + value * value, 0)
  );

  if (magnitude === 0) {
    return raw.map(() => 0);
  }

  return raw.map((value) => Number((value / magnitude).toFixed(8)));
}

/**
 * Mock embeddings intentionally do not provide real semantic quality.
 *
 * This provider exists to prove the scanner, chunker, storage, indexing, and
 * eval pipeline without API keys, provider SDKs, network calls, or cost. Real
 * semantic retrieval comes later through a separately approved provider and
 * embedding version.
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly model = MOCK_EMBEDDING_MODEL;
  readonly version = MOCK_EMBEDDING_VERSION;
  readonly dimension = MOCK_EMBEDDING_DIMENSION;

  async embedText(text: string): Promise<EmbeddingResult> {
    const embedding = normalizeVector(bytesForText(text));

    return {
      embedding,
      model: this.model,
      version: this.version,
      dimension: this.dimension
    };
  }

  async embedBatch(inputs: readonly EmbeddingInput[]): Promise<EmbeddingResult[]> {
    return Promise.all(
      inputs.map(async (input) => ({
        ...(await this.embedText(input.text)),
        id: input.id
      }))
    );
  }
}
