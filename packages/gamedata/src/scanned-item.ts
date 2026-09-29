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
