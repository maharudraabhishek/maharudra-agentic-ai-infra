import type {
  AgentRuntimeMode,
  BuiltInProfileName,
  CliCommand,
  InitOptions,
  RetrievalProviderType,
  RuntimeMode
} from "./types.js";

type ParsedArgs = {
  readonly command: CliCommand;
  readonly options: InitOptions;
  readonly help: boolean;
};

/**
 * Reads a CLI flag value from either `--flag=value`, `--flag value`, or a
 * bare boolean flag such as `--dry-run`.
 *
 * The returned `consumed` count tells the main parser whether the following
 * argument was used as the value so it can skip that token safely.
 */
function readFlagValue(args: readonly string[], index: number): {
  readonly value: string | true;
  readonly consumed: number;
} {
  const current = args[index] ?? "";
  const equalsIndex = current.indexOf("=");

  // Inline assignment keeps `--flag=value` atomic and avoids reading the next
  // positional token as a value by accident.
  if (equalsIndex >= 0) {
    return { value: current.slice(equalsIndex + 1), consumed: 0 };
  }

  const next = args[index + 1];

  // A following non-flag token belongs to this flag. Another `--flag` starts a
  // new flag, so the current one is treated as boolean true.
  if (next && !next.startsWith("--")) {
    return { value: next, consumed: 1 };
  }

  return { value: true, consumed: 0 };
}

/**
 * Splits comma-delimited CLI values into a trimmed list.
 *
 * Boolean flags return an empty list because list-style flags require an
 * explicit value such as `--runtime local-stdio-mcp,api-service`.
 */
function splitList(value: string | true): readonly string[] {
  if (value === true) {
    return [];
  }

  // Empty items are discarded so accidental trailing commas do not create
  // unsupported strategy or runtime names.
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Parses permissive CLI boolean values.
 *
 * The parser treats a bare flag as true and accepts common negative spellings
 * for false so generated project commands remain easy to type by hand.
 */
function parseBoolean(value: string | true): boolean {
  if (value === true) {
    return true;
  }

  return !["false", "0", "no", "off"].includes(value.toLowerCase());
}

/**
 * Parses integer CLI values and returns `undefined` when the value is missing
 * or invalid.
 *
 * Normalization decides the default port later so the parser stays focused on
 * turning raw tokens into optional typed values.
 */
function parseNumber(value: string | true): number | undefined {
  if (value === true) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Converts raw command-line tokens into a typed command and option object.
 *
 * Example:
 *
 * ```ts
 * parseCliArgs(["init", "--profile", "remote-safe", "--dry-run"]);
 * ```
 */
export function parseCliArgs(args: readonly string[]): ParsedArgs {
  // Some package runners insert `--` before user flags. Removing one leading
  // separator keeps direct CLI use and package-runner use equivalent.
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const [maybeCommand, ...rest] = normalizedArgs;
  const isCommand =
    maybeCommand === "init" ||
    maybeCommand === "validate" ||
    maybeCommand === "doctor";
  const command: CliCommand = isCommand ? maybeCommand : "help";
  const flagArgs = isCommand ? rest : normalizedArgs;
  const options: { -readonly [K in keyof InitOptions]?: InitOptions[K] } = {
    command
  };
  let help = command === "help";

  for (let index = 0; index < flagArgs.length; index += 1) {
    const arg = flagArgs[index] ?? "";

    // Help is honored for every command so users can discover options without
    // triggering normalization, validation, or writes.
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }

    // Unknown positional tokens are ignored here and can be surfaced later by
    // validation once strict positional behavior is needed.
    if (!arg.startsWith("--")) {
      continue;
    }

    const flagName = arg.slice(2).split("=")[0];
    const { value, consumed } = readFlagValue(flagArgs, index);
    index += consumed;

    switch (flagName) {
      case "project-name":
        options.projectName = value === true ? undefined : value;
        break;
      case "slug":
        options.slug = value === true ? undefined : value;
        break;
      case "profile":
        options.profile = value as BuiltInProfileName;
        break;
      case "agent-mode":
        options.agentMode = value as AgentRuntimeMode;
        break;
      case "runtime":
        options.runtime = splitList(value) as readonly (RuntimeMode | "all")[];
        break;
      case "retrieval":
        options.retrieval = splitList(value) as readonly (RetrievalProviderType | "hybrid-all")[];
        break;
      case "target":
        options.target = value === true ? undefined : value;
        break;
      case "dashboard":
        options.dashboard = parseBoolean(value);
        break;
      case "dashboard-port":
        options.dashboardPort = parseNumber(value);
        break;
      case "with-docker":
        options.withDocker = parseBoolean(value);
        break;
      case "docker-port":
        options.dockerPort = parseNumber(value);
        break;
      case "dry-run":
        options.dryRun = parseBoolean(value);
        break;
      case "force":
        options.force = parseBoolean(value);
        break;
      default:
        break;
    }
  }

  return {
    command,
    options: options as InitOptions,
    help
  };
}

/**
 * Builds the CLI help text shown for `--help` and the default help command.
 *
 * Help text is kept close to the parser so new flags can be documented at the
 * same time they are introduced.
 */
export function createHelpText(): string {
  return `create-agentic-ai-infra

Usage:
  create-agentic-ai-infra init [options]
  create-agentic-ai-infra validate [options]
  create-agentic-ai-infra doctor [options]

Options:
  --project-name <name>       Project display name
  --slug <slug>               Project slug
  --profile <name>            minimal, secure-readonly, controlled-write, local-context, full-agentic-context, remote-safe, hybrid-all
  --agent-mode <mode>         single-agent or token-efficient-multi-agent
  --runtime <modes>           local-stdio-mcp, remote-http-mcp, api-service, or all
  --retrieval <strategies>    full-text, pgvector, document-tree, page-index, symbol-code, graph, hybrid, or hybrid-all
  --target <path>             Current directory or a child directory
  --dashboard                 Enable generated dashboard config
  --dashboard-port <port>     Dashboard port
  --with-docker               Generate local Docker files without starting Docker
  --docker-port <port>        Local database port in generated Docker files
  --dry-run                   Print write plan without writing
  --force                     Overwrite non-sensitive conflicting files
  --help                      Show this help text
`;
}
