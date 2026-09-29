import { MessageFlags } from "discord-api-types/v10";
import { describe, expect, it, vi } from "vitest";
import { createItemCommand } from "./item-command.ts";
import type { ItemRecord } from "./item-sparse.ts";
import type { ItemStore } from "./item-store.ts";

const madeUpSword: ItemRecord = {
  id: 270001,
  name: "Made-up Sword of Testing",
  quality: 3,
  itemLevel: 42,
  requiredLevel: 37,
  inventoryType: 13,
};

function createFakeItems(stored: readonly ItemRecord[]) {
  return {
    importedVersion: vi.fn<ItemStore["importedVersion"]>().mockResolvedValue("1.60.1.70009"),
    replaceAll: vi.fn<ItemStore["replaceAll"]>(),
    get: vi.fn<ItemStore["get"]>((id) => Promise.resolve(stored.find((item) => item.id === id))),
    search: vi.fn<ItemStore["search"]>((text, limit) =>
      Promise.resolve(
        stored
          .filter((item) => item.name.toLowerCase().includes(text.toLowerCase()))
          .slice(0, limit),
      ),
    ),
  } satisfies ItemStore;
}

function invoke(name: string) {
  return { commandName: "item", options: new Map([["name", name]]) };
}

describe("/item", () => {
  it("replies with the item's name, quality, slot, levels and Wowhead link", async () => {
    const command = createItemCommand(createFakeItems([madeUpSword]));

    expect(await command.handle(invoke("270001"))).toEqual({
      content: [
        "**Made-up Sword of Testing**",
        "Rare One-Hand · item level 42 · requires level 37",
        "https://www.wowhead.com/forever/item=270001",
        "-# Item data from wago.tools",
      ].join("\n"),
      allowed_mentions: { parse: [] },
    });
  });

  it("leaves out the slot of an item you can't equip", async () => {
    const reagent = { ...madeUpSword, id: 270002, quality: 1, inventoryType: 0 };
    const command = createItemCommand(createFakeItems([reagent]));

    const reply = await command.handle(invoke("270002"));

    expect(reply.content?.split("\n")[1]).toBe("Common · item level 42 · requires level 37");
  });

  it("leaves out a level requirement of none", async () => {
    const anyLevel = { ...madeUpSword, id: 270004, requiredLevel: 0 };
    const command = createItemCommand(createFakeItems([anyLevel]));

    const reply = await command.handle(invoke("270004"));

    expect(reply.content?.split("\n")[1]).toBe("Rare One-Hand · item level 42");
  });

  it("escapes Markdown in an item's name", async () => {
    const starred = { ...madeUpSword, id: 270003, name: "Made-up *Starred* Blade_of|Things" };
    const command = createItemCommand(createFakeItems([starred]));

    const reply = await command.handle(invoke("270003"));

    expect(reply.content?.split("\n")[0]).toBe(
      String.raw`**Made-up \*Starred\* Blade\_of\|Things**`,
    );
  });

  it("looks up a typed name when no suggestion was picked", async () => {
    const command = createItemCommand(createFakeItems([madeUpSword]));

    const reply = await command.handle(invoke("sword of testing"));

    expect(reply.content?.split("\n")[0]).toBe("**Made-up Sword of Testing**");
  });

  it("replies privately when it can't find the item", async () => {
    const command = createItemCommand(createFakeItems([madeUpSword]));

    expect(await command.handle(invoke("Nothing like this"))).toEqual({
      content: "I couldn't find that item. Start typing its name and pick one of the suggestions.",
      flags: MessageFlags.Ephemeral,
    });
  });

  it("replies privately to a blank name instead of looking it up", async () => {
    const command = createItemCommand(createFakeItems([madeUpSword]));

    expect(await command.handle(invoke("  "))).toEqual({
      content: "I couldn't find that item. Start typing its name and pick one of the suggestions.",
      flags: MessageFlags.Ephemeral,
    });
  });

  it("suggests matching items, labelled with their kind and item level, valued by their ID", async () => {
    const command = createItemCommand(createFakeItems([madeUpSword]));

    const choices = await command.autocomplete?.({
      commandName: "item",
      optionName: "name",
      value: "sword",
    });

    expect(choices).toEqual([
      { name: "Made-up Sword of Testing (Rare One-Hand, item level 42)", value: "270001" },
    ]);
  });

  it("shortens a suggestion to Discord's limit of 100 characters", async () => {
    const long = { ...madeUpSword, name: "Made-up ".repeat(20).trim() };
    const command = createItemCommand(createFakeItems([long]));

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
    const items = createFakeItems([madeUpSword]);
    const command = createItemCommand(items);

    const choices = await command.autocomplete?.({
      commandName: "item",
      optionName: "name",
      value: " ",
    });

    expect(choices).toEqual([]);
    expect(items.search).not.toHaveBeenCalled();
  });

  it("treats a number too big to be an item ID as text to search for", async () => {
    const numbered = { ...madeUpSword, id: 270005, name: "Made-up Charm No. 99999999999" };
    const command = createItemCommand(createFakeItems([numbered]));

    const reply = await command.handle(invoke("99999999999"));

    expect(reply.content?.split("\n")[0]).toBe("**Made-up Charm No. 99999999999**");
  });

  it("says the item data isn't loaded yet when no build has been imported", async () => {
    const items = createFakeItems([]);
    items.importedVersion.mockResolvedValue(undefined);
    const command = createItemCommand(items);

    expect(await command.handle(invoke("sword"))).toEqual({
      content: "I haven't loaded the item data yet. Try again in a minute.",
      flags: MessageFlags.Ephemeral,
    });
  });

  it("suggests each distinct item once, however many copies of it exist", async () => {
    const copies = [1, 2, 3].map((n) => ({ ...madeUpSword, id: 270100 + n }));
    const command = createItemCommand(createFakeItems(copies));

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
