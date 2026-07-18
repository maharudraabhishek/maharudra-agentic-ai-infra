import fs from "node:fs/promises";
import path from "node:path";

// Re-export MockLlmProvider so test suites can import it without depending on
// the runtime package directly. The implementation lives in runtime to avoid
// circular dependencies; test-utils re-exports it as a convenience.
export { MockLlmProvider } from "@maharudra/agentic-ai-infra-runtime";

// ---------------------------------------------------------------------------
// Mock merger and reranker for integration tests and generated project smoke
// ---------------------------------------------------------------------------

/** Minimal type alias so test-utils does not depend on the runtime package. */
type RetrievalResultLike = { readonly sourceId: string; readonly preview: string; readonly score: number; readonly providerId: string };

/**
 * MockRetrievalMerger concatenates all provider result lists and deduplicates
 * by `sourceId + preview`, preserving the first-occurrence order.
 *
 * This is the simplest valid merger — useful for integration tests that want
 * deterministic, ordered output without the score-combining behaviour of RRF.
 *
 * @example
 * ```typescript
 * const merger = new MockRetrievalMerger();
 * const merged = merger.merge([listA, listB]);
 * // merged = deduped concat of listA and listB, in input order
 * ```
 */
export class MockRetrievalMerger {
  /**
   * Concatenates provider result lists and deduplicates by `sourceId:preview`.
   * First occurrence of each key wins; duplicates from later lists are dropped.
   */
  merge<T extends RetrievalResultLike>(providerResults: ReadonlyArray<T[]>): T[] {
    const seen = new Set<string>();
    const out: T[] = [];

    for (const list of providerResults) {
      for (const result of list) {
        const key = `${result.sourceId}:${result.preview.slice(0, 100)}`;

        if (!seen.has(key)) {
          seen.add(key);
          out.push(result);
        }
      }
    }

    return out;
  }
}

/**
 * MockReranker returns results in reverse input order.
 *
 * Reversing is non-trivial (not a no-op), deterministic, and easy to assert in
 * tests — making it a useful sentinel for verifying that the reranker is actually
 * called and that its output is used downstream.
 *
 * @example
 * ```typescript
 * const reranker = new MockReranker();
 * const out = reranker.rerank([a, b, c], "query");
 * // out = [c, b, a]
 * ```
 */
export class MockReranker {
  /**
   * Returns a new array with results in reverse input order.
   *
   * Does not mutate the input array.
   */
  rerank<T extends RetrievalResultLike>(results: T[], _query: string): T[] {
    return [...results].reverse();
  }
}

const SKIPPED_SCAN_DIRECTORIES = new Set([
  ".git",
  ".agentic-local",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".cache"
]);

const SECRET_FILE_PATTERN = /(^|\/)(?:\.env(?:\.|$)|\.npmrc$|id_(?:rsa|dsa|ecdsa|ed25519)$|.*private.*key.*|credentials?(?:\.|$))/i;
const PLACEHOLDER_PATTERN = /\{\{[A-Z0-9_]+\}\}/;
const FORBIDDEN_CONTENT_PATTERN = /\b(?:Kubernetes|kubectl|helm|npm publish|yarn |bun |npx |production-deployed out of the box|Docker starts automatically|migrations run automatically)\b/i;

/** Paths that every generated project should contain after a normal init run. */
export const REQUIRED_GENERATED_PROJECT_PATHS = [
  ".gitignore",
  ".agents/skills/agentic-project-workflow/SKILL.md",
  "AGENTS.md",
  "CLAUDE.md",
  "CUSTOMIZE_WITH_CODEX.md",
  "agentic-ai-infra.config.ts",
  "docs/03-agentic-infra/README.md",
  "docs/03-agentic-infra/context-strategy.md",
  "docs/03-agentic-infra/local-mcp-runtime.md",
  "docs/03-agentic-infra/token-efficient-agent-mode.md",
  "infra/db/ai-context/migrations/README.md",
  "tools/agentic/mcp-server/package.json",
  "tools/agentic/mcp-server/src/server.ts",
  "tools/agentic/mcp-server/src/start.ts",
  "tools/agentic/mcp-server/tsconfig.json"
] as const;

/** Result returned by a safe generated-project file scan. */
export type GeneratedProjectScanResult = {
  readonly files: readonly string[];
  readonly forbiddenFiles: readonly string[];
  readonly unresolvedPlaceholders: readonly string[];
  readonly forbiddenContent: readonly string[];
};

/**
 * Normalizes project-relative paths for cross-platform scaffold assertions.
 *
 * Generated project contracts are documented with POSIX-style separators, so
 * tests use the same shape on Windows and Linux.
 */
export function normalizeProjectPath(projectPath: string): string {
  return projectPath.replaceAll("\\", "/");
}

/**
 * Recursively lists project files while skipping dependency, build, VCS, and
 * private local-state folders.
 *
 * The scanner records secret-looking filenames but does not read their
 * contents, which keeps smoke-test diagnostics safe if a pre-seeded workspace
 * accidentally contains local credentials.
 */
export async function collectGeneratedProjectFiles(root: string): Promise<readonly string[]> {
  const files: string[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      const relativePath = normalizeProjectPath(path.relative(root, fullPath));

      if (entry.isDirectory()) {
        if (!SKIPPED_SCAN_DIRECTORIES.has(entry.name)) {
          await visit(fullPath);
        }
        continue;
      }

      if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  }

  await visit(root);
  return files.sort();
}

/**
 * Scans generated project files for template placeholders and forbidden
 * readiness claims without reading secret-looking files.
 */
export async function scanGeneratedProject(root: string): Promise<GeneratedProjectScanResult> {
  const files = await collectGeneratedProjectFiles(root);
  const forbiddenFiles = files.filter((file) => SECRET_FILE_PATTERN.test(file));
  const unresolvedPlaceholders: string[] = [];
  const forbiddenContent: string[] = [];

  for (const file of files) {
    if (SECRET_FILE_PATTERN.test(file)) {
      continue;
    }

    const content = await fs.readFile(path.join(root, file), "utf8");

    if (PLACEHOLDER_PATTERN.test(content)) {
      unresolvedPlaceholders.push(file);
    }

    if (FORBIDDEN_CONTENT_PATTERN.test(content)) {
      forbiddenContent.push(file);
    }
  }

  return {
    files,
    forbiddenFiles,
    unresolvedPlaceholders,
    forbiddenContent
  };
}

/**
 * Returns required generated paths that are absent from a file list.
 */
export function missingRequiredGeneratedPaths(files: readonly string[]): readonly string[] {
  const fileSet = new Set(files.map(normalizeProjectPath));

  return REQUIRED_GENERATED_PROJECT_PATHS.filter((requiredPath) => !fileSet.has(requiredPath));
}
