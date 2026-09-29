import type { ItemStat, ScannedItem } from "./scanned-item.ts";

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

// The game's item class for armour, and its subclasses for the kinds that limit who can wear it.
const armourClass = 4;
const armourKinds: ReadonlyMap<number, string> = new Map([
  [1, "Cloth"],
  [2, "Leather"],
  [3, "Mail"],
  [4, "Plate"],
]);

// The game's item class for weapons, and its subclasses. Two-handed axes, maces and swords have
// their own subclasses, but the slot already says they're two-handed.
const weaponClass = 2;
const weaponKinds: ReadonlyMap<number, string> = new Map([
  [0, "Axe"],
  [1, "Axe"],
  [2, "Bow"],
  [3, "Gun"],
  [4, "Mace"],
  [5, "Mace"],
  [6, "Polearm"],
  [7, "Sword"],
  [8, "Sword"],
  [10, "Staff"],
  [13, "Fist Weapon"],
  [15, "Dagger"],
  [16, "Thrown"],
  [17, "Spear"],
  [18, "Crossbow"],
  [19, "Wand"],
  [20, "Fishing Pole"],
]);

// Slots whose name says less than the kind of weapon in them.
const rangedSlots: ReadonlySet<string> = new Set([
  "INVTYPE_RANGED",
  "INVTYPE_RANGEDRIGHT",
  "INVTYPE_THROWN",
]);

// Where an item is worn and what kind it is, such as "Leather Waist", "One-Hand Dagger" or "Bow".
// Cloaks are all cloth, so the game doesn't say so, and nor does this.
function kindText(item: ScannedItem): string | undefined {
  const slot = slots.get(item.slot);
  if (item.itemClass === weaponClass) {
    const kind = weaponKinds.get(item.itemSubclass);
    if (kind === undefined || slot === undefined) {
      return kind ?? slot;
    }
    return rangedSlots.has(item.slot) ? kind : `${slot} ${kind}`;
  }
  const kind = item.itemClass === armourClass ? armourKinds.get(item.itemSubclass) : undefined;
  if (slot === undefined || kind === undefined || item.slot === "INVTYPE_CLOAK") {
    return slot;
  }
  return `${kind} ${slot}`;
}

// Short names players use for the main stats, and plain names for the others the game's names
// don't spell out. Any other stat is named from the game's name ("SPELL_POWER" becomes "Spell
// Power").
const statNames: ReadonlyMap<string, string> = new Map([
  ["STAMINA", "Sta"],
  ["STRENGTH", "Str"],
  ["AGILITY", "Agi"],
  ["INTELLECT", "Int"],
  ["SPIRIT", "Spi"],
  ["SPELL_DAMAGE_DONE", "Spell Damage"],
  ["SPELL_HEALING_DONE", "Healing"],
  ["DEFENSE_SKILL_RATING", "Defense"],
  ["MANA_REGENERATION", "Mana per 5 sec"],
  ["POWER_REGEN0", "Mana per 5 sec"],
  ["HEALTH_REGEN", "Health per 5 sec"],
  ["RESISTANCE1_NAME", "Holy Resistance"],
  ["RESISTANCE2_NAME", "Fire Resistance"],
  ["RESISTANCE3_NAME", "Nature Resistance"],
  ["RESISTANCE4_NAME", "Frost Resistance"],
  ["RESISTANCE5_NAME", "Shadow Resistance"],
  ["RESISTANCE6_NAME", "Arcane Resistance"],
  ["SPELL_RESISTANCE_ALL_SCHOOLS", "All Resistances"],
  ["HOLY_DAMAGE_DONE", "Holy Spell Damage"],
  ["FIRE_DAMAGE_DONE", "Fire Spell Damage"],
  ["NATURE_DAMAGE_DONE", "Nature Spell Damage"],
  ["FROST_DAMAGE_DONE", "Frost Spell Damage"],
  ["SHADOW_DAMAGE_DONE", "Shadow Spell Damage"],
  ["ARCANE_DAMAGE_DONE", "Arcane Spell Damage"],
  ["PHYSICAL_DAMAGE_DONE", "Physical Damage"],
  ["TWOHANDED_AXES", "Two-Handed Axe Skill"],
  ["SWORDS", "Sword Skill"],
  ["TWOHANDED_SWORDS", "Two-Handed Sword Skill"],
  ["DAGGERS", "Dagger Skill"],
  ["FIST_WEAPONS", "Fist Weapon Skill"],
  ["POLEARMS", "Polearm Skill"],
]);

