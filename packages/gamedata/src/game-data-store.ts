import { type Database, gameBuilds, items } from "@nozdormu/db";
import { and, asc, desc, eq, ilike, sql } from "drizzle-orm";
import type { ItemRecord } from "./item-sparse.ts";

// Everything imported from one client build.
export interface GameBuild {
  readonly version: string;
  readonly items: readonly ItemRecord[];
}

export interface GameDataStore {
  // The build the stored data comes from, if any has been imported.
  readonly importedVersion: () => Promise<string | undefined>;
  // Replaces all the stored data with this build's, in one transaction.
  readonly replaceBuild: (build: GameBuild) => Promise<void>;
  readonly getItem: (id: number) => Promise<ItemRecord | undefined>;
  // Items whose name contains the text: names starting with it first, then shorter names.
  readonly searchItems: (text: string, limit: number) => Promise<ItemRecord[]>;
}

// Postgres allows 65,535 parameters per statement; six per item keeps this well under.
const insertBatchSize = 1000;

// Names of items Blizzard left in the data but players never see: "DEPRECATED", "(Test)", "[PH]"
// placeholders, "Unused" and "(OLD)". Hidden from searches; still found by ID. "High Test" is a
// real fishing line, the only real item among the 19,224 in 1.60.1.70009 with "test" in its name.
const unusedItemName = String.raw`deprecated|(?<!high )\mtest\M|\[ph\]|placeholder|\munused\M|\(old\)`;

// So "%" and "_" in what someone types match themselves, not any characters.
function escapeLike(text: string): string {
  return text.replaceAll(/[\\%_]/g, (character) => `\\${character}`);
}

export function createGameDataStore(db: Database): GameDataStore {
  return {
    importedVersion: async () => {
      const [build] = await db
        .select({ version: gameBuilds.version })
        .from(gameBuilds)
        .orderBy(desc(gameBuilds.importedAt))
        .limit(1);
      return build?.version;
    },
    replaceBuild: async (build) => {
      await db.transaction(async (tx) => {
        await tx.delete(items);
        for (let start = 0; start < build.items.length; start += insertBatchSize) {
          await tx.insert(items).values(build.items.slice(start, start + insertBatchSize));
        }
        await tx
          .insert(gameBuilds)
          .values({ version: build.version, itemCount: build.items.length })
          .onConflictDoUpdate({
            target: gameBuilds.version,
            set: { itemCount: build.items.length, importedAt: sql`now()` },
          });
      });
    },
    getItem: async (id) => {
      const [found] = await db.select().from(items).where(eq(items.id, id));
      return found;
    },
    searchItems: async (text, limit) => {
      const escaped = escapeLike(text);
      return db
        .select()
        .from(items)
        .where(and(ilike(items.name, `%${escaped}%`), sql`${items.name} !~* ${unusedItemName}`))
        .orderBy(
          sql`case when ${items.name} ilike ${`${escaped}%`} then 0 else 1 end`,
          sql`length(${items.name})`,
          asc(items.name),
        )
        .limit(limit);
    },
  };
}
