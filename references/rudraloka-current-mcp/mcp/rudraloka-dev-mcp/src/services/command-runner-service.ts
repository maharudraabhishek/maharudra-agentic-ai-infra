import { spawn } from "node:child_process";
import {
  COMMAND_TIMEOUT_MS,
  MAX_COMMAND_OUTPUT_CHARS,
  PROJECT_ROOT
} from "../config/mcp-config.js";
import { assertAllowedPnpmScript } from "../security/command-policy.js";

export function appendWithLimit(
  current: string,
  chunk: Buffer,
  maxChars: number
): string {
  if (current.length >= maxChars) {
    return current;
  }

  const text = chunk.toString("utf8");
  const remainingChars = maxChars - current.length;

  if (text.length <= remainingChars) {
    return current + text;
  }

  return `${current}${text.slice(0, remainingChars)}\n[output truncated]\n`;
}

/**
 * Run a strictly allowlisted pnpm script.
 *
 * The only user-controlled values are packageName and script, and both are
 * checked against allowlists before process arguments are generated. This is not
 * a generic command runner.
 */
export async function runAllowedPnpmScript(params: {
  packageName: string;
  script: string;
}): Promise<{
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}> {
  const { packageName, script } = params;

  assertAllowedPnpmScript({ packageName, script });

  const pnpmArgs = ["--filter", packageName, "run", script];

  /**
   * Windows commonly exposes pnpm through a .cmd shim. Spawning cmd.exe with
   * generated, allowlisted arguments avoids the PowerShell execution-policy
   * issue without exposing arbitrary shell input.
   */
  const command = process.platform === "win32" ? "cmd.exe" : "pnpm";
  const commandArgs =
    process.platform === "win32"
      ? ["/d", "/s", "/c", "pnpm", ...pnpmArgs]
      : pnpmArgs;

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const child = spawn(command, commandArgs, {
      cwd: PROJECT_ROOT,
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        CI: "true",
        FORCE_COLOR: "0"
      }
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, COMMAND_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendWithLimit(stdout, chunk, MAX_COMMAND_OUTPUT_CHARS);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendWithLimit(stderr, chunk, MAX_COMMAND_OUTPUT_CHARS);
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`Failed to start pnpm command: ${error.message}`));
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);

      resolve({
        command: `pnpm ${pnpmArgs.join(" ")}`,
        exitCode,
        timedOut,
        stdout,
        stderr
      });
    });
  });
}
