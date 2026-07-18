import { createHash } from "node:crypto";
import type { CacheKeyParts, FreshnessPolicy, SourceVersionMetadata } from "@maharudra/agentic-ai-infra-core";

/**
 * One runtime cache entry with optional expiry and source-version metadata.
 */
export type RuntimeCacheEntry<T> = {
  readonly key: string;
  readonly value: T;
  readonly createdAt: string;
  readonly expiresAt?: string;
  readonly sourceVersion?: string;
};

/**
 * Creates a stable SHA-256 hash for cache input objects.
 */
export function stableHash(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

/**
 * Builds cache keys from all inputs that can affect retrieval/context output.
 *
 * Including config, provider, source, input, and freshness versions prevents
 * stale context from being reused after a policy or source change.
 */
export function buildCacheKey(parts: CacheKeyParts & {
  readonly configHash?: string;
  readonly providerVersion?: string;
  readonly freshnessPolicy?: FreshnessPolicy;
}): string {
  // Hash a structured object instead of string concatenation so fields stay
  // explicit and collisions from ambiguous separators are avoided.
  return stableHash({
    providerId: parts.providerId,
    operation: parts.operation,
    projectSlug: parts.projectSlug ?? "unknown",
    sourceVersion: parts.sourceVersion ?? "unknown",
    inputHash: parts.inputHash,
    configHash: parts.configHash ?? "default",
    providerVersion: parts.providerVersion ?? "default",
    freshnessPolicy: parts.freshnessPolicy ?? {}
  });
}

/**
 * Lightweight in-memory cache used by runtime services and tests.
 *
 * The class is deliberately small but final-interface-compatible with future
 * persistent caches.
 */
export class InMemoryRuntimeCache<T> {
  private readonly entries = new Map<string, RuntimeCacheEntry<T>>();

  /**
   * Reads an entry and lazily evicts it if the TTL has expired.
   */
  get(key: string): RuntimeCacheEntry<T> | undefined {
    const entry = this.entries.get(key);

    // Entries without TTL are valid until callers overwrite or clear them.
    if (!entry?.expiresAt) {
      return entry;
    }

    // Expired entries are removed on read to keep the implementation simple and
    // deterministic without background timers.
    if (Date.parse(entry.expiresAt) < Date.now()) {
      this.entries.delete(key);
      return undefined;
    }

    return entry;
  }

  /**
   * Stores an entry with optional TTL and source version metadata.
   */
  set(key: string, value: T, ttlSeconds?: number, sourceVersion?: string): RuntimeCacheEntry<T> {
    const createdAt = new Date().toISOString();
    const expiresAt =
      ttlSeconds === undefined
        ? undefined
        : new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const entry = { key, value, createdAt, expiresAt, sourceVersion };

    // Store the exact value provided by the caller; serialization boundaries are
    // owned by future persistent cache adapters.
    this.entries.set(key, entry);
    return entry;
  }
}

/**
 * Evaluates source freshness against a policy and returns warnings instead of
 * silently trusting stale data.
 */
export function evaluateFreshness(params: {
  readonly source: SourceVersionMetadata;
  readonly policy: FreshnessPolicy;
  readonly now?: Date;
}): { readonly fresh: boolean; readonly warnings: readonly string[] } {
  const warnings: string[] = [];

  // Source version metadata lets context packages explain which source revision
  // they were built from.
  if (params.policy.requireSourceVersion && !params.source.version) {
    warnings.push(`Source ${params.source.sourceId} is missing required version metadata.`);
  }

  if (params.policy.maxAgeSeconds && params.source.updatedAt) {
    const ageSeconds =
      ((params.now ?? new Date()).getTime() - Date.parse(params.source.updatedAt)) / 1000;

    if (ageSeconds > params.policy.maxAgeSeconds) {
      warnings.push(`Source ${params.source.sourceId} is stale for the configured freshness policy.`);
    }
  }

  return { fresh: warnings.length === 0, warnings };
}
