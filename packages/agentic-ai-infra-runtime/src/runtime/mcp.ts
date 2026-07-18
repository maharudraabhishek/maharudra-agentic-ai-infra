import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  RuntimeMode,
  SafeTaskMetadata,
  ToolContract,
  ToolExecutionResult
} from "@maharudra/agentic-ai-infra-core";

/**
 * Creates an MCP SDK server and registers framework tool metadata.
 *
 * This bridge deliberately does not connect a STDIO or HTTP transport. Runtime
 * adapters call it only after policy checks, and generated entrypoints decide
 * when a transport should be attached.
 */
export function createMcpServerForTools(params: {
  readonly name: string;
  readonly version: string;
  readonly tools: readonly ToolContract[];
  readonly runtimeMode?: RuntimeMode;
  readonly executeTool?: (input: {
    readonly toolId: string;
    readonly input?: unknown;
    readonly runtimeMode: RuntimeMode;
    readonly task?: SafeTaskMetadata;
  }) => Promise<{ readonly ok: true; readonly value: ToolExecutionResult } | { readonly ok: false; readonly error: { readonly message: string } }>;
}): McpServer {
  const server = new McpServer({
    name: params.name,
    version: params.version
  });

  for (const tool of params.tools) {
    // Register a safe metadata-only handler. Concrete runtime tool handlers can
    // replace or extend this behavior later through the service container.
    server.registerTool(
      tool.id,
      {
        title: tool.name,
        description: tool.description
      },
      async (input) => {
        if (params.executeTool && params.runtimeMode) {
          const result = await params.executeTool({
            toolId: tool.id,
            input,
            runtimeMode: params.runtimeMode
          });

          return {
            content: [
              {
                type: "text",
                text: result.ok
                  ? JSON.stringify(result.value.output)
                  : result.error.message
              }
            ]
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `${tool.name} is registered. Runtime-specific handlers attach through the service container.`
            }
          ]
        };
      }
    );
  }

  return server;
}
