import { type Database, dungeonBosses, dungeonLoot, dungeons, escapeLike } from "@nozdormu/db";
import { asc, eq, ilike, sql } from "drizzle-orm";
import type { Dungeon } from "./spyglass.ts";

export interface StoredDungeon extends Dungeon {
  // The game build Spyglass scanned it in.
  readonly build: string;
}

export type DungeonSummary = Pick<Dungeon, "name" | "minLevel" | "maxLevel">;

export interface DungeonStore {
  // Replaces every stored dungeon with these, in one transaction.
  readonly replaceAll: (build: string, dungeons: readonly Dungeon[]) => Promise<void>;
  readonly get: (name: string) => Promise<StoredDungeon | undefined>;
  // Dungeons whose name contains the text: names starting with it first, then alphabetically.
  readonly search: (text: string, limit: number) => Promise<DungeonSummary[]>;
  // The build of the stored dungeons, or undefined before the first sync.
  readonly loadedBuild: () => Promise<string | undefined>;
}

export function createDungeonStore(db: Database): DungeonStore {
  return {
    replaceAll: async (build, synced) => {
      await db.transaction(async (tx) => {
        await tx.delete(dungeons);
        if (synced.length === 0) {
          return;
        }
        await tx.insert(dungeons).values(
          synced.map((dungeon) => ({
            name: dungeon.name,
            minLevel: dungeon.minLevel,
            maxLevel: dungeon.maxLevel,
            requiredLevel: dungeon.requiredLevel ?? null,
            sourceBuild: build,
          })),
        );
        const bosses = synced.flatMap((dungeon) =>
          dungeon.bosses.map((boss, position) => ({ dungeon: dungeon.name, position, boss })),
        );
        if (bosses.length > 0) {
          await tx
            .insert(dungeonBosses)
            .values(
              bosses.map(({ dungeon, position, boss }) => ({ dungeon, position, name: boss.name })),
            );
        }
        const loot = bosses.flatMap(({ dungeon, position: bossPosition, boss }) =>
          boss.loot.map((item, position) => ({
            dungeon,
            bossPosition,
            position,
            itemId: item.itemId,
            itemName: item.name,
          })),
        );
        if (loot.length > 0) {
          await tx.insert(dungeonLoot).values(loot);
        }
      });
    },
    get: async (name) => {
      const [found] = await db.select().from(dungeons).where(eq(dungeons.name, name));
      if (found === undefined) {
        return undefined;
      }
      const bosses = await db
        .select({ position: dungeonBosses.position, name: dungeonBosses.name })
        .from(dungeonBosses)
        .where(eq(dungeonBosses.dungeon, name))
        .orderBy(asc(dungeonBosses.position));
      const loot = await db
        .select({
          bossPosition: dungeonLoot.bossPosition,
          itemId: dungeonLoot.itemId,
          name: dungeonLoot.itemName,
        })
        .from(dungeonLoot)
        .where(eq(dungeonLoot.dungeon, name))
        .orderBy(asc(dungeonLoot.bossPosition), asc(dungeonLoot.position));
      return {
        name: found.name,
        minLevel: found.minLevel,
        maxLevel: found.maxLevel,
        requiredLevel: found.requiredLevel ?? undefined,
        bosses: bosses.map((boss) => ({
          name: boss.name,
          loot: loot
            .filter((item) => item.bossPosition === boss.position)
            .map(({ itemId, name: itemName }) => ({ itemId, name: itemName })),
        })),
        build: found.sourceBuild,
      };
    },
    search: (text, limit) => {
      const escaped = escapeLike(text);
      return db
        .select({ name: dungeons.name, minLevel: dungeons.minLevel, maxLevel: dungeons.maxLevel })
        .from(dungeons)
        .where(ilike(dungeons.name, `%${escaped}%`))
        .orderBy(
          sql`case when ${dungeons.name} ilike ${`${escaped}%`} then 0 else 1 end`,
          asc(dungeons.name),
        )
        .limit(limit);
    },
    loadedBuild: async () => {
      const [any] = await db.select({ build: dungeons.sourceBuild }).from(dungeons).limit(1);
      return any?.build;
    },
  };
}
