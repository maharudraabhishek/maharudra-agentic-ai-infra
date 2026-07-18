/**
 * Built-in profiles accepted by the generator CLI.
 */
export const CLI_PROFILE_NAMES = [
  "minimal",
  "secure-readonly",
  "controlled-write",
  "vectorless-local",
  "local-context",
  "full-agentic-context",
  "remote-safe",
  /** Production hybrid retrieval: RRF + heuristic reranker. Requires Postgres with pgvector. */
  "hybrid-rag",
  "hybrid-all"
] as const;

/**
 * Runtime modes accepted by the generator CLI.
 */
export const CLI_RUNTIME_MODES = [
  "local-stdio-mcp",
  "remote-http-mcp",
  "api-service"
] as const;

/**
 * Retrieval provider types accepted by the generator CLI.
 */
export const CLI_RETRIEVAL_PROVIDER_TYPES = [
  "full-text",
  "pgvector",
  "document-tree",
  "page-index",
  "symbol-code",
  "graph",
  "hybrid"
] as const;

/** Built-in profile name accepted by CLI flags and generated config. */
export type BuiltInProfileName = (typeof CLI_PROFILE_NAMES)[number];

/** Runtime mode accepted by CLI flags and generated runtime config. */
export type RuntimeMode = (typeof CLI_RUNTIME_MODES)[number];

/** Retrieval strategy accepted by CLI flags and generated retrieval config. */
export type RetrievalProviderType = (typeof CLI_RETRIEVAL_PROVIDER_TYPES)[number];

/** Agent execution style selected by the generated project. */
export type AgentRuntimeMode =
  | "single-agent"
  | "token-efficient-multi-agent";

/** Top-level CLI command names. */
export type CliCommand = "init" | "validate" | "doctor" | "help";

/** Package manager supported by generated commands and docs. */
export type PackageManager = "pnpm";

/**
 * Raw CLI options after argument parsing and before normalization.
 */
export type InitOptions = {
  readonly command?: CliCommand;
  readonly projectName?: string;
  readonly slug?: string;
  readonly profile?: BuiltInProfileName;
  readonly agentMode?: AgentRuntimeMode;
  readonly runtime?: readonly (RuntimeMode | "all")[];
  readonly retrieval?: readonly (RetrievalProviderType | "hybrid-all")[];
  readonly target?: string;
  readonly dashboard?: boolean;
  readonly dashboardPort?: number;
  readonly withDocker?: boolean;
  readonly dockerPort?: number;
  readonly dryRun?: boolean;
  readonly force?: boolean;
  readonly packageManager?: PackageManager;
};

/**
 * Fully normalized generator options used by config, templates, planner, and
 * doctor code.
 */
export type NormalizedInitOptions = {
  readonly projectName: string;
  readonly slug: string;
  readonly profile: BuiltInProfileName;
  readonly agentMode: AgentRuntimeMode;
  readonly runtimeModes: readonly RuntimeMode[];
  readonly retrievalStrategies: readonly RetrievalProviderType[];
  readonly target: string;
  readonly dashboard: boolean;
  readonly dashboardPort: number;
  readonly withDocker: boolean;
  readonly dockerPort: number;
  readonly dryRun: boolean;
  readonly force: boolean;
  readonly packageManager: PackageManager;
};

/** Severity used by CLI validation and planning issues. */
export type CliIssueSeverity = "info" | "warning" | "error";

/**
 * One typed CLI issue surfaced to users and tests.
 */
export type CliIssue = {
  readonly severity: CliIssueSeverity;
  readonly code: string;
  readonly message: string;
  readonly suggestion?: string;
};

/**
 * Success or failure wrapper used by CLI helpers.
 */
export type CliResult<T> =
  | {
      readonly ok: true;
      readonly value: T;
      readonly issues?: readonly CliIssue[];
    }
  | {
      readonly ok: false;
      readonly issues: readonly CliIssue[];
    };

/**
 * String replacement context used by static templates.
 */
export type TemplateContext = {
  readonly PROJECT_NAME: string;
  readonly PROJECT_SLUG: string;
  readonly PROJECT_ROOT_ENV: string;
  readonly PACKAGE_MANAGER: string;
  readonly PROFILE: string;
  readonly AGENT_MODE: string;
  readonly RUNTIME_MODES: string;
  readonly RETRIEVAL_STRATEGY: string;
  readonly DASHBOARD_PORT: string;
  readonly DOCKER_PORT: string;
  readonly DB_NAME: string;
  readonly DB_USER: string;
  readonly MCP_PACKAGE_NAME: string;
};

/**
 * One source template file before rendering.
 */
export type TemplateFile = {
  readonly relativePath: string;
  readonly content: string;
};

/**
 * A named group of template files selected together.
 */
export type TemplateManifest = {
  readonly name: string;
  readonly description: string;
  readonly files: readonly TemplateFile[];
};

/**
 * One generated file after placeholder replacement.
 */
export type RenderedFile = {
  readonly relativePath: string;
  readonly content: string;
};

/**
 * Planner action assigned to a rendered file.
 */
export type WriteAction =
  | "create"
  | "append"
  | "unchanged"
  | "conflict"
  | "overwrite"
  | "blocked";

/**
 * One write-plan decision with target path, content, and explanation.
 */
export type WritePlanItem = {
  readonly action: WriteAction;
  readonly relativePath: string;
  readonly targetPath: string;
  readonly content: string;
  readonly reason: string;
  readonly newFilePath?: string;
};

/**
 * Complete write plan produced before any filesystem mutation.
 */
export type WritePlan = {
  readonly targetRoot: string;
  readonly dryRun: boolean;
  readonly force: boolean;
  readonly items: readonly WritePlanItem[];
};

/**
 * Count summary for write-plan actions.
 */
export type WriteSummary = {
  readonly created: number;
  readonly appended: number;
  readonly overwritten: number;
  readonly unchanged: number;
  readonly conflicts: number;
  readonly blocked: number;
};

/**
 * One doctor readiness check.
 */
export type DoctorCheck = {
  readonly name: string;
  readonly status: "ok" | "warning" | "error";
  readonly message: string;
  readonly suggestion?: string;
};

/**
 * Complete doctor report.
 */
export type DoctorReport = {
  readonly checks: readonly DoctorCheck[];
};
