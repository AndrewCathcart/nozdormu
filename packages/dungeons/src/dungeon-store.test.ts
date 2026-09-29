import { useTestDatabase } from "@nozdormu/db/testing";
import { describe, expect, it } from "vitest";
import { createDungeonStore } from "./dungeon-store.ts";
import type { ScannedItem } from "@nozdormu/gamedata";
import type { Dungeon, SpyglassData } from "./spyglass.ts";

const database = useTestDatabase();

function synced(
  build: string,
  dungeons: readonly Dungeon[],
  items: readonly ScannedItem[] = [],
): SpyglassData {
  return { build, dungeons, items };
}

// A made-up dungeon with two bosses, one with loot seen, and two quests, one scanned in full.
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
    quests: [
      {
        id: 90_101,
        name: "Made-up Errand",
        side: "Horde",
        className: "Warlock",
        requiredLevel: 12,
        xp: 1450,
        objective: "Bring 5 Made-up Fangs to a made-up trainer.",
        rewards: [{ itemId: 280_103, name: "Made-up Staff" }],
      },
      {
        id: 90_102,
        name: "Made-up Rumour",
        side: undefined,
        className: undefined,
        requiredLevel: undefined,
        xp: undefined,
        objective: undefined,
        rewards: [],
      },
    ],
  };
}

// Tests share one database, and each sync replaces every dungeon, so each test syncs and reads in
// one go rather than relying on another test's data.
describe("dungeon store", () => {
  it("stores the synced dungeons, with their bosses and quests, and gives one back by name", async () => {
    const store = createDungeonStore(database.db);

    await store.replaceAll(
      synced("1.60.1.69913", [dungeon("The Made-up Hollow"), dungeon("Made-up Keep")]),
    );

    expect(await store.get("The Made-up Hollow")).toEqual(dungeon("The Made-up Hollow"));
  });

  it("drops a dungeon a later sync doesn't have", async () => {
    const store = createDungeonStore(database.db);
    await store.replaceAll(
      synced("1.60.1.69913", [dungeon("The Made-up Hollow"), dungeon("Made-up Keep")]),
    );

    await store.replaceAll(synced("1.60.1.70009", [dungeon("Made-up Keep")]));

    expect(await store.get("The Made-up Hollow")).toBeUndefined();
  });

  it("lists every dungeon, lowest levels first", async () => {
    const store = createDungeonStore(database.db);
    await store.replaceAll(
      synced("1.60.1.69913", [
        dungeon("The Made-up Hollow", 13),
        dungeon("Made-up Keep", 22),
        dungeon("Made-up Caverns", 17),
      ]),
    );

    expect(await store.list()).toEqual([
      { name: "The Made-up Hollow", minLevel: 13, maxLevel: 18 },
      { name: "Made-up Caverns", minLevel: 17, maxLevel: 22 },
      { name: "Made-up Keep", minLevel: 22, maxLevel: 27 },
    ]);
  });

  it("gives the build the stored dungeons were scanned in", async () => {
    const store = createDungeonStore(database.db);

    await store.replaceAll(synced("1.60.1.69913", [dungeon("Made-up Keep")]));

    expect(await store.loadedBuild()).toBe("1.60.1.69913");
  });

  it("gives no build when no dungeons are stored", async () => {
    const store = createDungeonStore(database.db);

    await store.replaceAll(synced("1.60.1.69913", []));

    expect(await store.loadedBuild()).toBeUndefined();
  });

  it("gives each loot item's scanned details, where Spyglass has scanned it", async () => {
    const store = createDungeonStore(database.db);
    const choker: ScannedItem = {
      id: 280_101,
      name: "Made-up Choker",
      quality: 3,
      itemLevel: 18,
      requiredLevel: 13,
      itemClass: 4,
      itemSubclass: 0,
      slot: "INVTYPE_NECK",
      stats: [
        { stat: "STAMINA", value: 4 },
        { stat: "SPIRIT", value: 2 },
      ],
    };

    await store.replaceAll(synced("1.60.1.69913", [dungeon("The Made-up Hollow")], [choker]));

    const loot = (await store.get("The Made-up Hollow"))?.bosses[0]?.loot;
    expect(loot).toEqual([
      { itemId: 280_101, name: "Made-up Choker", scanned: choker },
      { itemId: 280_102, name: "Made-up Bracers", scanned: undefined },
    ]);
  });
});
