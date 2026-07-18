import type { RoleContextSlice, SharedContextPacket } from "../agents/types.js";
import type { RetrievalResult } from "../retrieval/types.js";
import type { TokenBudgetPolicy } from "../token/types.js";

/** Input required to build a context package. */
export type ContextBuilderInput = {
  readonly task: string;
  readonly retrievalResults: readonly RetrievalResult[];
  readonly tokenBudget: TokenBudgetPolicy;
  readonly includeSecurityContext?: boolean;
};

/** Source citation metadata included in a context package. */
export type ContextSource = {
  readonly sourceId: string;
  readonly providerId?: string;
  readonly label: string;
  readonly tokenEstimate?: number;
};

/** Compact context package assembled from retrieval results. */
export type ContextPackage = {
  readonly id: string;
  readonly task: string;
  readonly taskHash?: string;
  readonly taskType?: string;
  readonly sources: readonly ContextSource[];
  readonly contextText: string;
  readonly tokenEstimate: number;
  readonly warnings?: readonly string[];
  readonly sharedPacket?: SharedContextPacket;
  readonly roleSlices?: readonly RoleContextSlice[];
};

/** Optimization policy used when trimming and deduping context. */
export type ContextOptimizerPolicy = {
  readonly maxContextTokens: number;
  readonly dedupeSources: boolean;
  readonly preferCitations: boolean;
  readonly includeSecurityWarnings: boolean;
  /**
   * Cosine similarity threshold for near-duplicate detection in [0, 1].
   *
   * Results whose embedding vectors have cosine similarity >= this threshold
   * are considered near-duplicates. The lower-priority result (earlier in the
   * pre-sorted order has higher priority) is dropped. Applies only when an
   * `EmbeddingProvider` is available or `result.embedding` is populated.
   *
   * Default: 0.95.
   */
  readonly dedupThreshold?: number;
  /**
   * When true, applies sentence-level compression to each result's content
   * before context assembly. Low-signal sentences (fewer than 6 words, no
   * citation markers) are trimmed. Citation markers (`[N]`) are always
   * preserved regardless of sentence length.
   *
   * Default: false — compression is opt-in because it mutates retrieved content.
   */
  readonly compressionEnabled?: boolean;
};
