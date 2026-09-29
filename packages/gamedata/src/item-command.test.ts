import { MessageFlags } from "discord-api-types/v10";
import { describe, expect, it, vi } from "vitest";
import { createItemCommand } from "./item-command.ts";
import type { ItemEntry } from "./item-entry.ts";
import type { GameDataStore } from "./game-data-store.ts";

// A made-up item only the client's table has, so not scanned.
const madeUpSword: ItemEntry = {
  id: 270001,
  name: "Made-up Sword of Testing",
  quality: 3,
  itemLevel: 42,
  requiredLevel: 37,
  slot: "INVTYPE_WEAPON",
  scanned: undefined,
};

// A made-up item as scanned in the game.
const madeUpBelt: ItemEntry = {
  id: 270010,
  name: "Made-up Belt",
  quality: 3,
  itemLevel: 18,
  requiredLevel: 13,
  slot: "INVTYPE_WAIST",
  scanned: {
    id: 270010,
    name: "Made-up Belt",
    quality: 3,
    itemLevel: 18,
    requiredLevel: 13,
    itemClass: 4,
    itemSubclass: 2,
    slot: "INVTYPE_WAIST",
    stats: [
      { stat: "STAMINA", value: 4 },
      { stat: "RESISTANCE0_NAME", value: 37 },
    ],
  },
};

function createFakeStore(stored: readonly ItemEntry[]) {
  return {
    importedBuild: vi
      .fn<GameDataStore["importedBuild"]>()
      .mockResolvedValue({ version: "1.60.1.70009", format: 2 }),
    lookUpItem: vi.fn<GameDataStore["lookUpItem"]>((id) =>
      Promise.resolve(stored.find((item) => item.id === id)),
    ),
    findItems: vi.fn<GameDataStore["findItems"]>((text, limit) =>
      Promise.resolve(
        stored
          .filter((item) => item.name.toLowerCase().includes(text.toLowerCase()))
          .slice(0, limit),
      ),
    ),
  } satisfies Pick<GameDataStore, "importedBuild" | "lookUpItem" | "findItems">;
}

function invoke(name: string) {
  return { commandName: "item", options: new Map([["name", name]]) };
}

