import type { ItemStat, ScannedItem } from "./spyglass.ts";

// Where an item is worn, by the game's name for it. Items that aren't worn have none.
const slots: ReadonlyMap<string, string> = new Map([
  ["INVTYPE_HEAD", "Head"],
  ["INVTYPE_NECK", "Neck"],
  ["INVTYPE_SHOULDER", "Shoulder"],
  ["INVTYPE_BODY", "Shirt"],
  ["INVTYPE_CHEST", "Chest"],
  ["INVTYPE_ROBE", "Chest"],
  ["INVTYPE_WAIST", "Waist"],
  ["INVTYPE_LEGS", "Legs"],
  ["INVTYPE_FEET", "Feet"],
  ["INVTYPE_WRIST", "Wrist"],
  ["INVTYPE_HAND", "Hands"],
  ["INVTYPE_FINGER", "Finger"],
  ["INVTYPE_TRINKET", "Trinket"],
  ["INVTYPE_CLOAK", "Back"],
  ["INVTYPE_WEAPON", "One-Hand"],
  ["INVTYPE_2HWEAPON", "Two-Hand"],
  ["INVTYPE_WEAPONMAINHAND", "Main Hand"],
  ["INVTYPE_WEAPONOFFHAND", "Off Hand"],
  ["INVTYPE_SHIELD", "Shield"],
  ["INVTYPE_HOLDABLE", "Held In Off-hand"],
  ["INVTYPE_RANGED", "Ranged"],
  ["INVTYPE_RANGEDRIGHT", "Ranged"],
  ["INVTYPE_THROWN", "Thrown"],
  ["INVTYPE_RELIC", "Relic"],
  ["INVTYPE_TABARD", "Tabard"],
  ["INVTYPE_BAG", "Bag"],
]);

// Short names players use for the main stats, and plain names for the others the game's names
// don't spell out. Any other stat is named from the game's name ("ATTACK_POWER_VS_BEAST" becomes
// "Attack Power Vs Beast").
const statNames: ReadonlyMap<string, string> = new Map([
  ["STAMINA", "Sta"],
  ["STRENGTH", "Str"],
  ["AGILITY", "Agi"],
  ["INTELLECT", "Int"],
  ["SPIRIT", "Spi"],
  ["SPELL_DAMAGE_DONE", "Spell Damage"],
  ["SPELL_HEALING_DONE", "Healing"],
  ["CRIT_RATING", "Crit"],
  ["HIT_RATING", "Hit"],
  ["DODGE_RATING", "Dodge"],
  ["DEFENSE_SKILL_RATING", "Defense"],
  ["MANA_REGENERATION", "Mana per 5 sec"],
  ["HEALTH_REGEN", "Health per 5 sec"],
  ["RESISTANCE1_NAME", "Holy Resistance"],
  ["RESISTANCE2_NAME", "Fire Resistance"],
  ["RESISTANCE3_NAME", "Nature Resistance"],
  ["RESISTANCE4_NAME", "Frost Resistance"],
  ["RESISTANCE5_NAME", "Shadow Resistance"],
  ["RESISTANCE6_NAME", "Arcane Resistance"],
]);

function titleCase(name: string): string {
  return name
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function number(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

// A stat as a player reads it: "100 Armor", "11.9 DPS", "+4 Sta".
function statText({ stat, value }: ItemStat): string {
  if (stat === "RESISTANCE0_NAME") {
    return `${number(value)} Armor`;
  }
  if (stat === "DAMAGE_PER_SECOND") {
    return `${number(value)} DPS`;
  }
  return `+${number(value)} ${statNames.get(stat) ?? titleCase(stat)}`;
}

// An item's slot and stats, such as "Neck · +4 Sta, +2 Spi", leaving out what it doesn't have.
export function itemDetails(item: ScannedItem): string {
  const slot = slots.get(item.slot);
  const stats = item.stats.map(statText).join(", ");
  return [slot, stats].filter((part) => part !== undefined && part !== "").join(" · ");
}
