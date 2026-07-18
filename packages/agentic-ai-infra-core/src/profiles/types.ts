import type {
  AgenticInfraProjectConfig,
  ResolvedProjectConfig
} from "../config/types.js";
import type { FrameworkResult } from "../errors/index.js";

/** Built-in profile names supported by the core package. */
export const BUILT_IN_PROFILE_NAMES = [
  "minimal",
  "secure-readonly",
  "controlled-write",
  /**
   * Zero-dependency profile — full-text, document-tree, and symbol retrieval
   * from in-memory index. No Postgres or pgvector required.
   */
  "vectorless-local",
  "local-context",
  "full-agentic-context",
  "remote-safe",
  /**
   * Production hybrid retrieval with RRF merger and heuristic reranker.
   * Requires Postgres with pgvector. Run docker-compose up before first use.
   */
  "hybrid-rag",
  "hybrid-all"
] as const;

/** Built-in profile name literal. */
export type BuiltInProfileName = (typeof BUILT_IN_PROFILE_NAMES)[number];

/** Recursive partial type used for profile config overlays. */
export type DeepPartial<T> = {
  readonly [K in keyof T]?: T[K] extends readonly (infer U)[]
    ? readonly U[]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

/** Built-in capability profile definition. */
export type CapabilityProfile = {
  readonly name: BuiltInProfileName;
  readonly label: string;
  readonly description: string;
  readonly capabilitySurface: readonly string[];
  readonly config: DeepPartial<AgenticInfraProjectConfig>;
};

/** Resolves profile names and user config into complete project config. */
export interface ProfileResolver {
  /** Resolves and validates profile overlays for a project config. */
  resolve(config: AgenticInfraProjectConfig): FrameworkResult<ResolvedProjectConfig>;
}
