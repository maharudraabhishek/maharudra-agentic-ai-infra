/**
 * Command execution is intentionally an allowlist, not a shell.
 *
 * The MCP client can choose only a known package and a known script. The command
 * runner builds all process arguments itself after this validation succeeds.
 */
export const ALLOWED_PNPM_PACKAGES = new Set(["rudraloka-dev-mcp"]);

export const ALLOWED_PNPM_SCRIPTS = new Set([
  "typecheck",
  "build",
  "lint",
  "test"
]);

export function assertAllowedPnpmScript(params: {
  packageName: string;
  script: string;
}): void {
  const { packageName, script } = params;

  if (!ALLOWED_PNPM_PACKAGES.has(packageName)) {
    throw new Error(`Access denied: package "${packageName}" is not allowlisted.`);
  }

  if (!ALLOWED_PNPM_SCRIPTS.has(script)) {
    throw new Error(`Access denied: script "${script}" is not allowlisted.`);
  }
}
