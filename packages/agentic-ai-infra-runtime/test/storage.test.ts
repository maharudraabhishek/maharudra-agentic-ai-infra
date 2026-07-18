import { describe, expect, it } from "vitest";
import {
  PostgresStorageProvider,
  RUN_AGENTIC_AI_INFRA_MIGRATIONS
} from "../src/index.js";
import type { QueryableDatabase } from "../src/storage/index.js";

class FakeDatabase implements QueryableDatabase {
  readonly queries: readonly [string, readonly unknown[] | undefined][] = [];
  private mutableQueries: [string, readonly unknown[] | undefined][] = [];

  async query<Row>(sql: string, values?: readonly unknown[]) {
    this.mutableQueries.push([sql, values]);
    (this as { mutableQueries: [string, readonly unknown[] | undefined][] }).mutableQueries = this.mutableQueries;

    if (sql.includes("agentic_schema_migrations") && sql.includes("select")) {
      return { rows: [] as Row[] };
    }

    return { rows: [] as Row[] };
  }

  snapshot(): readonly [string, readonly unknown[] | undefined][] {
    return this.mutableQueries;
  }
}

describe("storage and migrations", () => {
  it("missing DB config returns a recoverable failure", async () => {
    const provider = new PostgresStorageProvider("missing-db");
    const result = await provider.healthCheck();

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("storage.unavailable");
      expect(result.error.severity).toBe("recoverable");
    }
  });

  it("migration runner rejects missing or wrong approval text", async () => {
    const database = new FakeDatabase();
    const provider = new PostgresStorageProvider("db", { database });
    const result = await provider.runMigrations("WRONG");

    expect(result.ok).toBe(false);
    expect(database.snapshot()).toEqual([]);
  });

  it("migration status discovery does not execute migration SQL", async () => {
    const database = new FakeDatabase();
    const provider = new PostgresStorageProvider("db", { database });
    const result = await provider.discoverMigrationStatus();

    expect(result.ok).toBe(true);
    expect(database.snapshot().length).toBe(1);
    expect(database.snapshot()[0]?.[0]).toContain("select migration_id");
  });

  it("migration runner accepts only the exact approval constant", async () => {
    const database = new FakeDatabase();
    const provider = new PostgresStorageProvider("db", { database });
    const result = await provider.runMigrations(RUN_AGENTIC_AI_INFRA_MIGRATIONS);

    expect(result.ok).toBe(true);
    expect(database.snapshot().some(([sql]) => sql.includes("agentic_sources"))).toBe(true);
  });
});
