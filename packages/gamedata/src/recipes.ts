import { z } from "zod";
import { decimal, readTable, wholeNumber } from "./csv.ts";

// The client tables a build's recipes are read from.
export type RecipeTable =
  | "SkillLine"
  | "SkillLineAbility"
  | "SpellName"
  | "SpellEffect"
  | "SpellReagents"
  | "ItemEffect"
  | "ItemXItemEffect";

// The skill levels where a recipe stops being orange and turns yellow, then grey.
export interface SkillLevels {
  readonly yellowAt: number;
  readonly greyAt: number;
}

export interface Reagent {
  readonly itemId: number;
  readonly count: number;
}

// A profession spell that makes an item.
export interface RecipeRecord {
  readonly spellId: number;
  readonly name: string;
  // Usually one; a few recipes belong to two professions.
  readonly professions: readonly string[];
  readonly itemId: number;
  readonly itemCount: number;
  readonly reagents: readonly Reagent[];
  // Undefined where the game data has none.
  readonly skillLevels: SkillLevels | undefined;
  // Recipe items (patterns, plans, formulas...) that teach it.
  readonly taughtBy: readonly number[];
}

const skillLineRow = z.object({
  ID: wholeNumber,
  DisplayName_lang: z.string(),
  CategoryID: wholeNumber,
});

// SkillLine categories: 11 is professions, 9 is secondary skills such as Cooking and First Aid.
const professionCategories: ReadonlySet<number> = new Set([9, 11]);

const skillLineAbilityRow = z.object({
  SkillLine: wholeNumber,
  Spell: wholeNumber,
  TrivialSkillLineRankLow: wholeNumber,
  TrivialSkillLineRankHigh: wholeNumber,
});

const spellNameRow = z.object({ ID: wholeNumber, Name_lang: z.string() });

const spellEffectRow = z.object({
  SpellID: wholeNumber,
  Effect: wholeNumber,
  EffectItemType: wholeNumber,
  EffectBasePointsF: decimal,
});

const spellReagentsRow = z.object({
  SpellID: wholeNumber,
  Reagent_0: wholeNumber,
  Reagent_1: wholeNumber,
  Reagent_2: wholeNumber,
  Reagent_3: wholeNumber,
  Reagent_4: wholeNumber,
  Reagent_5: wholeNumber,
  Reagent_6: wholeNumber,
  Reagent_7: wholeNumber,
  ReagentCount_0: wholeNumber,
  ReagentCount_1: wholeNumber,
  ReagentCount_2: wholeNumber,
  ReagentCount_3: wholeNumber,
  ReagentCount_4: wholeNumber,
  ReagentCount_5: wholeNumber,
  ReagentCount_6: wholeNumber,
  ReagentCount_7: wholeNumber,
});

const itemEffectRow = z.object({ ID: wholeNumber, TriggerType: wholeNumber, SpellID: wholeNumber });

const itemXItemEffectRow = z.object({ ItemEffectID: wholeNumber, ItemID: wholeNumber });

// SpellEffect's Effect for "create an item".
const createItemEffect = 24;

// ItemEffect's TriggerType for "teaches this spell".
const learnSpellTrigger = 6;

// The items that teach each spell, by spell ID.
function teachingItems(tables: Readonly<Record<RecipeTable, string>>): Map<number, number[]> {
  const taughtSpells = new Map(
    readTable("ItemEffect", tables.ItemEffect, itemEffectRow)
      .filter((effect) => effect.TriggerType === learnSpellTrigger)
      .map((effect) => [effect.ID, effect.SpellID]),
  );
  const teachers = new Map<number, number[]>();
  for (const link of readTable("ItemXItemEffect", tables.ItemXItemEffect, itemXItemEffectRow)) {
    const spellId = taughtSpells.get(link.ItemEffectID);
    if (spellId !== undefined) {
      teachers.set(spellId, [...(teachers.get(spellId) ?? []), link.ItemID]);
    }
  }
  return teachers;
}

// A SpellReagents row's reagents, in order, without the empty slots.
function reagentsOf(row: z.output<typeof spellReagentsRow>): Reagent[] {
  const slots: [number, number][] = [
    [row.Reagent_0, row.ReagentCount_0],
    [row.Reagent_1, row.ReagentCount_1],
    [row.Reagent_2, row.ReagentCount_2],
    [row.Reagent_3, row.ReagentCount_3],
    [row.Reagent_4, row.ReagentCount_4],
    [row.Reagent_5, row.ReagentCount_5],
    [row.Reagent_6, row.ReagentCount_6],
    [row.Reagent_7, row.ReagentCount_7],
  ];
  return slots.filter(([itemId]) => itemId !== 0).map(([itemId, count]) => ({ itemId, count }));
}

// Reads the recipes from a build's client tables, as CSV.
export function parseRecipes(tables: Readonly<Record<RecipeTable, string>>): RecipeRecord[] {
  const skillLines = new Map(
    readTable("SkillLine", tables.SkillLine, skillLineRow)
      .filter(
        (line) =>
          professionCategories.has(line.CategoryID) && !line.DisplayName_lang.includes("[DNT]"),
      )
      .map((line) => [line.ID, line]),
  );
  const spellNames = new Map(
    readTable("SpellName", tables.SpellName, spellNameRow).map((row) => [row.ID, row.Name_lang]),
  );
  const itemsMade = new Map(
    readTable("SpellEffect", tables.SpellEffect, spellEffectRow)
      .filter((effect) => effect.Effect === createItemEffect && effect.EffectItemType !== 0)
      .map((effect) => [effect.SpellID, effect]),
  );
  const reagents = new Map(
    readTable("SpellReagents", tables.SpellReagents, spellReagentsRow).map((row) => [
      row.SpellID,
      reagentsOf(row),
    ]),
  );

  const teachers = teachingItems(tables);

  // By spell ID. The first ability of a spell gives its skill levels.
  const recipes = new Map<number, RecipeRecord>();
  for (const ability of readTable(
    "SkillLineAbility",
    tables.SkillLineAbility,
    skillLineAbilityRow,
  )) {
    const profession = skillLines.get(ability.SkillLine);
    const made = itemsMade.get(ability.Spell);
    const name = spellNames.get(ability.Spell);
    if (profession === undefined || made === undefined || name === undefined) {
      continue;
    }
    const existing = recipes.get(ability.Spell);
    if (existing !== undefined) {
      if (!existing.professions.includes(profession.DisplayName_lang)) {
        recipes.set(ability.Spell, {
          ...existing,
          professions: [...existing.professions, profession.DisplayName_lang],
        });
      }
      continue;
    }
    recipes.set(ability.Spell, {
      spellId: ability.Spell,
      name,
      professions: [profession.DisplayName_lang],
      itemId: made.EffectItemType,
      // Like the game server, treat a count below 1 as 1.
      itemCount: Math.max(1, Math.round(made.EffectBasePointsF)),
      reagents: reagents.get(ability.Spell) ?? [],
      // The game data has 0 for "none".
      skillLevels:
        ability.TrivialSkillLineRankHigh > 0
          ? { yellowAt: ability.TrivialSkillLineRankLow, greyAt: ability.TrivialSkillLineRankHigh }
          : undefined,
      taughtBy: teachers.get(ability.Spell) ?? [],
    });
  }
  return [...recipes.values()];
}
