// Made-up client tables in wago.tools' CSV format, for tests. Columns we don't read are left out.
import type { RecipeTable } from "./recipes.ts";

export function csv(rows: readonly (readonly (number | string)[])[]): string {
  return rows.map((row) => row.join(",")).join("\n");
}

// A made-up ItemSparse export: swords numbered from 1, with IDs from 270001.
export function itemSparseCsv(itemCount: number): string {
  return csv([
    ["ID", "Display_lang", "ItemLevel", "OverallQualityID", "RequiredLevel", "InventoryType"],
    ...Array.from({ length: itemCount }, (_, index) => [
      270_001 + index,
      `Made-up Sword ${String(index + 1)}`,
      42,
      3,
      37,
      13,
    ]),
  ]);
}

export const skillLineAbilityHeader = [
  "ID",
  "SkillLine",
  "Spell",
  "TrivialSkillLineRankLow",
  "TrivialSkillLineRankHigh",
];

export const spellEffectHeader = ["ID", "SpellID", "Effect", "EffectItemType", "EffectBasePointsF"];

export const reagentHeader = [
  "ID",
  "SpellID",
  ...Array.from({ length: 8 }, (_, index) => `Reagent_${String(index)}`),
  ...Array.from({ length: 8 }, (_, index) => `ReagentCount_${String(index)}`),
];

// One SpellReagents row: up to 8 reagents, padded with zeros like the real table.
export function reagentRow(
  id: number,
  spellId: number,
  reagents: readonly (readonly [number, number])[],
): number[] {
  const items = Array.from({ length: 8 }, (_, index) => reagents[index]?.[0] ?? 0);
  const counts = Array.from({ length: 8 }, (_, index) => reagents[index]?.[1] ?? 0);
  return [id, spellId, ...items, ...counts];
}

// Made-up recipe tables with this many Blacksmithing recipes: "Made-up Sword n" (spell 900000 + n)
// makes one of item 270000 + n from 2 of item 270500. Yellow at 10, grey at 20, and taught by
// trainers only.
export function recipeTablesCsv(recipeCount: number): Record<RecipeTable, string> {
  const numbers = Array.from({ length: recipeCount }, (_, index) => index + 1);
  return {
    SkillLine: csv([
      ["ID", "DisplayName_lang", "CategoryID"],
      [164, "Blacksmithing", 11],
    ]),
    SkillLineAbility: csv([
      skillLineAbilityHeader,
      ...numbers.map((n) => [n, 164, 900_000 + n, 10, 20]),
    ]),
    SpellName: csv([
      ["ID", "Name_lang"],
      ...numbers.map((n) => [900_000 + n, `Made-up Sword ${String(n)}`]),
    ]),
    SpellEffect: csv([
      spellEffectHeader,
      ...numbers.map((n) => [n, 900_000 + n, 24, 270_000 + n, 1]),
    ]),
    SpellReagents: csv([
      reagentHeader,
      ...numbers.map((n) => reagentRow(n, 900_000 + n, [[270_500, 2]])),
    ]),
    // Item 270001 has an on-use effect (trigger 0), which teaches nothing.
    ItemEffect: csv([
      ["ID", "TriggerType", "SpellID"],
      [1, 0, 483],
    ]),
    ItemXItemEffect: csv([
      ["ID", "ItemEffectID", "ItemID"],
      [1, 1, 270_001],
    ]),
  };
}
