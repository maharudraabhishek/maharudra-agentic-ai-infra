import fs from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { PROJECT_ROOT } from "../config/mcp-config.js";
import { assertExactApprovalText } from "../security/write-policy.js";
import { sha256 } from "../utils/crypto.js";
import { withLocalAiDbClient } from "./local-ai-db-client.js";

export const RUN_LOCAL_AI_MIGRATIONS_APPROVAL_TEXT =
  "RUN_LOCAL_AI_MIGRATIONS";

const MIGRATIONS_DIR = path.join(
  PROJECT_ROOT,
  "infra",
  "db",
  "local-ai",
  "migrations"
);
const MIGRATION_FILE_PATTERN = /^\d{3}_[a-z0-9_]+\.sql$/;

class LocalAiMigrationSafetyError extends Error {
  override name = "LocalAiMigrationSafetyError";
}

type AppliedMigrationRow = {
  version: string;
  name: string;
  checksum: string;
  applied_at: Date | string;
};

type LocalAiMigrationFile = {
  version: string;
  name: string;
  fileName: string;
  checksum: string;
  sql: string;
};

type MigrationDirEntry = {
  isFile: () => boolean;
  name: string;
};

export type LocalAiMigrationSummary = {
  version: string;
  name: string;
  fileName: string;
  checksum: string;
  status: "applied" | "pending";
  appliedAt?: string;
};

export type LocalAiMigrationStatus = {
  status: "ok";
  total: number;
  applied: number;
  pending: number;
  migrations: LocalAiMigrationSummary[];
  message: string;
};

export type RunLocalAiMigrationsResult = {
  status: "completed";
  total: number;
  applied: LocalAiMigrationSummary[];
  skipped: LocalAiMigrationSummary[];
  pending: number;
  message: string;
};

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function parseMigrationFileName(fileName: string): {
  version: string;
  name: string;
} {
  if (!MIGRATION_FILE_PATTERN.test(fileName)) {
    throw new LocalAiMigrationSafetyError(
      `Migration safety check failed: unsupported migration file name "${fileName}".`
    );
  }

  const version = fileName.slice(0, 3);
  const name = fileName.slice(4, -4);

  return { version, name };
}

