import { useTestDatabase } from "@nozdormu/db/testing";
import { describe, expect, it } from "vitest";
import type { ItemRecord } from "./item-sparse.ts";
import type { RecipeRecord } from "./recipes.ts";
import { createGameDataStore, type GameDataStore } from "./game-data-store.ts";

const database = useTestDatabase();

function item(id: number, name: string): ItemRecord {
  return { id, name, quality: 2, itemLevel: 20, requiredLevel: 15, inventoryType: 13 };
}

function importBuild(
  store: GameDataStore,
  version: string,
  items: ItemRecord[],
  recipes: RecipeRecord[] = [],
): Promise<void> {
  return store.replaceBuild({ version, items, recipes });
}

// A made-up recipe making item 1 from items 2 and 3.
function recipe(spellId: number, name: string): RecipeRecord {
  return {
    spellId,
    name,
    professions: ["Blacksmithing", "Leatherworking"],
    itemId: 1,
    itemCount: 2,
    reagents: [
      { itemId: 3, count: 4 },
      { itemId: 2, count: 1 },
    ],
    yellowAt: 50,
    greyAt: 100,
    taughtBy: [5, 4],
  };
}

describe("game data store", () => {
  it("stores an imported build's recipes and finds one by spell ID", async () => {
    const store = createGameDataStore(database.db);

    await importBuild(
      store,
      "1.60.1.1101",
      [item(1, "Made-up Sword")],
      [recipe(900_001, "Made-up Sword"), recipe(900_002, "Made-up Other Sword")],
    );

    expect(await store.getRecipe(900_002)).toEqual(recipe(900_002, "Made-up Other Sword"));
  });

  it("replaces the previous build's recipes", async () => {
    const store = createGameDataStore(database.db);
    await importBuild(store, "1.60.1.1102", [], [recipe(900_001, "Made-up Sword")]);

    await importBuild(store, "1.60.1.1103", [], [recipe(900_002, "Made-up Helm")]);

    expect([await store.getRecipe(900_001), await store.getRecipe(900_002)]).toEqual([
      undefined,
      recipe(900_002, "Made-up Helm"),
    ]);
  });

  it("finds recipes whose name contains the text, names starting with it first, then shorter ones", async () => {
    const store = createGameDataStore(database.db);
    await importBuild(
      store,
      "1.60.1.1105",
      [item(1, "Made-up Anvil")],
      [
        recipe(900_001, "Made-up Sword of Plenty"),
        recipe(900_002, "Made-up Sword"),
        recipe(900_003, "Sword-shaped Made-up Charm"),
        recipe(900_004, "Made-up Helm"),
      ],
    );

    const found = await store.searchRecipes("sword", 25);

    expect(found).toEqual([
      {
        spellId: 900_003,
        name: "Sword-shaped Made-up Charm",
        professions: ["Blacksmithing", "Leatherworking"],
      },
      { spellId: 900_002, name: "Made-up Sword", professions: ["Blacksmithing", "Leatherworking"] },
      {
        spellId: 900_001,
        name: "Made-up Sword of Plenty",
        professions: ["Blacksmithing", "Leatherworking"],
      },
    ]);
  });

  it("finds a recipe by the name of the item it makes", async () => {
    const store = createGameDataStore(database.db);
    await importBuild(
      store,
      "1.60.1.1106",
      [item(7, "Made-up Metal Bar")],
      [{ ...recipe(900_001, "Transmute: Made-up Metal"), itemId: 7 }],
    );

    const found = await store.searchRecipes("metal bar", 25);

    expect(found.map((match) => match.name)).toEqual(["Transmute: Made-up Metal"]);
  });

  it("leaves test and deprecated recipes out of searches", async () => {
    const store = createGameDataStore(database.db);
    await importBuild(
      store,
      "1.60.1.1107",
      [],
      [
        recipe(900_001, "Made-up Smelting"),
        recipe(900_002, "Made-up Smelting (Test)"),
        recipe(900_003, "Deprecated Made-up Smelting"),
      ],
    );

    const found = await store.searchRecipes("smelting", 25);

    expect(found.map((match) => match.name)).toEqual(["Made-up Smelting"]);
  });

  it("returns at most the number of recipes asked for", async () => {
    const store = createGameDataStore(database.db);
    await importBuild(
      store,
      "1.60.1.1108",
      [],
      Array.from({ length: 30 }, (_, index) =>
        recipe(900_001 + index, `Made-up Ring ${String(index + 1)}`),
      ),
    );

    expect(await store.searchRecipes("ring", 25)).toHaveLength(25);
  });

  it("gives the names of the items that exist, by ID", async () => {
    const store = createGameDataStore(database.db);
    await importBuild(store, "1.60.1.1104", [item(1, "Made-up Sword"), item(2, "Made-up Helm")]);

    const names = await store.itemNames([2, 1, 99]);

    expect([...names].toSorted(([a], [b]) => a - b)).toEqual([
      [1, "Made-up Sword"],
      [2, "Made-up Helm"],
    ]);
  });

  it("stores an imported build's items and finds one by ID", async () => {
    const store = createGameDataStore(database.db);

    await importBuild(store, "1.60.1.1001", [item(1, "Made-up Sword"), item(2, "Made-up Helm")]);

    expect(await store.getItem(2)).toEqual(item(2, "Made-up Helm"));
  });

  it("records which build it imported", async () => {
    const store = createGameDataStore(database.db);

    await importBuild(store, "1.60.1.1002", [item(1, "Made-up Sword")]);

    expect(await store.importedVersion()).toBe("1.60.1.1002");
  });

  it("replaces the previous build's items", async () => {
    const store = createGameDataStore(database.db);
    await importBuild(store, "1.60.1.1003", [item(1, "Made-up Sword"), item(2, "Made-up Helm")]);

    await importBuild(store, "1.60.1.1004", [item(2, "Made-up Helm, Renamed")]);

    expect([await store.getItem(1), await store.getItem(2)]).toEqual([
      undefined,
      item(2, "Made-up Helm, Renamed"),
    ]);
  });

  it("keeps the previous build when an import fails partway", async () => {
    const store = createGameDataStore(database.db);
    await importBuild(store, "1.60.1.1005", [item(1, "Made-up Sword")]);

    await expect(
      importBuild(store, "1.60.1.1006", [
        item(7, "Made-up Duplicate"),
        item(7, "Made-up Duplicate"),
      ]),
    ).rejects.toThrow("Failed query");

    expect([await store.importedVersion(), await store.getItem(1)]).toEqual([
      "1.60.1.1005",
      item(1, "Made-up Sword"),
    ]);
  });

  it("finds items whose name contains the text, names starting with it first, then shorter ones", async () => {
    const store = createGameDataStore(database.db);
    await importBuild(store, "1.60.1.1007", [
      item(1, "Made-up Sword of Testing"),
      item(2, "Made-up Sword"),
      item(3, "Sword-shaped Made-up Charm"),
      item(4, "Made-up Helm"),
    ]);

    const found = await store.searchItems("sword", 25);

    expect(found.map((match) => match.name)).toEqual([
      "Sword-shaped Made-up Charm",
      "Made-up Sword",
      "Made-up Sword of Testing",
    ]);
  });

  it("returns at most the number of items asked for", async () => {
    const store = createGameDataStore(database.db);
    await importBuild(
      store,
      "1.60.1.1008",
      Array.from({ length: 30 }, (_, index) =>
        item(index + 1, `Made-up Ring ${String(index + 1)}`),
      ),
    );

    expect(await store.searchItems("ring", 25)).toHaveLength(25);
  });

  it("matches % and _ in the text literally", async () => {
    const store = createGameDataStore(database.db);
    await importBuild(store, "1.60.1.1009", [
      item(1, "Made-up 50% Potion"),
      item(2, "Made-up Elixir"),
    ]);

    const found = await store.searchItems("%", 25);

    expect(found.map((match) => match.name)).toEqual(["Made-up 50% Potion"]);
  });

  it("leaves deprecated, test and placeholder items out of searches", async () => {
    const store = createGameDataStore(database.db);
    await importBuild(store, "1.60.1.1010", [
      item(1, "Made-up Blade"),
      item(2, "Made-up Blade DEPRECATED"),
      item(3, "Made-up Blade (Test)"),
      item(4, "Test Made-up Blade"),
      item(5, "[PH] Made-up Blade"),
      item(6, "Made-up Blade (OLD)"),
      item(7, "Unused Made-up Blade"),
      item(8, "Made-up Bladetester"),
    ]);

    const found = await store.searchItems("blade", 25);

    expect(found.map((match) => match.name)).toEqual(["Made-up Blade", "Made-up Bladetester"]);
  });

  it("finds high-test fishing line, whose name only looks like a test item's", async () => {
    const store = createGameDataStore(database.db);
    await importBuild(store, "1.60.1.1010", [item(1, "Made-up High Test Fishing Line")]);

    const found = await store.searchItems("fishing line", 25);

    expect(found.map((match) => match.name)).toEqual(["Made-up High Test Fishing Line"]);
  });
});
