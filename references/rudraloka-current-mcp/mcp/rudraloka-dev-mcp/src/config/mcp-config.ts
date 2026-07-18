import path from "node:path";

/**
 * Keep server identity in one place so the STDIO entrypoint stays thin and the
 * tool metadata can be audited without importing server bootstrap code.
 */
export const MCP_SERVER_NAME = "rudraloka-dev-mcp";
export const MCP_SERVER_VERSION = "0.1.0";

/**
 * PROJECT_ROOT is the only project tree exposed through this MCP server.
 *
 * The value is resolved once at startup so every path check compares against a
 * canonical absolute root. This is the first line of defense against path
 * traversal and accidental access to files outside the trusted workspace.
 */
export const PROJECT_ROOT = path.resolve(
  process.env.RUDRALOKA_PROJECT_ROOT ?? process.cwd()
);

/**
 * Read and write limits keep MCP responses predictable and prevent an AI client
 * from flooding its own context window with huge files or command logs.
 */
export const MAX_READ_BYTES = 200_000;
export const MAX_COMMAND_OUTPUT_CHARS = 100_000;
export const COMMAND_TIMEOUT_MS = 120_000;
export const MAX_PATCH_TEXT_CHARS = 50_000;
export const MAX_PATCH_RESULT_BYTES = 300_000;
export const MAX_NEW_FILE_CONTENT_CHARS = 50_000;
export const MAX_LOG_SUMMARY_LIMIT = 100;

/**
 * Knowledge preview limits keep Milestone 2 local, bounded, and cheap.
 *
 * The scanner and chunk preview tools intentionally avoid huge reads, huge
 * responses, and accidental context flooding. Later indexing phases can tune
 * these values after evals prove the pipeline is safe.
 */
export const MAX_KNOWLEDGE_SCAN_FILES = 500;
export const MAX_KNOWLEDGE_FILE_BYTES = 120_000;
export const MAX_KNOWLEDGE_CHUNKS_PER_FILE = 80;
export const MAX_CHUNK_PREVIEW_CHARS = 600;
export const DEFAULT_FALLBACK_CHUNK_CHARS = 3_000;
export const DEFAULT_FALLBACK_CHUNK_OVERLAP_CHARS = 300;
export const MAX_PROJECT_KNOWLEDGE_QUERY_CHARS = 500;
export const MAX_PROJECT_KNOWLEDGE_CONTEXT_TASK_CHARS = 1_500;
export const DEFAULT_PROJECT_KNOWLEDGE_SEARCH_TOP_K = 8;
export const MAX_PROJECT_KNOWLEDGE_SEARCH_TOP_K = 20;
export const DEFAULT_PROJECT_CONTEXT_CHUNKS = 8;
export const MAX_PROJECT_CONTEXT_CHUNKS = 12;
export const DEFAULT_PROJECT_CONTEXT_CHARS = 12_000;
export const MAX_PROJECT_CONTEXT_CHARS = 24_000;
export const MAX_PROJECT_KNOWLEDGE_PATH_FILTERS = 10;
export const MAX_PROJECT_KNOWLEDGE_RESULT_PREVIEW_CHARS = 700;
export const MAX_PROJECT_CONTEXT_EXCERPT_CHARS = 900;
export const MAX_PROJECT_CONTEXT_PLANNER_TASK_CHARS =
  MAX_PROJECT_KNOWLEDGE_CONTEXT_TASK_CHARS;
export const MAX_PROJECT_CONTEXT_PLANNER_RECOMMENDED_QUERIES = 5;
export const MAX_PROJECT_CONTEXT_PLANNER_RECOMMENDED_SOURCES = 10;
export const MAX_PROJECT_CONTEXT_PLANNER_RECOMMENDED_TOOLS = 8;
export const MAX_PROJECT_CONTEXT_PLANNER_WARNINGS = 10;
export const MAX_PROJECT_CONTEXT_PLANNER_NEXT_STEPS = 8;

/**
 * Local state is deliberately stored under a blocked project directory.
 *
 * Normal read/list tools must never expose proposal internals or logs. Dedicated
 * observability tools return sanitized summaries instead.
 */
export const INTERNAL_STATE_DIR = path.join(PROJECT_ROOT, ".mcp-local");
export const PATCH_PROPOSAL_DIR = path.join(INTERNAL_STATE_DIR, "patches");
export const NEW_FILE_PROPOSAL_DIR = path.join(INTERNAL_STATE_DIR, "new-files");
export const AUDIT_LOG_DIR = path.join(INTERNAL_STATE_DIR, "audit");
export const APP_LOG_DIR = path.join(INTERNAL_STATE_DIR, "logs");
export const APP_LOG_FILE = path.join(APP_LOG_DIR, "app.jsonl");

// Local MCP logs are append-only so they remain useful for debugging and
// audits, but they must stay bounded. Rotation prevents runaway local files
// while keeping stdout reserved for the STDIO protocol.
export const MAX_LOG_FILE_BYTES = 1_000_000;

/**
 * Blocked directories are hidden from both listing and reading.
 *
 * .mcp-local is included because it contains internal proposals and logs that
 * should only be exposed through purpose-built summary tools.
 */
export const BLOCKED_DIRS = new Set([
  ".git",
  ".mcp-local",
  "node_modules",
  ".pnpm-store",
  ".next",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".vercel",
  ".cache"
]);

/**
 * Sensitive filenames are denied even if their extension would otherwise be
 * readable. Environment files and private key material are common places for
 * secrets, so the server fails closed before reading any bytes.
 */
export const BLOCKED_FILE_NAMES = new Set([
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".npmrc",
  "id_rsa",
  "id_ed25519",
  "id_ecdsa",
  "id_dsa",
  "known_hosts"
]);

/**
 * The read surface is intentionally narrow and text-only. New extensions should
 * be added deliberately after reviewing whether they can contain binary data or
 * secrets.
 */
export const ALLOWED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".css",
  ".scss",
  ".html",
  ".sql",
  ".yml",
  ".yaml",
  ".prisma"
]);

export type WritablePathRule = {
  name: string;
  prefix: string;
  extensions: ReadonlySet<string>;
};

/**
 * Write access is much stricter than read access. The MCP server can only edit
 * its own TypeScript source and project documentation unless this allowlist is
 * deliberately expanded.
 */
export const WRITABLE_PATH_RULES: WritablePathRule[] = [
  {
    name: "MCP server TypeScript source",
    prefix: "mcp/rudraloka-dev-mcp/src/",
    extensions: new Set([".ts"])
  },
  {
    name: "Project documentation",
    prefix: "docs/",
    extensions: new Set([".md"])
  },
  {
    name: "Local AI DB migrations",
    prefix: "infra/db/local-ai/migrations/",
    extensions: new Set([".sql"])
  }
];

/**
 * Root files are listed separately so a broad root-level write pattern never
 * accidentally appears in the policy.
 */
export const WRITABLE_ROOT_FILES = new Set(["AGENTS.md"]);
