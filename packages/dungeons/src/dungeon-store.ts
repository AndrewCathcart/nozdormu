import {
  type Database,
  dungeonBosses,
  dungeonLoot,
  dungeonQuestRewards,
  dungeonQuests,
  dungeons,
  scannedItems,
  scannedItemStats,
} from "@nozdormu/db";
import type { ScannedItem } from "@nozdormu/gamedata";
import { asc, eq, inArray } from "drizzle-orm";
import { type Dungeon, faction, type LootItem, type Quest, type SpyglassData } from "./spyglass.ts";

// A loot item, with its scanned details where Spyglass has scanned it.
export interface StoredLootItem extends LootItem {
  readonly scanned: ScannedItem | undefined;
}

export interface StoredQuest extends Omit<Quest, "rewards"> {
  readonly rewards: readonly StoredLootItem[];
}

// Whether Spyglass has scanned nothing of the quest but its ID and name.
export function isKnownOnlyByName(quest: StoredQuest): boolean {
  return (
    quest.side === undefined &&
    quest.className === undefined &&
    quest.requiredLevel === undefined &&
    quest.xp === undefined &&
    quest.objective === undefined &&
    quest.rewards.length === 0
  );
}

export interface StoredDungeon extends Omit<Dungeon, "bosses" | "quests"> {
  readonly bosses: readonly { readonly name: string; readonly loot: readonly StoredLootItem[] }[];
  readonly quests: readonly StoredQuest[];
}

export type DungeonSummary = Pick<Dungeon, "name" | "minLevel" | "maxLevel">;

export interface DungeonStore {
  // Replaces every stored dungeon and scanned item with these, in one transaction.
  readonly replaceAll: (synced: SpyglassData) => Promise<void>;
  readonly get: (name: string) => Promise<StoredDungeon | undefined>;
  // Every dungeon, lowest levels first.
  readonly list: () => Promise<DungeonSummary[]>;
  // The build of the stored dungeons, or undefined before the first sync.
  readonly loadedBuild: () => Promise<string | undefined>;
}

// Postgres allows 65,535 parameters per statement; at most nine per row keeps this well under.
const insertBatchSize = 1000;

async function insertInBatches<Row>(
  rows: readonly Row[],
  insert: (batch: Row[]) => Promise<unknown>,
): Promise<void> {
  for (let start = 0; start < rows.length; start += insertBatchSize) {
    await insert(rows.slice(start, start + insertBatchSize));
  }
}

