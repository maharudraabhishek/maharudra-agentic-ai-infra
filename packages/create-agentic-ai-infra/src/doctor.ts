import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import type { DoctorCheck, DoctorReport, NormalizedInitOptions } from "./types.js";
import { resolveTargetRoot } from "./validation.js";

/**
 * Checks whether a local command can run without capturing or printing output.
 *
 * Doctor uses this for prerequisite checks only. It suppresses command output
 * so command banners, paths, or environment details do not leak into reports.
 */
function checkCommand(command: string, args: readonly string[]): boolean {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "ignore",
    shell: false
  });

  if (result.status === 0) {
    return true;
  }

  if (process.platform === "win32" && command.endsWith(".cmd")) {
    // Windows package-manager shims such as pnpm.cmd can fail with EINVAL when
    // spawned directly from Node with shell:false, even though the same command
    // works from an ordinary terminal. Keep the direct spawn as the first path
    // for real executables, then use cmd.exe only for .cmd wrappers so doctor
    // does not report false negatives while still limiting shell interpretation.
    const fallback = spawnSync("cmd.exe", ["/d", "/s", "/c", command, ...args], {
      encoding: "utf8",
      stdio: "ignore",
      shell: false
    });

    return fallback.status === 0;
  }

  return false;
}

/**
 * Extracts the Node.js major version from `process.versions.node`.
 *
 * The doctor only needs the major version because the project support boundary
 * is expressed as Node.js 20 or newer.
 */
function compareNodeMajor(version: string): number {
  return Number.parseInt(version.split(".")[0] ?? "0", 10);
}

/**
 * Returns true when a path exists.
 *
 * The function intentionally hides the difference between files and folders
 * because doctor only needs presence checks for generated config and Docker
 * files.
 */
async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks whether a local TCP port can be bound on loopback.
 *
 * Binding to `127.0.0.1` mirrors generated local service defaults and avoids
 * probing public interfaces during a readiness check.
 */
async function isPortAvailable(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

/**
 * Runs non-mutating environment checks for generated project readiness.
 *
 * Doctor checks local tools, selected Docker expectations, ports, and generated
 * config presence. It never starts Docker, creates files, runs migrations, or
 * changes project state.
 */
export async function runDoctor(
  options: NormalizedInitOptions,
  cwd = process.cwd()
): Promise<DoctorReport> {
  const targetRoot = resolveTargetRoot(options.target, cwd);
  const checks: DoctorCheck[] = [];
  const nodeMajor = compareNodeMajor(process.versions.node);

  checks.push(
    nodeMajor >= 20
      ? {
          name: "Node.js",
          status: "ok",
          message: `Node.js ${process.versions.node} is available.`
        }
      : {
          name: "Node.js",
          status: "error",
          message: `Node.js ${process.versions.node} is below the supported version.`,
          suggestion: "Use Node.js 20 or newer."
        }
  );

  const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  checks.push(
    checkCommand(pnpmCommand, ["--version"])
      ? {
          name: "pnpm",
          status: "ok",
          message: "pnpm is available."
        }
      : {
          name: "pnpm",
          status: "error",
          message: "pnpm was not found.",
          suggestion: "Install pnpm before using generated project commands."
        }
  );

  const dockerFilesSelected =
    options.withDocker ||
    (await pathExists(path.join(targetRoot, "infra/local-dev/ai-context-db/docker-compose.yml")));
  const dockerAvailable = checkCommand("docker", ["--version"]);

  // Docker is optional unless the user selected or already has generated local
  // database files. The CLI never starts Docker because the user must control
  // local containers and volumes explicitly.
  checks.push(
    dockerAvailable
      ? {
          name: "Docker",
          status: "ok",
          message: "Docker CLI is available."
        }
      : {
          name: "Docker",
          status: dockerFilesSelected ? "error" : "warning",
          message: "Docker CLI was not found.",
          suggestion: dockerFilesSelected
            ? "Install Docker before using generated local database files."
            : "Docker is only needed when local Docker files are selected."
        }
  );

  for (const [name, port] of [
    ["Dashboard port", options.dashboardPort],
    ["Docker database port", options.dockerPort]
  ] as const) {
    const available = await isPortAvailable(port);

    // Port checks are warnings because another process using the port does not
    // make generation unsafe; it only affects later user-started services.
    checks.push(
      available
        ? {
            name,
            status: "ok",
            message: `Port ${port} is available.`
          }
        : {
            name,
            status: "warning",
            message: `Port ${port} appears to be in use.`,
            suggestion: "Choose another port with --dashboard-port or --docker-port."
          }
    );
  }

  const configPath = path.join(targetRoot, "agentic-ai-infra.config.ts");

  checks.push(
    (await pathExists(configPath))
      ? {
          name: "Generated config",
          status: "ok",
          message: "agentic-ai-infra.config.ts is present."
        }
      : {
          name: "Generated config",
          status: "warning",
          message: "agentic-ai-infra.config.ts is not present.",
          suggestion: "Run init to generate the project config."
        }
  );

  return { checks };
}

/**
 * Formats doctor checks into stable CLI output.
 *
 * Each line includes status, check name, message, and optional suggestion so
 * users can act on warnings without reading debug logs.
 */
export function formatDoctorReport(report: DoctorReport): string {
  return report.checks
    .map((check) => {
      const suggestion = check.suggestion ? ` Suggestion: ${check.suggestion}` : "";
      return `${check.status.toUpperCase().padEnd(7)} ${check.name}: ${check.message}${suggestion}`;
    })
    .join("\n");
}
