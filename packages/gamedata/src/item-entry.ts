import type { ItemRecord } from "./item-sparse.ts";
import type { ScannedItem } from "./scanned-item.ts";

// An item as /item shows it: from the game as scanned where it has been (the scan is Forever's
// own), otherwise from the client's item table.
export interface ItemEntry {
  readonly id: number;
  readonly name: string;
  readonly quality: number;
  readonly itemLevel: number;
  readonly requiredLevel: number;
  // The game's name for where it's worn, such as "INVTYPE_WAIST", or "INVTYPE_NON_EQUIP".
  readonly slot: string;
  // What kind of item it is and its exact stats, where it's been scanned.
  readonly scanned: ScannedItem | undefined;
}

// The client table's InventoryType, by the game's name for it.
const slotsByInventoryType: ReadonlyMap<number, string> = new Map([
  [1, "INVTYPE_HEAD"],
  [2, "INVTYPE_NECK"],
  [3, "INVTYPE_SHOULDER"],
  [4, "INVTYPE_BODY"],
  [5, "INVTYPE_CHEST"],
  [6, "INVTYPE_WAIST"],
  [7, "INVTYPE_LEGS"],
  [8, "INVTYPE_FEET"],
  [9, "INVTYPE_WRIST"],
  [10, "INVTYPE_HAND"],
  [11, "INVTYPE_FINGER"],
  [12, "INVTYPE_TRINKET"],
  [13, "INVTYPE_WEAPON"],
  [14, "INVTYPE_SHIELD"],
  [15, "INVTYPE_RANGED"],
  [16, "INVTYPE_CLOAK"],
  [17, "INVTYPE_2HWEAPON"],
  [18, "INVTYPE_BAG"],
  [19, "INVTYPE_TABARD"],
  [20, "INVTYPE_ROBE"],
  [21, "INVTYPE_WEAPONMAINHAND"],
  [22, "INVTYPE_WEAPONOFFHAND"],
  [23, "INVTYPE_HOLDABLE"],
  [24, "INVTYPE_AMMO"],
  [25, "INVTYPE_THROWN"],
  [26, "INVTYPE_RANGEDRIGHT"],
  [27, "INVTYPE_QUIVER"],
  [28, "INVTYPE_RELIC"],
]);

// The entry for an item: its scan where there is one, otherwise its row in the client's table.
export function itemEntry(
  client: ItemRecord | undefined,
  scanned: ScannedItem | undefined,
): ItemEntry | undefined {
  if (scanned !== undefined) {
    const { id, name, quality, itemLevel, requiredLevel, slot } = scanned;
    return { id, name, quality, itemLevel, requiredLevel, slot, scanned };
  }
  if (client === undefined) {
    return undefined;
  }
  const { id, name, quality, itemLevel, requiredLevel, inventoryType } = client;
  const slot = slotsByInventoryType.get(inventoryType) ?? "INVTYPE_NON_EQUIP";
  return { id, name, quality, itemLevel, requiredLevel, slot, scanned: undefined };
}
