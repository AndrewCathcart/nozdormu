import { MessageFlags } from "discord-api-types/v10";
import { describe, expect, it, vi } from "vitest";
import type { GameDataStore } from "./game-data-store.ts";
import { createMatsCommand } from "./mats-command.ts";
import type { RecipeRecord } from "./recipes.ts";

// Made-up items and recipes: a gizmo made from tubes, bars and a gem; tubes made from bars; bars
// smelted from ore.
const gizmo = 280_001;
const tube = 280_002;
const bar = 280_003;
const ore = 280_004;
const gem = 280_005;

const madeUpItemNames = new Map([
  [gizmo, "Made-up Gizmo"],
  [tube, "Made-up Tube"],
  [bar, "Made-up Bar"],
  [ore, "Made-up Ore"],
  [gem, "Made-up Gem"],
]);

function recipe(
  spellId: number,
  name: string,
  profession: string,
  makes: { readonly itemId: number; readonly count: number },
  reagents: RecipeRecord["reagents"],
): RecipeRecord {
  return {
    spellId,
    name,
    professions: [profession],
    result: { kind: "item", ...makes },
    reagents,
    skillLevels: { yellowAt: 100, greyAt: 125 },
    taughtBy: [],
  };
}

const makeGizmo = recipe(910_001, "Made-up Gizmo", "Engineering", { itemId: gizmo, count: 1 }, [
  { itemId: tube, count: 2 },
  { itemId: bar, count: 3 },
  { itemId: gem, count: 1 },
]);
const makeTube = recipe(910_002, "Made-up Tube", "Engineering", { itemId: tube, count: 1 }, [
  { itemId: bar, count: 2 },
]);
const smeltBar = recipe(910_003, "Smelt Made-up Bar", "Mining", { itemId: bar, count: 1 }, [
  { itemId: ore, count: 1 },
]);

