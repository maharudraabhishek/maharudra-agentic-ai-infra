/** Cache policy for context and retrieval outputs. */
export type CachePolicy = {
  readonly enabled: boolean;
  readonly ttlSeconds?: number;
  readonly maxEntries?: number;
  readonly namespace?: string;
};

/** Structured parts used to build stable cache keys. */
export type CacheKeyParts = {
  readonly providerId: string;
  readonly operation: string;
  readonly projectSlug?: string;
  readonly sourceVersion?: string;
  readonly inputHash: string;
};

/** Freshness requirements for retrieved or cached context. */
export type FreshnessPolicy = {
  readonly maxAgeSeconds?: number;
  readonly requireSourceVersion?: boolean;
  readonly staleWhileRevalidate?: boolean;
};

/** Project-level freshness configuration. */
export type FreshnessConfig = {
  readonly defaultPolicy: FreshnessPolicy;
  readonly cache?: CachePolicy;
};

/** Version metadata for one indexed source. */
export type SourceVersionMetadata = {
  readonly sourceId: string;
  readonly version: string;
  readonly contentHash?: string;
  readonly updatedAt?: string;
};