export function createDungeonStore(db: Database): DungeonStore {
  // The scanned details of these items, by ID.
  const scannedById = async (ids: readonly number[]): Promise<Map<number, ScannedItem>> => {
    if (ids.length === 0) {
      return new Map();
    }
    const items = await db
      .select()
      .from(scannedItems)
      .where(inArray(scannedItems.id, [...ids]));
    const stats = await db
      .select()
      .from(scannedItemStats)
      .where(inArray(scannedItemStats.itemId, [...ids]))
      .orderBy(asc(scannedItemStats.position));
    return new Map(
      items.map((item) => [
        item.id,
        {
          ...item,
          stats: stats
            .filter((row) => row.itemId === item.id)
            .map(({ stat, value }) => ({ stat, value })),
        },
      ]),
    );
  };

  return {
    replaceAll: async ({ build, dungeons: syncedDungeons, items }) => {
      await db.transaction(async (tx) => {
        await tx.delete(dungeons);
        await tx.delete(scannedItems);
        await insertInBatches(items, (batch) =>
          tx.insert(scannedItems).values(
            batch.map((item) => ({
              id: item.id,
              name: item.name,
              quality: item.quality,
              itemLevel: item.itemLevel,
              requiredLevel: item.requiredLevel,
              itemClass: item.itemClass,
              itemSubclass: item.itemSubclass,
              slot: item.slot,
            })),
          ),
        );
        await insertInBatches(
          items.flatMap((item) =>
            item.stats.map(({ stat, value }, position) => ({
              itemId: item.id,
              position,
              stat,
              value,
            })),
          ),
          (batch) => tx.insert(scannedItemStats).values(batch),
        );
        await insertInBatches(syncedDungeons, (batch) =>
          tx.insert(dungeons).values(
            batch.map((dungeon) => ({
              name: dungeon.name,
              minLevel: dungeon.minLevel,
              maxLevel: dungeon.maxLevel,
              requiredLevel: dungeon.requiredLevel ?? null,
              sourceBuild: build,
            })),
          ),
        );
        const bosses = syncedDungeons.flatMap((dungeon) =>
          dungeon.bosses.map((boss, position) => ({ dungeon: dungeon.name, position, boss })),
        );
        await insertInBatches(bosses, (batch) =>
          tx
            .insert(dungeonBosses)
            .values(
              batch.map(({ dungeon, position, boss }) => ({ dungeon, position, name: boss.name })),
            ),
        );
        await insertInBatches(
          bosses.flatMap(({ dungeon, position: bossPosition, boss }) =>
            boss.loot.map((item, position) => ({
              dungeon,
              bossPosition,
              position,
              itemId: item.itemId,
              itemName: item.name,
            })),
          ),
          (batch) => tx.insert(dungeonLoot).values(batch),
        );
        const quests = syncedDungeons.flatMap((dungeon) =>
          dungeon.quests.map((quest, position) => ({ dungeon: dungeon.name, position, quest })),
        );
        await insertInBatches(quests, (batch) =>
          tx.insert(dungeonQuests).values(
            batch.map(({ dungeon, position, quest }) => ({
              dungeon,
              position,
              questId: quest.id,
              name: quest.name,
              side: quest.side ?? null,
              className: quest.className ?? null,
              requiredLevel: quest.requiredLevel ?? null,
              xp: quest.xp ?? null,
              objective: quest.objective ?? null,
            })),
          ),
        );
        await insertInBatches(
          quests.flatMap(({ dungeon, position: questPosition, quest }) =>
            quest.rewards.map((item, position) => ({
              dungeon,
              questPosition,
              position,
              itemId: item.itemId,
              itemName: item.name,
            })),
          ),
          (batch) => tx.insert(dungeonQuestRewards).values(batch),
        );
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
      const quests = await db
        .select()
        .from(dungeonQuests)
        .where(eq(dungeonQuests.dungeon, name))
        .orderBy(asc(dungeonQuests.position));
      const rewards = await db
        .select({
          questPosition: dungeonQuestRewards.questPosition,
          itemId: dungeonQuestRewards.itemId,
          name: dungeonQuestRewards.itemName,
        })
        .from(dungeonQuestRewards)
        .where(eq(dungeonQuestRewards.dungeon, name))
        .orderBy(asc(dungeonQuestRewards.questPosition), asc(dungeonQuestRewards.position));
      const scanned = await scannedById([
        ...new Set([...loot, ...rewards].map((item) => item.itemId)),
      ]);
      return {
        name: found.name,
        minLevel: found.minLevel,
        maxLevel: found.maxLevel,
        requiredLevel: found.requiredLevel ?? undefined,
        bosses: bosses.map((boss) => ({
          name: boss.name,
          loot: loot
            .filter((item) => item.bossPosition === boss.position)
            .map(({ itemId, name: itemName }) => ({
              itemId,
              name: itemName,
              scanned: scanned.get(itemId),
            })),
        })),
        quests: quests.map((quest) => ({
          id: quest.questId,
          name: quest.name,
          side: faction.safeParse(quest.side).data,
          className: quest.className ?? undefined,
          requiredLevel: quest.requiredLevel ?? undefined,
          xp: quest.xp ?? undefined,
          objective: quest.objective ?? undefined,
          rewards: rewards
            .filter((item) => item.questPosition === quest.position)
            .map(({ itemId, name: itemName }) => ({
              itemId,
              name: itemName,
              scanned: scanned.get(itemId),
            })),
        })),
      };
    },
    list: () =>
      db
        .select({ name: dungeons.name, minLevel: dungeons.minLevel, maxLevel: dungeons.maxLevel })
        .from(dungeons)
        .orderBy(asc(dungeons.minLevel), asc(dungeons.name)),
    loadedBuild: async () => {
      const [first] = await db.select({ build: dungeons.sourceBuild }).from(dungeons).limit(1);
      return first?.build;
    },
  };
}
