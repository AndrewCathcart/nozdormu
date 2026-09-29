// Made-up client tables in wago.tools' CSV format, for tests. Columns we don't read are left out.
import type { ClassSpellTable } from "./class-spells.ts";
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

// Made-up class spell tables with this many warrior spells: "Made-up Strike n" (spell 800000 + n,
// Rank 1) on Arms, a warrior-only specialisation line, learned at level n, wrapping round after 60.
export function classSpellTablesCsv(spellCount: number): Record<ClassSpellTable, string> {
  const numbers = Array.from({ length: spellCount }, (_, index) => index + 1);
  return {
    ChrRaces: csv([
      ["ID", "Name_lang", "PlayableRaceBit"],
      [1, "Human", 0],
    ]),
    CharBaseInfo: csv([
      ["ID", "RaceID", "ClassID"],
      [1, 1, 1],
    ]),
    SkillLine: csv([
      ["ID", "DisplayName_lang", "CategoryID", "Flags"],
      [26, "Arms", 7, 0x400],
    ]),
    SkillRaceClassInfo: csv([
      ["ID", "SkillID", "ClassMask"],
      [1, 26, 1],
    ]),
    SkillLineAbility: csv([
      ["ID", "SkillLine", "Spell", "ClassMask", "AcquireMethod", "RaceMasks_0"],
      ...numbers.map((n) => [10_000 + n, 26, 800_000 + n, 1, 0, 0]),
    ]),
    SpellName: csv([
      ["ID", "Name_lang"],
      ...numbers.map((n) => [800_000 + n, `Made-up Strike ${String(n)}`]),
    ]),
    Spell: csv([["ID", "NameSubtext_lang"], ...numbers.map((n) => [800_000 + n, "Rank 1"])]),
    SpellLevels: csv([
      ["ID", "DifficultyID", "BaseLevel", "SpellLevel", "SpellID"],
      ...numbers.map((n) => [n, 0, ((n - 1) % 60) + 1, ((n - 1) % 60) + 1, 800_000 + n]),
    ]),
    SpellMisc: csv([
      ["ID", "Attributes_0", "DifficultyID", "SpellID"],
      ...numbers.map((n) => [n, 0, 0, 800_000 + n]),
    ]),
    SpellEffect: csv([
      ["ID", "SpellID", "EffectTriggerSpell"],
      ...numbers.map((n) => [20_000 + n, 800_000 + n, 0]),
    ]),
    // One made-up talent, which isn't one of the class spells.
    Talent: csv([
      ["ID", ...Array.from({ length: 9 }, (_, rank) => `SpellRank_${String(rank)}`)],
      [1, 700_001, 0, 0, 0, 0, 0, 0, 0, 0],
    ]),
  };
}

// A made-up export's columns, and each row's values by column. Made-up values have no commas.
function readCsv(text: string): { header: string[]; rows: Map<string, string>[] } {
  const [header = "", ...lines] = text.split("\n");
  const columns = header.split(",");
  return {
    header: columns,
    rows: lines.map((line) => {
      const values = line.split(",");
      return new Map(columns.map((column, index) => [column, values[index] ?? "0"]));
    }),
  };
}

// Two made-up exports of the same table as one: the columns of both, with 0 where a row has none.
export function mergeCsv(first: string, second: string): string {
  const a = readCsv(first);
  const b = readCsv(second);
  const header = [...new Set([...a.header, ...b.header])];
  return csv([
    header,
    ...[...a.rows, ...b.rows].map((row) => header.map((column) => row.get(column) ?? "0")),
  ]);
}
