import { type Database, scannedItems, scannedItemStats } from "@nozdormu/db";
import { asc, inArray } from "drizzle-orm";

// One of an item's stats as the game names it, such as "STAMINA" or "RESISTANCE0_NAME" (armour).
export interface ItemStat {
  readonly stat: string;
  readonly value: number;
}

// An item as scanned in the game, with its exact stats.
export interface ScannedItem {
  readonly id: number;
  readonly name: string;
  readonly quality: number;
  readonly itemLevel: number;
  readonly requiredLevel: number;
  // The game's IDs for what kind of item it is, such as 4 (armour) and 2 (leather).
  readonly itemClass: number;
  readonly itemSubclass: number;
  // The game's name for where it's worn, such as "INVTYPE_NECK".
  readonly slot: string;
  readonly stats: readonly ItemStat[];
}

// The scanned details of these items, by ID. The dungeon sync stores them; /dungeon and /item read
// them.
export async function readScannedItems(
  db: Database,
  ids: readonly number[],
): Promise<Map<number, ScannedItem>> {
  if (ids.length === 0) {
    return new Map();
  }
  const found = await db
    .select()
    .from(scannedItems)
    .where(inArray(scannedItems.id, [...ids]));
  const stats = await db
    .select()
    .from(scannedItemStats)
    .where(inArray(scannedItemStats.itemId, [...ids]))
    .orderBy(asc(scannedItemStats.position));
  return new Map(
    found.map((row) => [
      row.id,
      {
        ...row,
        stats: stats
          .filter((stat) => stat.itemId === row.id)
          .map(({ stat, value }) => ({ stat, value })),
      },
    ]),
  );
}
