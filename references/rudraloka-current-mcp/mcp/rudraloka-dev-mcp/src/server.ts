import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION
} from "./config/mcp-config.js";
import { registerCommandTools } from "./tools/register-command-tools.js";
import { registerDbTools } from "./tools/register-db-tools.js";
import { registerEvalTools } from "./tools/register-eval-tools.js";
import { registerKnowledgeTools } from "./tools/register-knowledge-tools.js";
import { registerNewFileTools } from "./tools/register-new-file-tools.js";
import { registerObservabilityTools } from "./tools/register-observability-tools.js";
import { registerPatchTools } from "./tools/register-patch-tools.js";
import { registerReadTools } from "./tools/register-read-tools.js";

/**
 * The entrypoint stays deliberately thin.
 *
 * Security policy, command execution, file access, writes, and observability
 * live in separate modules so they can be reviewed independently.
 */
const server = new McpServer({
  name: MCP_SERVER_NAME,
  version: MCP_SERVER_VERSION
});

registerReadTools(server);
registerCommandTools(server);
registerDbTools(server);
registerPatchTools(server);
registerNewFileTools(server);
registerObservabilityTools(server);
registerEvalTools(server);
registerKnowledgeTools(server);

/**
 * STDIO is the right default for a local development MCP server: no public port
 * is opened, and the MCP client owns process startup.
 */
async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/**
 * Startup failures are fatal. A partially initialized MCP server should not
 * remain running with an unclear policy state.
 */
main().catch((error) => {
  console.error("Fatal MCP server error:", error);
  process.exit(1);
});
