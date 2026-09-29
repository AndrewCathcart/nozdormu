import { useTestDatabase } from "@nozdormu/db/testing";
import { describe, expect, it } from "vitest";
import { createDungeonStore } from "./dungeon-store.ts";
import type { Dungeon } from "./spyglass.ts";

const database = useTestDatabase();

// A made-up dungeon with two bosses, one with loot seen.
function dungeon(name: string, minLevel = 13): Dungeon {
  return {
    name,
    minLevel,
    maxLevel: minLevel + 5,
    requiredLevel: 10,
    bosses: [
      {
        name: "Made-up Warden",
        loot: [
          { itemId: 280_101, name: "Made-up Choker" },
          { itemId: 280_102, name: "Made-up Bracers" },
        ],
      },
      { name: "Made-up Tyrant", loot: [] },
    ],
  };
}

// Tests share one database, and each sync replaces every dungeon, so each test syncs and reads in
// one go rather than relying on another test's data.
describe("dungeon store", () => {
  it("stores the synced dungeons and gives one back by name, with the build", async () => {
    const store = createDungeonStore(database.db);

    await store.replaceAll("1.60.1.69913", [
      dungeon("The Made-up Hollow"),
      dungeon("Made-up Keep"),
    ]);

    expect(await store.get("The Made-up Hollow")).toEqual({
      ...dungeon("The Made-up Hollow"),
      build: "1.60.1.69913",
    });
  });

  it("drops a dungeon a later sync doesn't have", async () => {
    const store = createDungeonStore(database.db);
    await store.replaceAll("1.60.1.69913", [
      dungeon("The Made-up Hollow"),
      dungeon("Made-up Keep"),
    ]);

    await store.replaceAll("1.60.1.70009", [dungeon("Made-up Keep")]);

    expect(await store.get("The Made-up Hollow")).toBeUndefined();
  });

  it("finds dungeons whose name contains the text, names starting with it first", async () => {
    const store = createDungeonStore(database.db);
    await store.replaceAll("1.60.1.69913", [
      dungeon("The Made-up Hollow", 13),
      dungeon("Made-up Keep", 22),
      dungeon("Made-up Caverns", 17),
      dungeon("Other Crypts", 40),
    ]);

    expect(await store.search("made-up", 25)).toEqual([
      { name: "Made-up Caverns", minLevel: 17, maxLevel: 22 },
      { name: "Made-up Keep", minLevel: 22, maxLevel: 27 },
      { name: "The Made-up Hollow", minLevel: 13, maxLevel: 18 },
    ]);
  });

  it("returns at most the number of dungeons asked for", async () => {
    const store = createDungeonStore(database.db);
    await store.replaceAll("1.60.1.69913", [dungeon("Made-up Keep"), dungeon("Made-up Caverns")]);

    expect(await store.search("made-up", 1)).toHaveLength(1);
  });

  it("gives the build of the stored dungeons, or none before the first sync", async () => {
    const store = createDungeonStore(database.db);
    await store.replaceAll("1.60.1.69913", []);
    const before = await store.loadedBuild();

    await store.replaceAll("1.60.1.69913", [dungeon("Made-up Keep")]);

    expect([before, await store.loadedBuild()]).toEqual([undefined, "1.60.1.69913"]);
  });
});