describe("/item", () => {
  it("shows the item as a card: its name linked, its quality, kind and levels, then its stats", async () => {
    const command = createItemCommand(createFakeStore([madeUpBelt]));

    expect(await command.handle(invoke("270010"))).toEqual({
      embeds: [
        {
          title: "Made-up Belt",
          url: "https://www.wowhead.com/forever/item=270010",
          // Rare blue, as in the game.
          color: 0x00_70_dd,
          description: "Rare Leather Waist · item level 18 · requires level 13\n37 Armor, +4 Sta",
        },
      ],
      allowed_mentions: { parse: [] },
    });
  });

  it("shows an item not scanned yet with its quality, slot and levels, and no stats", async () => {
    const command = createItemCommand(createFakeStore([madeUpSword]));

    const reply = await command.handle(invoke("270001"));

    expect(reply.embeds?.[0]?.description).toBe(
      "Rare One-Hand · item level 42 · requires level 37",
    );
  });

  it("colours the card as the game colours each quality", async () => {
    const qualities = [0, 1, 2, 3, 4, 5].map((quality) => ({
      ...madeUpSword,
      id: 270020 + quality,
      quality,
    }));
    const command = createItemCommand(createFakeStore(qualities));

    const colours = await Promise.all(
      qualities.map(
        async (item) => (await command.handle(invoke(String(item.id)))).embeds?.[0]?.color,
      ),
    );

    expect(colours).toEqual([
      0x9d_9d_9d, 0xff_ff_ff, 0x1e_ff_00, 0x00_70_dd, 0xa3_35_ee, 0xff_80_00,
    ]);
  });

  it("leaves out the slot of an item you can't equip", async () => {
    const reagent = { ...madeUpSword, id: 270002, quality: 1, slot: "INVTYPE_NON_EQUIP" };
    const command = createItemCommand(createFakeStore([reagent]));

    const reply = await command.handle(invoke("270002"));

    expect(reply.embeds?.[0]?.description).toBe("Common · item level 42 · requires level 37");
  });

  it("leaves out a level requirement of none", async () => {
    const anyLevel = { ...madeUpSword, id: 270004, requiredLevel: 0 };
    const command = createItemCommand(createFakeStore([anyLevel]));

    const reply = await command.handle(invoke("270004"));

    expect(reply.embeds?.[0]?.description).toBe("Rare One-Hand · item level 42");
  });

  it("escapes Markdown in an item's name", async () => {
    const starred = { ...madeUpSword, id: 270003, name: "Made-up *Starred* Blade_of|Things" };
    const command = createItemCommand(createFakeStore([starred]));

    const reply = await command.handle(invoke("270003"));

    expect(reply.embeds?.[0]?.title).toBe(String.raw`Made-up \*Starred\* Blade\_of\|Things`);
  });

  it("looks up a typed name when no suggestion was picked", async () => {
    const command = createItemCommand(createFakeStore([madeUpSword]));

    const reply = await command.handle(invoke("sword of testing"));

    expect(reply.embeds?.[0]?.title).toBe("Made-up Sword of Testing");
  });

  it("replies privately when it can't find the item", async () => {
    const command = createItemCommand(createFakeStore([madeUpSword]));

    expect(await command.handle(invoke("Nothing like this"))).toEqual({
      content: "I couldn't find that item. Start typing its name and pick one of the suggestions.",
      flags: MessageFlags.Ephemeral,
    });
  });

  it("replies privately to a blank name instead of looking it up", async () => {
    const command = createItemCommand(createFakeStore([madeUpSword]));

    expect(await command.handle(invoke("  "))).toEqual({
      content: "I couldn't find that item. Start typing its name and pick one of the suggestions.",
      flags: MessageFlags.Ephemeral,
    });
  });

  it("suggests matching items, labelled with their quality, kind and item level, valued by their ID", async () => {
    const command = createItemCommand(createFakeStore([madeUpBelt, madeUpSword]));

    const choices = await command.autocomplete?.({
      commandName: "item",
      optionName: "name",
      value: "made-up",
    });

    expect(choices).toEqual([
      { name: "Made-up Belt (Rare Leather Waist, item level 18)", value: "270010" },
      { name: "Made-up Sword of Testing (Rare One-Hand, item level 42)", value: "270001" },
    ]);
  });

  it("shortens a suggestion to Discord's limit of 100 characters", async () => {
    const long = { ...madeUpSword, name: "Made-up ".repeat(20).trim() };
    const command = createItemCommand(createFakeStore([long]));

    const choices = await command.autocomplete?.({
      commandName: "item",
      optionName: "name",
      value: "made",
    });

    // 69 characters of the name, then the 31-character label.
    expect(choices?.[0]?.name).toBe(
      "Made-up Made-up Made-up Made-up Made-up Made-up Made-up Made-up Made- (Rare One-Hand, item level 42)",
    );
  });

  it("suggests nothing until something is typed", async () => {
    const items = createFakeStore([madeUpSword]);
    const command = createItemCommand(items);

    const choices = await command.autocomplete?.({
      commandName: "item",
      optionName: "name",
      value: " ",
    });

    expect(choices).toEqual([]);
    expect(items.findItems).not.toHaveBeenCalled();
  });

  it("treats a number too big to be an item ID as text to search for", async () => {
    const numbered = { ...madeUpSword, id: 270005, name: "Made-up Charm No. 99999999999" };
    const command = createItemCommand(createFakeStore([numbered]));

    const reply = await command.handle(invoke("99999999999"));

    expect(reply.embeds?.[0]?.title).toBe("Made-up Charm No. 99999999999");
  });

  it("says the item data isn't loaded yet when no build has been imported", async () => {
    const items = createFakeStore([]);
    items.importedBuild.mockResolvedValue(undefined);
    const command = createItemCommand(items);

    expect(await command.handle(invoke("sword"))).toEqual({
      content: "I haven't loaded the item data yet. Try again in a minute.",
      flags: MessageFlags.Ephemeral,
    });
  });

  it("suggests each distinct item once, however many copies of it exist", async () => {
    const copies = [1, 2, 3].map((n) => ({ ...madeUpSword, id: 270100 + n }));
    const command = createItemCommand(createFakeStore(copies));

    const choices = await command.autocomplete?.({
      commandName: "item",
      optionName: "name",
      value: "sword",
    });

    expect(choices).toEqual([
      { name: "Made-up Sword of Testing (Rare One-Hand, item level 42)", value: "270101" },
    ]);
  });
});
