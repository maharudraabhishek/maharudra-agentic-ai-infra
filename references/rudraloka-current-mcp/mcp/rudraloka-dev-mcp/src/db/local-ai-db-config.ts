export type LocalAiDbConfig = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
};

export type RedactedLocalAiDbConfig = Omit<LocalAiDbConfig, "password"> & {
  passwordConfigured: boolean;
};

const DEFAULT_LOCAL_AI_DB_CONFIG: LocalAiDbConfig = {
  host: "127.0.0.1",
  port: 5433,
  database: "rudraloka_local_ai",
  user: "rudraloka_local",
  password: "rudraloka_local_dev_password"
};

function getEnvValue(name: string): string | undefined {
  const value = process.env[name];

  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function getPortOverride(): number | undefined {
  const rawPort = getEnvValue("RUDRALOKA_LOCAL_AI_DB_PORT");

  if (!rawPort) {
    return undefined;
  }

  const parsedPort = Number(rawPort);

  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    throw new Error("Invalid RUDRALOKA_LOCAL_AI_DB_PORT value.");
  }

  return parsedPort;
}

/**
 * Centralize local AI DB settings so tools never read .env files.
 *
 * These defaults match the local Docker Compose runtime and are not production
 * secret handling. Production will need a real secret-management approach.
 * Process environment overrides are supported for later flexibility, but this
 * module deliberately does not create or parse `.env` files because project
 * policy keeps env files out of AI-accessible workflows.
 */
export function getLocalAiDbConfig(): LocalAiDbConfig {
  return {
    host:
      getEnvValue("RUDRALOKA_LOCAL_AI_DB_HOST") ??
      DEFAULT_LOCAL_AI_DB_CONFIG.host,
    port: getPortOverride() ?? DEFAULT_LOCAL_AI_DB_CONFIG.port,
    database:
      getEnvValue("RUDRALOKA_LOCAL_AI_DB_NAME") ??
      DEFAULT_LOCAL_AI_DB_CONFIG.database,
    user:
      getEnvValue("RUDRALOKA_LOCAL_AI_DB_USER") ??
      DEFAULT_LOCAL_AI_DB_CONFIG.user,
    password:
      getEnvValue("RUDRALOKA_LOCAL_AI_DB_PASSWORD") ??
      DEFAULT_LOCAL_AI_DB_CONFIG.password
  };
}

export function getRedactedLocalAiDbConfig(): RedactedLocalAiDbConfig {
  const { password, ...safeConfig } = getLocalAiDbConfig();

  return {
    ...safeConfig,
    passwordConfigured: password.length > 0
  };
}