// Creature types a bonus can be against, as in "ATTACK_POWER_VS_BEAST", named as tooltips do.
const creatureTypes: ReadonlyMap<string, string> = new Map([
  ["BEAST", "Beasts"],
  ["DEMON", "Demons"],
  ["DRAGONKIN", "Dragonkin"],
  ["ELEMENTAL", "Elementals"],
  ["HUMANOID", "Humanoids"],
  ["MECHANICAL", "Mechanicals"],
  ["UNDEAD", "Undead"],
]);

function titleCase(name: string): string {
  return name
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// Stats the game stores as level 60 ratings, which Classic's tooltips give as percentages: 14 crit
// rating is 1% crit, as on Devilsaur Gauntlets, and 20 hit rating is 2% hit, as on Lionheart Helm.
const percentages: ReadonlyMap<
  string,
  { readonly name: string; readonly ratingPerPercent: number }
> = new Map([
  ["CRIT_RATING", { name: "Crit", ratingPerPercent: 14 }],
  ["HIT_RATING", { name: "Hit", ratingPerPercent: 10 }],
  ["DODGE_RATING", { name: "Dodge", ratingPerPercent: 12 }],
  ["PARRY_RATING", { name: "Parry", ratingPerPercent: 15 }],
  ["BLOCK_RATING", { name: "Block", ratingPerPercent: 5 }],
  ["HASTE_RATING", { name: "Haste", ratingPerPercent: 10 }],
]);

// A stat's name as players write it: "Sta", "Attack Power vs Beasts", "Spell Power".
function statName(stat: string): string {
  const named = statNames.get(stat);
  if (named !== undefined) {
    return named;
  }
  const [bonus = stat, against] = stat.split("_VS_");
  return against === undefined
    ? titleCase(stat)
    : `${titleCase(bonus)} vs ${creatureTypes.get(against) ?? titleCase(against)}`;
}

// A stat's value, with one decimal place when it isn't whole: "11.9".
function statValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

// A stat as a player reads it: "100 Armor", "11.9 DPS", "+4 Sta", "+1% Crit".
function statText({ stat, value }: ItemStat): string {
  if (stat === "RESISTANCE0_NAME") {
    return `${statValue(value)} Armor`;
  }
  if (stat === "DAMAGE_PER_SECOND") {
    return `${statValue(value)} DPS`;
  }
  const percentage = percentages.get(stat);
  if (percentage !== undefined) {
    return `+${statValue(value / percentage.ratingPerPercent)}% ${percentage.name}`;
  }
  return `+${statValue(value)} ${statName(stat)}`;
}

// The order the game's tooltip shows stats in: damage per second or armour, then the main stats.
// Others follow in the order they came.
const statOrder: readonly string[] = [
  "DAMAGE_PER_SECOND",
  "RESISTANCE0_NAME",
  "STRENGTH",
  "AGILITY",
  "STAMINA",
  "INTELLECT",
  "SPIRIT",
];

function statRank({ stat }: ItemStat): number {
  const rank = statOrder.indexOf(stat);
  return rank === -1 ? statOrder.length : rank;
}

// An item's slot, kind and stats, such as "Leather Waist · +4 Sta, +2 Spi", leaving out what it
// doesn't have.
export function itemDetails(item: ScannedItem): string {
  // The game names each resistance two ways, such as "NATURE_RESISTANCE" and "RESISTANCE3_NAME",
  // and lists both, so a stat that reads the same as one before it is left out.
  const stats = [
    ...new Set(
      item.stats.toSorted((a, b) => statRank(a) - statRank(b)).map((stat) => statText(stat)),
    ),
  ].join(", ");
  return [kindText(item), stats].filter((part) => part !== undefined && part !== "").join(" · ");
}
