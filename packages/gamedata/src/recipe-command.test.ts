import { MessageFlags } from "discord-api-types/v10";
import { describe, expect, it, vi } from "vitest";
import type { GameDataStore } from "./game-data-store.ts";
import { createRecipeCommand } from "./recipe-command.ts";
import type { RecipeRecord } from "./recipes.ts";

const transmute: RecipeRecord = {
  spellId: 900_001,
  name: "Transmute: Made-up Metal",
  professions: ["Alchemy"],
  itemId: 270_001,
  itemCount: 1,
  reagents: [
    { itemId: 270_010, count: 1 },
    { itemId: 270_011, count: 2 },
  ],
  skillLevels: { yellowAt: 275, greyAt: 290 },
  taughtBy: [270_100],
};

const madeUpItemNames = new Map([
  [270_001, "Made-up Metal Bar"],
  [270_010, "Made-up Ore"],
  [270_011, "Made-up Crystal"],
  [270_012, "Made-up_Underscored_Dust"],
  [270_100, "Recipe: Transmute Made-up Metal"],
]);

function createFakeStore(recipes: readonly RecipeRecord[]) {
  return {
    importedBuild: vi
      .fn<GameDataStore["importedBuild"]>()
      .mockResolvedValue({ version: "1.60.1.70009", format: 2 }),
    getRecipe: vi.fn<GameDataStore["getRecipe"]>((spellId) =>
      Promise.resolve(recipes.find((recipe) => recipe.spellId === spellId)),
    ),
    searchRecipes: vi.fn<GameDataStore["searchRecipes"]>((text, limit) =>
      Promise.resolve(
        recipes
          .filter((recipe) => recipe.name.toLowerCase().includes(text.toLowerCase()))
          .slice(0, limit)
          .map(({ spellId, name, professions, skillLevels }) => ({
            spellId,
            name,
            professions,
            skillLevels,
          })),
      ),
    ),
    itemNames: vi.fn<GameDataStore["itemNames"]>((ids) =>
      Promise.resolve(new Map([...madeUpItemNames].filter(([id]) => ids.includes(id)))),
    ),
  } satisfies Pick<GameDataStore, "importedBuild" | "getRecipe" | "searchRecipes" | "itemNames">;
}

function invoke(name: string) {
  return { commandName: "recipe", options: new Map([["name", name]]) };
}

describe("/recipe", () => {
  it("replies with what the recipe makes, from what, its skill levels, where it's taught, and a link", async () => {
    const command = createRecipeCommand(createFakeStore([transmute]));

    expect(await command.handle(invoke("900001"))).toEqual({
      content: [
        "**Transmute: Made-up Metal** · Alchemy",
        "Makes 1 × Made-up Metal Bar",
        "Reagents: 1 × Made-up Ore, 2 × Made-up Crystal",
        "Turns yellow at 275 and grey at 290",
        "Taught by Recipe: Transmute Made-up Metal",
        "https://www.wowhead.com/forever/item=270001",
        "-# Recipe data from wago.tools",
      ].join("\n"),
      allowed_mentions: { parse: [] },
    });
  });

  it("leaves out reagents, skill levels and teachers the game data doesn't have", async () => {
    const bare = { ...transmute, reagents: [], skillLevels: undefined, taughtBy: [] };
    const command = createRecipeCommand(createFakeStore([bare]));

    const reply = await command.handle(invoke("900001"));

    expect(reply.content).toBe(
      [
        "**Transmute: Made-up Metal** · Alchemy",
        "Makes 1 × Made-up Metal Bar",
        "https://www.wowhead.com/forever/item=270001",
        "-# Recipe data from wago.tools",
      ].join("\n"),
    );
  });

  it("names an item the build doesn't have by its ID", async () => {
    const unknownReagent = { ...transmute, reagents: [{ itemId: 270_099, count: 3 }] };
    const command = createRecipeCommand(createFakeStore([unknownReagent]));

    const reply = await command.handle(invoke("900001"));

    expect(reply.content?.split("\n")[2]).toBe("Reagents: 3 × item 270099");
  });

  it("escapes Markdown in recipe and item names", async () => {
    const starred = { ...transmute, name: "Made-up *Starred* Brew", itemId: 270_012 };
    const command = createRecipeCommand(createFakeStore([starred]));

    const reply = await command.handle(invoke("900001"));

    expect(reply.content?.split("\n").slice(0, 2)).toEqual([
      String.raw`**Made-up \*Starred\* Brew** · Alchemy`,
      String.raw`Makes 1 × Made-up\_Underscored\_Dust`,
    ]);
  });

  it("looks up a typed name when no suggestion was picked", async () => {
    const command = createRecipeCommand(createFakeStore([transmute]));

    const reply = await command.handle(invoke("made-up metal"));

    expect(reply.content?.split("\n")[0]).toBe("**Transmute: Made-up Metal** · Alchemy");
  });

  it("replies privately when it can't find the recipe", async () => {
    const command = createRecipeCommand(createFakeStore([transmute]));

    expect(await command.handle(invoke("Nothing like this"))).toEqual({
      content:
        "I couldn't find that recipe. Start typing its name and pick one of the suggestions.",
      flags: MessageFlags.Ephemeral,
    });
  });

  it("replies privately to a blank name instead of looking it up", async () => {
    const command = createRecipeCommand(createFakeStore([transmute]));

    expect(await command.handle(invoke("  "))).toEqual({
      content:
        "I couldn't find that recipe. Start typing its name and pick one of the suggestions.",
      flags: MessageFlags.Ephemeral,
    });
  });

  it("suggests matching recipes, labelled with their professions and where they turn yellow, valued by their spell ID", async () => {
    const suit = {
      ...transmute,
      spellId: 900_002,
      name: "Made-up Ogre Suit",
      professions: ["Tailoring", "Leatherworking"],
      skillLevels: undefined,
    };
    const command = createRecipeCommand(createFakeStore([transmute, suit]));

    const choices = await command.autocomplete?.({
      commandName: "recipe",
      optionName: "name",
      value: "made-up",
    });

    expect(choices).toEqual([
      { name: "Transmute: Made-up Metal (Alchemy, yellow at 275)", value: "900001" },
      { name: "Made-up Ogre Suit (Tailoring or Leatherworking)", value: "900002" },
    ]);
  });

  it("suggests nothing until something is typed", async () => {
    const store = createFakeStore([transmute]);
    const command = createRecipeCommand(store);

    const choices = await command.autocomplete?.({
      commandName: "recipe",
      optionName: "name",
      value: " ",
    });

    expect(choices).toEqual([]);
    expect(store.searchRecipes).not.toHaveBeenCalled();
  });

  it("says the recipe data isn't loaded yet when no build has been imported", async () => {
    const store = createFakeStore([]);
    store.importedBuild.mockResolvedValue(undefined);
    const command = createRecipeCommand(store);

    expect(await command.handle(invoke("metal"))).toEqual({
      content: "I haven't loaded the recipe data yet. Try again in a minute.",
      flags: MessageFlags.Ephemeral,
    });
  });
});
