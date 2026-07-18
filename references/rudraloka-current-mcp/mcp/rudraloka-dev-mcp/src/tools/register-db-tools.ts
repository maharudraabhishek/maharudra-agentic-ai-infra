import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OperationStatus, TraceContext } from "../core/types.js";
import { getRedactedLocalAiDbConfig } from "../db/local-ai-db-config.js";
import { withLocalAiDbClient } from "../db/local-ai-db-client.js";
import {
  assertRunLocalAiMigrationsApprovalText,
  getLocalAiMigrationStatus,
  runLocalAiMigrations
} from "../db/local-ai-migrations.js";
import { writeAuditEvent } from "../observability/audit-logger.js";
import { withToolTelemetry } from "../observability/logger.js";
import { getDurationMs } from "../observability/trace.js";

export const LOCAL_AI_DB_TOOL_NAMES = [
  "check_local_ai_db",
  "get_local_ai_migration_status",
  "run_local_ai_migrations"
] as const;

function textResponse(text: string) {
  return {
    content: [
      {
        type: "text" as const,
        text
      }
    ]
  };
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Local AI DB operation failed safely.";
}

function statusFromError(error: unknown): OperationStatus {
  const message = safeErrorMessage(error);

  return /denied|must exactly equal|checksum mismatch|safety check failed/i.test(
    message
  )
    ? "denied"
    : "error";
}

export function registerDbTools(server: McpServer): void {
  server.registerTool(
    "check_local_ai_db",
    {
      title: "Check local AI DB",
      description:
        "Checks local AI DB connectivity and pgvector availability using fixed health-check queries.",
      inputSchema: z.object({})
    },
    withToolTelemetry(
      "check_local_ai_db",
      "db",
      async () => {
        const config = getRedactedLocalAiDbConfig();

        try {
          const result = await withLocalAiDbClient(async (client) => {
            const identity = await client.query<{
              database: string;
              user_name: string;
            }>("select current_database() as database, current_user as user_name");
            const extension = await client.query<{
              extversion: string;
            }>("select extversion from pg_extension where extname = $1", [
              "vector"
            ]);
            const vectorExtensionVersion =
              extension.rows[0]?.extversion ?? null;

            return {
              status: vectorExtensionVersion ? "ok" : "error",
              database: identity.rows[0]?.database ?? config.database,
              user: identity.rows[0]?.user_name ?? config.user,
              host: config.host,
              port: config.port,
              pgvectorEnabled: Boolean(vectorExtensionVersion),
              vectorExtensionVersion,
              message: vectorExtensionVersion
                ? "Local AI DB is reachable and pgvector is enabled."
                : "Local AI DB is reachable, but pgvector is not enabled."
            };
          });

          return textResponse(JSON.stringify(result, null, 2));
        } catch (error) {
          return textResponse(
            JSON.stringify(
              {
                status: "error",
                database: config.database,
                user: config.user,
                host: config.host,
                port: config.port,
                pgvectorEnabled: false,
                vectorExtensionVersion: null,
                message: safeErrorMessage(error)
              },
              null,
              2
            )
          );
        }
      }
    )
  );

  server.registerTool(
    "get_local_ai_migration_status",
    {
      title: "Get local AI migration status",
      description:
        "Shows known local AI DB migration status without exposing SQL contents.",
      inputSchema: z.object({})
    },
    withToolTelemetry(
      "get_local_ai_migration_status",
      "db",
      async () => {
        try {
          const status = await getLocalAiMigrationStatus();

          return textResponse(JSON.stringify(status, null, 2));
        } catch (error) {
          return textResponse(
            JSON.stringify(
              {
                status: "error",
                total: 0,
                applied: 0,
                pending: 0,
                migrations: [],
                message: safeErrorMessage(error)
              },
              null,
              2
            )
          );
        }
      }
    )
  );

  server.registerTool(
    "run_local_ai_migrations",
    {
      title: "Run local AI DB migrations",
      description:
        "Runs approved local AI DB migrations from infra/db/local-ai/migrations only. Does not accept arbitrary SQL.",
      inputSchema: z.object({
        approvalText: z
          .string()
          .describe("Must exactly equal RUN_LOCAL_AI_MIGRATIONS.")
      })
    },
    withToolTelemetry(
      "run_local_ai_migrations",
      "db_migration",
      async (
        input: { approvalText: string },
        traceContext: TraceContext
      ) => {
        try {
          assertRunLocalAiMigrationsApprovalText(input.approvalText);

          await writeAuditEvent({
            traceContext,
            toolName: "run_local_ai_migrations",
            operationType: "db_migration",
            status: "attempt",
            message:
              "Approved local AI DB migration run requested. SQL contents are not logged."
          });

          const result = await runLocalAiMigrations();

          await writeAuditEvent({
            traceContext,
            toolName: "run_local_ai_migrations",
            operationType: "db_migration",
            status: result.pending === 0 ? "success" : "error",
            durationMs: getDurationMs(traceContext),
            appliedCount: result.applied.length,
            pendingCount: result.pending,
            message: result.message
          });

          return textResponse(JSON.stringify(result, null, 2));
        } catch (error) {
          await writeAuditEvent({
            traceContext,
            toolName: "run_local_ai_migrations",
            operationType: "db_migration",
            status: statusFromError(error),
            durationMs: getDurationMs(traceContext),
            message: safeErrorMessage(error)
          });

          if (statusFromError(error) === "denied") {
            throw error;
          }

          return textResponse(
            JSON.stringify(
              {
                status: "error",
                applied: [],
                skipped: [],
                message: safeErrorMessage(error)
              },
              null,
              2
            )
          );
        }
      }
    )
  );
}
