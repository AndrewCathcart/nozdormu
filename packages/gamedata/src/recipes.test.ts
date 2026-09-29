import { describe, expect, it } from "vitest";
import { parseRecipes, type RecipeTable } from "./recipes.ts";
import {
  csv,
  reagentHeader,
  reagentRow,
  skillLineAbilityHeader,
  spellEffectHeader,
} from "./test-tables.ts";

// Made-up tables holding one Blacksmithing recipe, in wago.tools' format (unused columns left out).
function tables(overrides: Partial<Record<RecipeTable, string>> = {}): Record<RecipeTable, string> {
  return {
    SkillLine: csv([
      ["ID", "DisplayName_lang", "CategoryID"],
      [164, "Blacksmithing", 11],
    ]),
    SkillLineAbility: csv([skillLineAbilityHeader, [1, 164, 900_001, 50, 100]]),
    SpellName: csv([
      ["ID", "Name_lang"],
      [900_001, "Made-up Sword of Testing"],
    ]),
    SpellEffect: csv([spellEffectHeader, [1, 900_001, 24, 270_001, 1]]),
    SpellReagents: csv([
      reagentHeader,
      reagentRow(1, 900_001, [
        [270_010, 3],
        [270_011, 1],
      ]),
    ]),
    ItemEffect: csv([["ID", "TriggerType", "SpellID"]]),
    ItemXItemEffect: csv([["ID", "ItemEffectID", "ItemID"]]),
    ...overrides,
  };
}

describe("parseRecipes", () => {
  it("reads a profession spell that makes an item as a recipe", () => {
    expect(parseRecipes(tables())).toEqual([
      {
        spellId: 900_001,
        name: "Made-up Sword of Testing",
        professions: ["Blacksmithing"],
        itemId: 270_001,
        itemCount: 1,
        reagents: [
          { itemId: 270_010, count: 3 },
          { itemId: 270_011, count: 1 },
        ],
        yellowAt: 50,
        greyAt: 100,
        taughtBy: [],
      },
    ]);
  });

  // The client stores 0 for recipes such as transmutes, which make one item.
  it("counts a recipe that makes 0 items as making 1", () => {
    const recipes = parseRecipes(
      tables({
        SpellEffect: csv([spellEffectHeader, [1, 900_001, 24, 270_001, 0]]),
      }),
    );

    expect(recipes.map((recipe) => recipe.itemCount)).toEqual([1]);
  });

  it("takes the item from the effect that makes it, ignoring the spell's other effects", () => {
    const recipes = parseRecipes(
      tables({
        SpellEffect: csv([spellEffectHeader, [1, 900_001, 24, 270_001, 1], [2, 900_001, 6, 0, 0]]),
      }),
    );

    expect(recipes.map((recipe) => [recipe.itemId, recipe.itemCount])).toEqual([[270_001, 1]]);
  });

  // Mages' Conjure spells make items too, from a class skill line (category 7).
  it("leaves out spells that aren't a profession's", () => {
    const recipes = parseRecipes(
      tables({
        SkillLine: csv([
          ["ID", "DisplayName_lang", "CategoryID"],
          [164, "Blacksmithing", 7],
        ]),
      }),
    );

    expect(recipes).toEqual([]);
  });

  // A recipe item has two effects: a "Learning" spell when used (trigger 0), and the recipe it
  // teaches (trigger 6).
  it("lists the recipe items that teach a recipe", () => {
    const recipes = parseRecipes(
      tables({
        ItemEffect: csv([
          ["ID", "TriggerType", "SpellID"],
          [10, 0, 483],
          [11, 6, 900_001],
          [12, 0, 900_001],
        ]),
        ItemXItemEffect: csv([
          ["ID", "ItemEffectID", "ItemID"],
          [1, 10, 270_100],
          [2, 11, 270_100],
          [3, 11, 270_101],
          [4, 12, 270_102],
        ]),
      }),
    );

    expect(recipes.map((recipe) => recipe.taughtBy)).toEqual([[270_100, 270_101]]);
  });

  it("reads a recipe on two professions, or twice on one, as one recipe", () => {
    const recipes = parseRecipes(
      tables({
        SkillLine: csv([
          ["ID", "DisplayName_lang", "CategoryID"],
          [164, "Blacksmithing", 11],
          [165, "Leatherworking", 11],
        ]),
        SkillLineAbility: csv([
          skillLineAbilityHeader,
          [1, 164, 900_001, 50, 100],
          [2, 165, 900_001, 50, 100],
          [3, 164, 900_001, 50, 100],
        ]),
      }),
    );

    expect(recipes.map((recipe) => [recipe.spellId, recipe.professions])).toEqual([
      [900_001, ["Blacksmithing", "Leatherworking"]],
    ]);
  });

  // "[DNT]" is Blizzard's "do not translate": internal skill lines players never see.
  it("leaves out Blizzard's internal test professions", () => {
    const recipes = parseRecipes(
      tables({
        SkillLine: csv([
          ["ID", "DisplayName_lang", "CategoryID"],
          [164, "Test Profession [DNT]", 11],
        ]),
      }),
    );

    expect(recipes).toEqual([]);
  });

  it("fails when a table doesn't have the columns it needs", () => {
    expect(() =>
      parseRecipes(
        tables({
          SpellReagents: csv([
            ["ID", "SpellID"],
            [1, 900_001],
          ]),
        }),
      ),
    ).toThrow("SpellReagents didn't have the expected columns.");
  });
});
