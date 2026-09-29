import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { z } from "zod";
import * as schema from "./schema.ts";

export type Database = PostgresJsDatabase<typeof schema>;

export interface DatabaseConnection {
  readonly db: Database;
  readonly close: () => Promise<void>;
}

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

// Connects and runs a trivial query, so a wrong DATABASE_URL fails here rather than mid-startup.
export async function connectDatabase(url: string): Promise<DatabaseConnection> {
  // Postgres notices (e.g. "schema already exists, skipping") aren't errors; don't print them.
  const client = postgres(url, { max: 5, onnotice: () => undefined });
  const close = (): Promise<void> => client.end({ timeout: 5 });
  try {
    await client`select 1`;
  } catch (error) {
    await close();
    throw error;
  }
  return { db: drizzle(client, { schema }), close };
}

const presenceRows = z.array(z.object({ present: z.boolean() })).length(1);
const countRows = z.array(z.object({ applied: z.number() })).length(1);

async function countAppliedMigrations(db: Database): Promise<number> {
  const [presence] = presenceRows.parse(
    await db.execute(
      sql`select to_regclass('drizzle.__drizzle_migrations') is not null as present`,
    ),
  );
  if (presence?.present !== true) {
    return 0;
  }
  const [count] = countRows.parse(
    await db.execute(sql`select count(*)::int as applied from drizzle.__drizzle_migrations`),
  );
  return count?.applied ?? 0;
}

// Applies every committed migration that hasn't run yet, and returns how many it applied.
export async function runMigrations(db: Database): Promise<number> {
  const before = await countAppliedMigrations(db);
  await migrate(db, { migrationsFolder });
  return (await countAppliedMigrations(db)) - before;
}
