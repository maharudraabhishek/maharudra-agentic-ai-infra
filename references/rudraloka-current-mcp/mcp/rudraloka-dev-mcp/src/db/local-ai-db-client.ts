import { Pool, type PoolClient } from "pg";
import { getLocalAiDbConfig } from "./local-ai-db-config.js";

let localAiDbPool: Pool | undefined;

export class LocalAiDbSafeError extends Error {
  override name = "LocalAiDbSafeError";
}

function getLocalAiDbPool(): Pool {
  if (localAiDbPool) {
    return localAiDbPool;
  }

  const config = getLocalAiDbConfig();

  localAiDbPool = new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    application_name: "rudraloka-dev-mcp",
    connectionTimeoutMillis: 3_000,
    idleTimeoutMillis: 10_000,
    max: 4
  });

  return localAiDbPool;
}

function messageFromPgError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (/ECONNREFUSED|ENOTFOUND|timeout|Connection terminated/i.test(message)) {
    return "Local AI DB is unavailable. Ensure the local Postgres + pgvector runtime is running.";
  }

  if (/password authentication failed|authentication/i.test(message)) {
    return "Local AI DB authentication failed. Check the local DB configuration without exposing credentials.";
  }

  if (/database .* does not exist/i.test(message)) {
    return "Local AI DB does not exist. Check the local pgvector runtime setup.";
  }

  if (/type \"vector\" does not exist|extension \"vector\"/i.test(message)) {
    return "pgvector is not available in the local AI DB.";
  }

  if (/relation .* does not exist|schema .* does not exist/i.test(message)) {
    return "Local AI DB migrations are not applied. Run local AI migrations before using this tool.";
  }

  if (/expected .* dimensions|different vector dimensions|vector.*dimension/i.test(message)) {
    return "Local AI DB embedding dimension mismatch. Review and apply the local AI migrations before indexing.";
  }

  return "Local AI DB operation failed safely. Check sanitized MCP logs for metadata.";
}

function toSafeDbError(error: unknown): Error {
  return new Error(messageFromPgError(error));
}

/**
 * Borrow a short-lived client from the pool and always release it.
 *
 * The raw pg config contains a local-only password, so errors are converted to
 * safe messages before leaving this boundary. Tool outputs and logs must never
 * include the password or raw connection object.
 */
export async function withLocalAiDbClient<T>(
  handler: (client: PoolClient) => Promise<T>
): Promise<T> {
  let client: PoolClient;

  try {
    client = await getLocalAiDbPool().connect();
  } catch (error) {
    throw toSafeDbError(error);
  }

  try {
    return await handler(client);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "LocalAiMigrationSafetyError" ||
        error.name === "LocalAiDbSafeError" ||
        error.name === "ProjectKnowledgeRetrievalSafeError")
    ) {
      throw error;
    }

    throw toSafeDbError(error);
  } finally {
    client.release();
  }
}
