import type { RemoteSafeToolFilter } from "./types.js";
import type { ToolCategory, ToolContract } from "../tools/types.js";

const REMOTE_UNSAFE_CATEGORIES: ReadonlySet<ToolCategory> = new Set([
  "write",
  "command",
  "admin"
]);

/**
 * Determines whether a tool contract can be exposed through a remote-safe
 * runtime surface.
 */
export function isRemoteSafeTool(tool: ToolContract): boolean {
  // Category is the broadest risk gate: write, command, and admin tools are
  // excluded even when their individual policies are incomplete.
  if (REMOTE_UNSAFE_CATEGORIES.has(tool.category)) {
    return false;
  }

  // High-risk tools need a stronger review surface than remote-safe MCP/API.
  if (tool.riskLevel === "high" || tool.riskLevel === "critical") {
    return false;
  }

  // Remote tools cannot reach local filesystem or shell capabilities.
  if (
    tool.runtimePolicy.localFilesystem ||
    tool.runtimePolicy.shellAccess ||
    tool.runtimePolicy.migrationAccess ||
    tool.runtimePolicy.arbitrarySqlAccess
  ) {
    return false;
  }

  // Raw files and vectors can leak sensitive or oversized data, so remote tools
  // must return bounded summaries/metadata instead.
  if (
    tool.outputPolicy.returnsRawFiles ||
    tool.outputPolicy.returnsVectors ||
    tool.outputPolicy.returnsRawSql ||
    tool.outputPolicy.returnsStackTraces ||
    tool.outputPolicy.returnsCommandOutput ||
    tool.outputPolicy.returnsLocalPaths
  ) {
    return false;
  }

  return tool.runtimePolicy.remoteSafe === true && tool.outputPolicy.remoteSafe;
}

/**
 * Default implementation of the remote-safe tool filter.
 */
export class DefaultRemoteSafeToolFilter implements RemoteSafeToolFilter {
  /**
   * Checks one tool with the shared remote-safe predicate.
   */
  isRemoteSafe(tool: ToolContract): boolean {
    return isRemoteSafeTool(tool);
  }

  /**
   * Filters a tool list down to contracts that can cross the remote boundary.
   */
  filter(tools: readonly ToolContract[]): readonly ToolContract[] {
    return tools.filter((tool) => this.isRemoteSafe(tool));
  }
}