async function loadMigrationFiles(): Promise<LocalAiMigrationFile[]> {
  let entries: MigrationDirEntry[];

  try {
    entries = await fs.readdir(MIGRATIONS_DIR, { withFileTypes: true });
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;

    if (nodeError.code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();

  for (const fileName of files) {
    parseMigrationFileName(fileName);
  }

  return Promise.all(
    files.map(async (fileName) => {
      const { version, name } = parseMigrationFileName(fileName);
      const sql = await fs.readFile(path.join(MIGRATIONS_DIR, fileName), "utf8");

      return {
        version,
        name,
        fileName,
        checksum: sha256(sql),
        sql
      };
    })
  );
}

async function migrationTableExists(client: PoolClient): Promise<boolean> {
  const result = await client.query<{ table_name: string | null }>(
    "select to_regclass('local_ai.schema_migrations')::text as table_name"
  );

  return result.rows[0]?.table_name === "local_ai.schema_migrations";
}

async function readAppliedMigrations(
  client: PoolClient
): Promise<AppliedMigrationRow[]> {
  if (!(await migrationTableExists(client))) {
    return [];
  }

  const result = await client.query<AppliedMigrationRow>(
    [
      "select version, name, checksum, applied_at",
      "from local_ai.schema_migrations",
      "order by version"
    ].join(" ")
  );

  return result.rows;
}

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query("create schema if not exists local_ai");
  await client.query(
    [
      "create table if not exists local_ai.schema_migrations (",
      "version text primary key,",
      "name text not null,",
      "checksum text not null,",
      "applied_at timestamptz not null default now()",
      ")"
    ].join(" ")
  );
}

function buildMigrationStatus(
  migrationFiles: LocalAiMigrationFile[],
  appliedRows: AppliedMigrationRow[]
): LocalAiMigrationStatus {
  const filesByVersion = new Map(
    migrationFiles.map((migration) => [migration.version, migration])
  );
  const appliedByVersion = new Map(
    appliedRows.map((migration) => [migration.version, migration])
  );

  for (const appliedMigration of appliedRows) {
    const localMigration = filesByVersion.get(appliedMigration.version);

    if (!localMigration) {
      throw new LocalAiMigrationSafetyError(
        `Migration safety check failed: applied version "${appliedMigration.version}" has no local migration file.`
      );
    }

    if (localMigration.checksum !== appliedMigration.checksum) {
      throw new LocalAiMigrationSafetyError(
        `Migration safety check failed: checksum mismatch for version "${appliedMigration.version}".`
      );
    }
  }

  const migrations = migrationFiles.map<LocalAiMigrationSummary>((migration) => {
    const appliedMigration = appliedByVersion.get(migration.version);

    return {
      version: migration.version,
      name: migration.name,
      fileName: migration.fileName,
      checksum: migration.checksum,
      status: appliedMigration ? "applied" : "pending",
      appliedAt: appliedMigration
        ? toIsoString(appliedMigration.applied_at)
        : undefined
    };
  });

  const applied = migrations.filter(
    (migration) => migration.status === "applied"
  ).length;
  const pending = migrations.length - applied;

  return {
    status: "ok",
    total: migrations.length,
    applied,
    pending,
    migrations,
    message:
      pending === 0
        ? "Local AI DB migrations are current."
        : `${pending} local AI DB migration(s) are pending.`
  };
}

export function assertRunLocalAiMigrationsApprovalText(
  approvalText: string
): void {
  assertExactApprovalText({
    actual: approvalText,
    expected: RUN_LOCAL_AI_MIGRATIONS_APPROVAL_TEXT,
    deniedMessage:
      'Migration denied: approvalText must exactly equal "RUN_LOCAL_AI_MIGRATIONS".'
  });
}

export async function getLocalAiMigrationStatus(): Promise<LocalAiMigrationStatus> {
  const migrationFiles = await loadMigrationFiles();

  return withLocalAiDbClient(async (client) => {
    const appliedRows = await readAppliedMigrations(client);

    return buildMigrationStatus(migrationFiles, appliedRows);
  });
}

export async function runLocalAiMigrations(): Promise<RunLocalAiMigrationsResult> {
  const migrationFiles = await loadMigrationFiles();

  return withLocalAiDbClient(async (client) => {
    await ensureMigrationTable(client);

    const beforeStatus = buildMigrationStatus(
      migrationFiles,
      await readAppliedMigrations(client)
    );
    const pendingMigrations = migrationFiles.filter(
      (migration) =>
        beforeStatus.migrations.find(
          (summary) => summary.version === migration.version
        )?.status === "pending"
    );
    const applied: LocalAiMigrationSummary[] = [];

    for (const migration of pendingMigrations) {
      await client.query("begin");

      try {
        await client.query(migration.sql);
        await client.query(
          [
            "insert into local_ai.schema_migrations",
            "(version, name, checksum, applied_at)",
            "values ($1, $2, $3, now())"
          ].join(" "),
          [migration.version, migration.name, migration.checksum]
        );
        await client.query("commit");

        applied.push({
          version: migration.version,
          name: migration.name,
          fileName: migration.fileName,
          checksum: migration.checksum,
          status: "applied",
          appliedAt: new Date().toISOString()
        });
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }

    const afterStatus = buildMigrationStatus(
      migrationFiles,
      await readAppliedMigrations(client)
    );
    const skipped = afterStatus.migrations.filter(
      (migration) =>
        migration.status === "applied" &&
        !applied.some(
          (appliedMigration) => appliedMigration.version === migration.version
        )
    );

    return {
      status: "completed",
      total: afterStatus.total,
      applied,
      skipped,
      pending: afterStatus.pending,
      message:
        applied.length === 0
          ? "No pending local AI DB migrations were applied."
          : `Applied ${applied.length} local AI DB migration(s).`
    };
  });
}