// An in-memory game database holding these recipes.
function createFakeStore(recipes: readonly RecipeRecord[]) {
  return {
    importedBuild: vi
      .fn<GameDataStore["importedBuild"]>()
      .mockResolvedValue({ version: "1.60.1.70009", format: 4 }),
    getRecipe: vi.fn<GameDataStore["getRecipe"]>((spellId) =>
      Promise.resolve(recipes.find((found) => found.spellId === spellId)),
    ),
    recipesMaking: vi.fn<GameDataStore["recipesMaking"]>((itemIds) =>
      Promise.resolve(
        recipes.filter(
          (found) => found.result.kind === "item" && itemIds.includes(found.result.itemId),
        ),
      ),
    ),
    searchRecipes: vi.fn<GameDataStore["searchRecipes"]>((text, limit) =>
      Promise.resolve(
        recipes
          .filter((found) => found.name.toLowerCase().includes(text.toLowerCase()))
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
  } satisfies Pick<
    GameDataStore,
    "importedBuild" | "getRecipe" | "recipesMaking" | "searchRecipes" | "itemNames"
  >;
}

function invoke(name: string, times?: number) {
  return {
    commandName: "mats",
    options: new Map<string, string | number>([
      ["recipe", name],
      ...(times === undefined ? [] : [["times", times] as const]),
    ]),
  };
}

describe("/mats", () => {
  it("totals the raw materials, breaking crafted ones down, and lists what's made on the way", async () => {
    const command = createMatsCommand(createFakeStore([makeGizmo, makeTube, smeltBar]));

    const reply = await command.handle(invoke(String(makeGizmo.spellId)));

    expect(reply).toEqual({
      content: [
        "**Mats for 1 × Made-up Gizmo** · Engineering",
        "You'll need:",
        "- 7 × Made-up Ore",
        "- 1 × Made-up Gem",
        "Made along the way, in order:",
        "- 7 × Made-up Bar",
        "- 2 × Made-up Tube",
        "https://www.wowhead.com/forever/item=280001",
        "-# Transmutes and leather grade-ups aren't broken down.",
      ].join("\n"),
      allowed_mentions: { parse: [] },
    });
  });

  it("multiplies everything by the times asked for", async () => {
    const command = createMatsCommand(createFakeStore([makeGizmo, makeTube, smeltBar]));

    const reply = await command.handle(invoke(String(makeGizmo.spellId), 3));

    expect(reply.content?.split("\n").slice(0, 7)).toEqual([
      "**Mats for 3 × Made-up Gizmo** · Engineering",
      "You'll need:",
      "- 21 × Made-up Ore",
      "- 3 × Made-up Gem",
      "Made along the way, in order:",
      "- 21 × Made-up Bar",
      "- 6 × Made-up Tube",
    ]);
  });

  it("doesn't break down what a transmute makes, since it's usually gathered", async () => {
    const transmuteGem = recipe(
      910_004,
      "Transmute: Made-up Gem",
      "Alchemy",
      { itemId: gem, count: 1 },
      [{ itemId: ore, count: 1 }],
    );
    const command = createMatsCommand(
      createFakeStore([makeGizmo, makeTube, smeltBar, transmuteGem]),
    );

    const reply = await command.handle(invoke(String(makeGizmo.spellId)));

    expect(reply.content?.split("\n").slice(1, 4)).toEqual([
      "You'll need:",
      "- 7 × Made-up Ore",
      "- 1 × Made-up Gem",
    ]);
  });

  it("doesn't break down leather a leatherworker can make from a lower grade", async () => {
    const heavyLeather = 280_006;
    const mediumLeather = 280_007;
    const makeBoots = recipe(
      910_005,
      "Made-up Boots",
      "Leatherworking",
      { itemId: 280_008, count: 1 },
      [{ itemId: heavyLeather, count: 4 }],
    );
    const upgradeLeather = recipe(
      910_006,
      "Heavy Leather",
      "Leatherworking",
      { itemId: heavyLeather, count: 1 },
      [{ itemId: mediumLeather, count: 5 }],
    );
    const command = createMatsCommand(createFakeStore([makeBoots, upgradeLeather]));

    const reply = await command.handle(invoke(String(makeBoots.spellId)));

    expect(reply.content?.split("\n").slice(1, 3)).toEqual(["You'll need:", "- 4 × item 280006"]);
  });

  it("doesn't break down an item two recipes make, rather than guess which", async () => {
    const otherTube = recipe(
      910_007,
      "Made-up Tube, Other Way",
      "Engineering",
      { itemId: tube, count: 1 },
      [{ itemId: gem, count: 1 }],
    );
    const command = createMatsCommand(createFakeStore([makeGizmo, makeTube, otherTube, smeltBar]));

    const reply = await command.handle(invoke(String(makeGizmo.spellId)));

    expect(reply.content?.split("\n").slice(1, 7)).toEqual([
      "You'll need:",
      "- 2 × Made-up Tube",
      "- 3 × Made-up Ore",
      "- 1 × Made-up Gem",
      "Made along the way, in order:",
      "- 3 × Made-up Bar",
    ]);
  });

  it("doesn't break down an item whose breakdown would need itself", async () => {
    const oreFromBars = recipe(910_008, "Made-up Ore", "Alchemy", { itemId: ore, count: 1 }, [
      { itemId: bar, count: 2 },
    ]);
    const command = createMatsCommand(
      createFakeStore([makeGizmo, makeTube, smeltBar, oreFromBars]),
    );

    const reply = await command.handle(invoke(String(makeGizmo.spellId)));

    expect(reply.content?.split("\n").slice(1, 6)).toEqual([
      "You'll need:",
      "- 7 × Made-up Bar",
      "- 1 × Made-up Gem",
      "Made along the way, in order:",
      "- 2 × Made-up Tube",
    ]);
  });

  it("names an enchant by its recipe and links its spell, since it makes no item", async () => {
    const enchant: RecipeRecord = {
      ...recipe(910_009, "Enchant Made-up Bracer", "Enchanting", { itemId: 0, count: 1 }, [
        { itemId: gem, count: 2 },
      ]),
      result: { kind: "enchant" },
    };
    const command = createMatsCommand(createFakeStore([enchant]));

    const reply = await command.handle(invoke(String(enchant.spellId), 2));

    expect(reply.content?.split("\n")).toEqual([
      "**Mats for Enchant Made-up Bracer, 2 times** · Enchanting",
      "You'll need:",
      "- 4 × Made-up Gem",
      "https://www.wowhead.com/forever/spell=910009",
      "-# Transmutes and leather grade-ups aren't broken down.",
    ]);
  });

  it("says so privately when there's no such recipe", async () => {
    const command = createMatsCommand(createFakeStore([makeGizmo]));

    const reply = await command.handle(invoke("Made-up Nothing"));

    expect(reply).toEqual({
      content:
        "I couldn't find that recipe. Start typing its name and pick one of the suggestions.",
      flags: MessageFlags.Ephemeral,
    });
  });

  it("suggests recipes as you type, with their profession", async () => {
    const command = createMatsCommand(createFakeStore([makeGizmo, makeTube, smeltBar]));

    const choices = await command.autocomplete?.({
      commandName: "mats",
      optionName: "recipe",
      value: "made-up t",
    });

    expect(choices).toEqual([
      { name: "Made-up Tube (Engineering, yellow at 100)", value: "910002" },
    ]);
  });

  it("crafts it once when given a number of times Discord shouldn't allow", async () => {
    const command = createMatsCommand(createFakeStore([makeGizmo, makeTube, smeltBar]));

    const reply = await command.handle(invoke(String(makeGizmo.spellId), 1000));

    expect(reply.content?.split("\n")[0]).toBe("**Mats for 1 × Made-up Gizmo** · Engineering");
  });

  it("crafts a recipe that makes several at once only as often as the whole list needs", async () => {
    // Both the gizmo and each tube need a bar, and one smelt makes 5 bars: 3 tubes and the gizmo
    // need 4, so one smelt will do.
    const makeFiveBars: RecipeRecord = {
      ...smeltBar,
      result: { kind: "item", itemId: bar, count: 5 },
    };
    const tubeFromOneBar = { ...makeTube, reagents: [{ itemId: bar, count: 1 }] };
    const gizmoFromTubes = {
      ...makeGizmo,
      reagents: [
        { itemId: tube, count: 3 },
        { itemId: bar, count: 1 },
      ],
    };
    const command = createMatsCommand(
      createFakeStore([gizmoFromTubes, tubeFromOneBar, makeFiveBars]),
    );

    const reply = await command.handle(invoke(String(makeGizmo.spellId)));

    expect(reply.content?.split("\n").slice(1, 6)).toEqual([
      "You'll need:",
      "- 1 × Made-up Ore",
      "Made along the way, in order:",
      "- 5 × Made-up Bar",
      "- 3 × Made-up Tube",
    ]);
  });
});
