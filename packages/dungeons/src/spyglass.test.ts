import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createSpyglassReader } from "./spyglass.ts";

const listing =
  "https://data.jsdelivr.com/v1/packages/gh/Karl-HeinzSchneider/WoW-Spyglass@main?structure=flat";
const data =
  "https://raw.githubusercontent.com/Karl-HeinzSchneider/WoW-Spyglass/main/.contribute/data";

// A made-up dungeon file in Spyglass's shape.
const madeUpHollow = {
  map: 9001,
  name: "The Made-up Hollow",
  minLevel: 13,
  maxLevel: 18,
  requiredLevel: 10,
  zone: 1,
  encounters: [
    {
      id: 5001,
      name: "Made-up Warden",
      portrait: "Interface\\AddOns\\Spyglass\\assets\\bosses\\made_up_warden.blp",
      level: 16,
      loot: [
        { item: 280_101, name: "Made-up Choker" },
        { item: 280_102, name: "Made-up Bracers" },
      ],
    },
    { id: 5002, name: "Made-up Tyrant", loot: [] },
  ],
  trash: [{ item: 280_199, name: "Made-up Trash Boots" }],
  quests: [],
};

// A dungeon Forever doesn't have: Spyglass lists it without a level range.
const leftoverDungeon = {
  map: 9002,
  name: "Made-up Leftover Crypts",
  encounters: [{ id: 5003, name: "Made-up Ghost", loot: [] }],
  trash: [],
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

// The address a fetch asked for.
function urlOf(input: string | URL | Request): string {
  return input instanceof Request ? input.url : input instanceof URL ? input.href : input;
}

// Answers Spyglass's config, the listing of its repository's files (these data files, by path under
// its data folder, and one that isn't data) and each data file.
function createFakeFetch(files: Readonly<Record<string, unknown>>) {
  return vi.fn<typeof fetch>((input) => {
    const url = urlOf(input);
    if (url === `${data}/config.json`) {
      return Promise.resolve(json({ build: "1.60.1.69913", itemsPerFile: 2500 }));
    }
    if (url === listing) {
      return Promise.resolve(
        json({
          files: [
            { name: "/README.md" },
            ...Object.keys(files).map((path) => ({ name: `/.contribute/data/${path}` })),
          ],
        }),
      );
    }
    const path = url.startsWith(`${data}/`) ? url.slice(`${data}/`.length) : "";
    return Promise.resolve(
      path in files ? json(files[path]) : new Response("Not found", { status: 404 }),
    );
  });
}

describe("createSpyglassReader", () => {
  it("reads Forever's dungeons with their levels and their bosses' loot, and the build", async () => {
    const fetch = createFakeFetch({ "dungeons/the_made_up_hollow.json": madeUpHollow });

    expect(await createSpyglassReader({ fetch })()).toEqual({
      build: "1.60.1.69913",
      dungeons: [
        {
          name: "The Made-up Hollow",
          minLevel: 13,
          maxLevel: 18,
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
          quests: [],
        },
      ],
      items: [],
    });
  });

  it("reads each dungeon's quests, with whatever has been scanned of each", async () => {
    const fetch = createFakeFetch({
      "dungeons/the_made_up_hollow.json": {
        ...madeUpHollow,
        quests: [
          {
            id: 90_101,
            name: "Made-up Errand",
            side: "Horde",
            class: "Warlock",
            requiredLevel: 12,
            xp: 1450,
            objective: "Bring 5 Made-up Fangs to a made-up trainer.",
            items: [{ item: 280_103, name: "Made-up Staff" }],
          },
          { id: 90_102, name: "Made-up Rumour" },
        ],
      },
    });

    const { dungeons } = await createSpyglassReader({ fetch })();

    expect(dungeons[0]?.quests).toEqual([
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
    ]);
  });

  it("reads the items it has scanned, with their kind and stats", async () => {
    const fetch = createFakeFetch({
      "items/items_280000.json": {
        "280101": {
          names: { enUS: "Made-up Choker" },
          quality: 3,
          itemLevel: 18,
          reqLevel: 13,
          classID: 4,
          subclassID: 0,
          slot: "INVTYPE_NECK",
          stats: { STAMINA: 4, SPIRIT: 2 },
        },
        "280102": {
          names: { enUS: "Made-up Pebble" },
          quality: 0,
          itemLevel: 1,
          reqLevel: 0,
          classID: 15,
          subclassID: 0,
          slot: "INVTYPE_NON_EQUIP_IGNORE",
        },
      },
    });

    const { items } = await createSpyglassReader({ fetch })();

    expect(items).toEqual([
      {
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
      },
      {
        id: 280_102,
        name: "Made-up Pebble",
        quality: 0,
        itemLevel: 1,
        requiredLevel: 0,
        itemClass: 15,
        itemSubclass: 0,
        slot: "INVTYPE_NON_EQUIP_IGNORE",
        stats: [],
      },
    ]);
  });

  it("leaves out dungeons without a level range, which Forever doesn't have", async () => {
    const fetch = createFakeFetch({
      "dungeons/made_up_leftover_crypts.json": leftoverDungeon,
      "dungeons/the_made_up_hollow.json": madeUpHollow,
    });

    const { dungeons } = await createSpyglassReader({ fetch })();

    expect(dungeons.map((dungeon) => dungeon.name)).toEqual(["The Made-up Hollow"]);
  });

  it("gives no entry level for a dungeon that doesn't say", async () => {
    const { requiredLevel: _, ...withoutEntryLevel } = madeUpHollow;
    const fetch = createFakeFetch({ "dungeons/the_made_up_hollow.json": withoutEntryLevel });

    const { dungeons } = await createSpyglassReader({ fetch })();

    expect(dungeons[0]?.requiredLevel).toBeUndefined();
  });

  it("reads only the listing's dungeon files", async () => {
    const fetch = createFakeFetch({
      "dungeons/.gitkeep": {},
      "dungeons/the_made_up_hollow.json": madeUpHollow,
    });

    await createSpyglassReader({ fetch })();

    expect(fetch.mock.calls.map(([input]) => urlOf(input))).toEqual([
      `${data}/config.json`,
      listing,
      `${data}/dungeons/the_made_up_hollow.json`,
    ]);
  });

  it("drops quest details it can't read, and quests without an ID and name, keeping the rest", async () => {
    const fetch = createFakeFetch({
      "dungeons/the_made_up_hollow.json": {
        ...madeUpHollow,
        quests: [
          { id: 90_101, name: "Made-up Errand", side: "Neutral", xp: null, objective: 5 },
          { name: "Made-up Nameless Errand Without An ID" },
          { id: 90_103, name: "Made-up Rumour", items: "none" },
        ],
      },
    });

    const { dungeons } = await createSpyglassReader({ fetch })();

    expect(dungeons[0]?.quests).toEqual([
      {
        id: 90_101,
        name: "Made-up Errand",
        side: undefined,
        className: undefined,
        requiredLevel: undefined,
        xp: undefined,
        objective: undefined,
        rewards: [],
      },
      {
        id: 90_103,
        name: "Made-up Rumour",
        side: undefined,
        className: undefined,
        requiredLevel: undefined,
        xp: undefined,
        objective: undefined,
        rewards: [],
      },
    ]);
  });

  it("leaves out an item without an English name", async () => {
    const fetch = createFakeFetch({
      "items/items_280000.json": {
        "280103": {
          names: { deDE: "Erfundener Stein" },
          quality: 0,
          itemLevel: 1,
          reqLevel: 0,
          classID: 15,
          subclassID: 0,
          slot: "INVTYPE_NON_EQUIP_IGNORE",
        },
      },
    });

    const { items } = await createSpyglassReader({ fetch })();

    expect(items).toEqual([]);
  });

  it("fails when an item file lists an item under something other than its ID", async () => {
    const fetch = createFakeFetch({
      "items/items_280000.json": {
        "280101x": {
          names: { enUS: "Made-up Choker" },
          quality: 3,
          itemLevel: 18,
          reqLevel: 13,
          classID: 4,
          subclassID: 0,
          slot: "INVTYPE_NECK",
        },
      },
    });

    await expect(createSpyglassReader({ fetch })()).rejects.toBeInstanceOf(z.ZodError);
  });

  it("fails, naming the page, when a server doesn't answer", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(new Response("Service Unavailable", { status: 503 })),
    );

    await expect(createSpyglassReader({ fetch })()).rejects.toThrow(
      new Error(`The server answered HTTP 503 for ${data}/config.json.`),
    );
  });
});
