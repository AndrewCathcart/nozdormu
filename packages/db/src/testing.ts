// Real Postgres for tests. Each `pnpm test` run migrates one template database, and each test file
// copies it into its own database, so tests never share state. Only databases whose names match
// nozdormu_test_<timestamp>_<uuid> are ever created or dropped. Needs the local DBngin "nozdormu"
// server on port 5433 (a Postgres service container in CI), which accepts the postgres user without
// a password. Tests connect to the server's "postgres" database only to create and drop their own.
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, inject } from "vitest";
import { z } from "zod";
import {
  connectDatabase,
  type Database,
  type DatabaseConnection,
  runMigrations,
} from "./client.ts";

const serverUrl = "postgres://postgres@localhost:5433";
const testDatabaseName = /^nozdormu_test_(\d{13})_[0-9a-f]{32}$/;
const staleAfterMs = 60 * 60 * 1000;
const databaseNames = z.array(z.object({ datname: z.string() }));

function newTestDatabaseName(): string {
  return `nozdormu_test_${String(Date.now())}_${randomUUID().replaceAll("-", "")}`;
}

function checkedName(name: string): string {
  if (!testDatabaseName.test(name)) {
    throw new Error(`Refusing to touch ${name}: it isn't a test database.`);
  }
  return name;
}

async function withAdminConnection<T>(work: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(`${serverUrl}/postgres`, { max: 1, onnotice: () => undefined });
  try {
    return await work(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function createDatabase(name: string, template?: string): Promise<void> {
  await withAdminConnection(async (sql) => {
    await (template === undefined
      ? sql`create database ${sql(checkedName(name))}`
      : sql`create database ${sql(checkedName(name))} template ${sql(checkedName(template))}`);
  });
}

export async function dropDatabase(name: string): Promise<void> {
  await withAdminConnection(async (sql) => {
    await sql`drop database if exists ${sql(checkedName(name))} with (force)`;
  });
}

// Drops test databases left behind by runs that were killed before they could clean up.
export async function dropStaleTestDatabases(now: Date): Promise<void> {
  const rows = databaseNames.parse(
    await withAdminConnection(
      (sql) => sql`select datname from pg_database where datname like 'nozdormu_test_%'`,
    ),
  );
  for (const { datname } of rows) {
    const createdAt = testDatabaseName.exec(datname)?.[1];
    if (createdAt !== undefined && now.getTime() - Number.parseInt(createdAt, 10) > staleAfterMs) {
      await dropDatabase(datname);
    }
  }
}

export async function createTemplateDatabase(): Promise<string> {
  const name = newTestDatabaseName();
  await createDatabase(name);
  try {
    const connection = await connectDatabase(`${serverUrl}/${name}`);
    try {
      await runMigrations(connection.db);
    } finally {
      await connection.close();
    }
  } catch (error) {
    await dropDatabase(name);
    throw error;
  }
  return name;
}

export interface TestDatabaseOptions {
  // False gives an empty database with no migrations applied.
  readonly migrated?: boolean;
}

// Gives the calling test file its own database, created before its tests and dropped after them.
export function useTestDatabase(options: TestDatabaseOptions = {}): { readonly db: Database } {
  const name = newTestDatabaseName();
  let connection: DatabaseConnection | undefined;
  beforeAll(async () => {
    await createDatabase(name, options.migrated === false ? undefined : inject("templateDatabase"));
    connection = await connectDatabase(`${serverUrl}/${name}`);
  });
  afterAll(async () => {
    await connection?.close();
    await dropDatabase(name);
  });
  return {
    get db(): Database {
      if (connection === undefined) {
        throw new Error(
          "The test database isn't ready yet. Use it inside a test, not at module level.",
        );
      }
      return connection.db;
    },
  };
}
