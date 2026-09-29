import type { Logger } from "@nozdormu/core";
import { describe, expect, it, vi } from "vitest";
import { createBuildCheckJob, type GameDataSource, type GameTable } from "./build-check.ts";
import type { GameDataStore } from "./game-data-store.ts";
import type { ItemRecord } from "./item-sparse.ts";
import type { RecipeRecord } from "./recipes.ts";
import { itemSparseCsv, recipeTablesCsv } from "./test-tables.ts";

const firstSword: ItemRecord = {
  id: 270_001,
  name: "Made-up Sword 1",
  quality: 3,
  itemLevel: 42,
  requiredLevel: 37,
  inventoryType: 13,
};

const firstSwordRecipe: RecipeRecord = {
  spellId: 900_001,
  name: "Made-up Sword 1",
  professions: ["Blacksmithing"],
  itemId: 270_001,
  itemCount: 1,
  reagents: [{ itemId: 270_500, count: 2 }],
  yellowAt: 10,
  greyAt: 20,
  taughtBy: [],
};

// A source whose builds have this many items and recipes.
function fakeTables(itemCount: number, recipeCount: number) {
  const recipeTables = recipeTablesCsv(recipeCount);
  return (name: GameTable): Promise<string> =>
    Promise.resolve(name === "ItemSparse" ? itemSparseCsv(itemCount) : recipeTables[name]);
}

// Downloads have 1,000 items and 1,000 recipes, the fewest the job accepts.
function createDeps(latest: string, imported?: string) {
  return {
    source: {
      latestBuild: vi.fn<GameDataSource["latestBuild"]>().mockResolvedValue(latest),
      table: vi.fn<GameDataSource["table"]>(fakeTables(1000, 1000)),
    },
    store: {
      importedVersion: vi.fn<GameDataStore["importedVersion"]>().mockResolvedValue(imported),
      replaceBuild: vi.fn<GameDataStore["replaceBuild"]>().mockResolvedValue(undefined),
    },
    logger: { info: vi.fn<Logger["info"]>() } satisfies Pick<Logger, "info">,
  };
}

describe("build check", () => {
  it("downloads a new Forever build's item and recipe tables", async () => {
    const deps = createDeps("1.60.1.70009", "1.60.1.69893");

    await createBuildCheckJob(deps).run();

    expect(deps.source.table.mock.calls.toSorted(([a], [b]) => a.localeCompare(b))).toEqual([
      ["ItemEffect", "1.60.1.70009"],
      ["ItemSparse", "1.60.1.70009"],
      ["ItemXItemEffect", "1.60.1.70009"],
      ["SkillLine", "1.60.1.70009"],
      ["SkillLineAbility", "1.60.1.70009"],
      ["SpellEffect", "1.60.1.70009"],
      ["SpellName", "1.60.1.70009"],
      ["SpellReagents", "1.60.1.70009"],
    ]);
  });

  it("imports the items of a new Forever build", async () => {
    const deps = createDeps("1.60.1.70009", "1.60.1.69893");

    await createBuildCheckJob(deps).run();

    expect(deps.store.replaceBuild).toHaveBeenCalledOnce();
    const build = deps.store.replaceBuild.mock.calls[0]?.[0];
    expect(build?.version).toBe("1.60.1.70009");
    const records = build?.items;
    expect(records).toHaveLength(1000);
    expect(records?.[0]).toEqual(firstSword);
    expect(records?.[999]?.name).toBe("Made-up Sword 1000");
  });

  it("imports the recipes of a new Forever build", async () => {
    const deps = createDeps("1.60.1.70009", "1.60.1.69893");

    await createBuildCheckJob(deps).run();

    const recipes = deps.store.replaceBuild.mock.calls[0]?.[0].recipes;
    expect(recipes).toHaveLength(1000);
    expect(recipes?.[0]).toEqual(firstSwordRecipe);
    expect(recipes?.[999]?.name).toBe("Made-up Sword 1000");
  });

  it("doesn't import a build it has already imported", async () => {
    const deps = createDeps("1.60.1.70009", "1.60.1.70009");

    await createBuildCheckJob(deps).run();

    expect(deps.store.replaceBuild).not.toHaveBeenCalled();
  });

  it("ignores a build that isn't Forever's", async () => {
    const deps = createDeps("5.5.0.62071", "1.60.1.70009");

    await createBuildCheckJob(deps).run();

    expect(deps.store.replaceBuild).not.toHaveBeenCalled();
  });

  it("fails without touching the stored data when a download fails", async () => {
    const deps = createDeps("1.60.1.70009", "1.60.1.69893");
    deps.source.table.mockRejectedValue(new Error("wago.tools answered HTTP 503."));

    await expect(createBuildCheckJob(deps).run()).rejects.toThrow("wago.tools answered HTTP 503.");

    expect(deps.store.replaceBuild).not.toHaveBeenCalled();
  });

  it("logs each import with its build, item count and recipe count", async () => {
    const deps = createDeps("1.60.1.70009", undefined);

    await createBuildCheckJob(deps).run();

    expect(deps.logger.info).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        event: "gamedata.imported",
        version: "1.60.1.70009",
        items: 1000,
        recipes: 1000,
      }),
      "Imported a new game build",
    );
  });

  it("refuses a build with fewer than 1,000 items, keeping the stored data", async () => {
    const deps = createDeps("1.60.1.70009", "1.60.1.69893");
    deps.source.table.mockImplementation(fakeTables(999, 1000));

    await expect(createBuildCheckJob(deps).run()).rejects.toThrow(
      "wago.tools gave only 999 items for build 1.60.1.70009, so the stored game data was kept.",
    );

    expect(deps.store.replaceBuild).not.toHaveBeenCalled();
  });

  it("refuses a build with fewer than 1,000 recipes, keeping the stored data", async () => {
    const deps = createDeps("1.60.1.70009", "1.60.1.69893");
    deps.source.table.mockImplementation(fakeTables(1000, 999));

    await expect(createBuildCheckJob(deps).run()).rejects.toThrow(
      "wago.tools gave only 999 recipes for build 1.60.1.70009, so the stored game data was kept.",
    );

    expect(deps.store.replaceBuild).not.toHaveBeenCalled();
  });

  it("logs a build it skips because it isn't Forever's", async () => {
    const deps = createDeps("5.5.0.62071", "1.60.1.70009");

    await createBuildCheckJob(deps).run();

    expect(deps.logger.info).toHaveBeenCalledExactlyOnceWith(
      { event: "gamedata.skipped_build", version: "5.5.0.62071" },
      "Skipped a build that isn't Forever's",
    );
  });

  it("accepts later Forever versions such as 1.70", async () => {
    const deps = createDeps("1.70.0.80000", "1.60.1.70009");

    await createBuildCheckJob(deps).run();

    expect(deps.store.replaceBuild.mock.calls[0]?.[0].version).toBe("1.70.0.80000");
  });
});
