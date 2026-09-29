import type { CommandReply } from "@nozdormu/core";
import { type APIEmbed, MessageFlags } from "discord-api-types/v10";
import { describe, expect, it, vi } from "vitest";
import { createDungeonCommand } from "./dungeon-command.ts";
import type { DungeonStore, StoredDungeon, StoredLootItem } from "./dungeon-store.ts";

const hollow: StoredDungeon = {
  name: "The Made-up Hollow",
  minLevel: 13,
  maxLevel: 18,
  requiredLevel: 10,
  bosses: [
    {
      name: "Made-up Warden",
      loot: [
        {
          itemId: 280_101,
          name: "Made-up Choker",
          scanned: {
            id: 280_101,
            name: "Made-up Choker",
            quality: 3,
            itemLevel: 18,
            requiredLevel: 13,
            slot: "INVTYPE_NECK",
            stats: [
              { stat: "STAMINA", value: 4 },
              { stat: "SPIRIT", value: 2 },
            ],
          },
        },
        { itemId: 280_102, name: "Made_up *Bracers*", scanned: undefined },
      ],
    },
    { name: "Made-up Tyrant", loot: [] },
  ],
};

// An in-memory store holding these dungeons.
function createFakeStore(stored: readonly StoredDungeon[]) {
  return {
    get: vi.fn<DungeonStore["get"]>((name) =>
      Promise.resolve(stored.find((dungeon) => dungeon.name === name)),
    ),
    list: vi.fn<DungeonStore["list"]>(() =>
      Promise.resolve(
        stored
          .toSorted((a, b) => a.minLevel - b.minLevel)
          .map(({ name, minLevel, maxLevel }) => ({ name, minLevel, maxLevel })),
      ),
    ),
    loadedBuild: vi.fn<DungeonStore["loadedBuild"]>(() =>
      Promise.resolve(stored.length > 0 ? "1.60.1.69913" : undefined),
    ),
  } satisfies Pick<DungeonStore, "get" | "list" | "loadedBuild">;
}

// The reply's card.
function card(reply: CommandReply): APIEmbed {
  const [embed] = reply.embeds ?? [];
  if (embed === undefined) {
    throw new Error("The reply has no card.");
  }
  return embed;
}

// A card's length as Discord counts it towards its 6,000-character limit.
function cardLength(embed: APIEmbed): number {
  return [
    embed.title,
    embed.description,
    embed.footer?.text,
    ...(embed.fields ?? []).flatMap((field) => [field.name, field.value]),
  ].reduce((total, text) => total + (text ?? "").length, 0);
}

function invoke(name: string) {
  return { commandName: "dungeon", options: new Map([["name", name]]) };
}

describe("/dungeon", () => {
  it("shows the dungeon as a card: its levels, then each boss with its loot linked to Wowhead", async () => {
    const command = createDungeonCommand(createFakeStore([hollow]));

    const reply = await command.handle(invoke("The Made-up Hollow"));

    expect(reply).toEqual({
      embeds: [
        {
          color: 0xa3_35_ee,
          title: "The Made-up Hollow",
          description: "Levels 13–18 · enter from level 10",
          fields: [
            {
              name: "Made-up Warden",
              value: [
                "[Made-up Choker](https://www.wowhead.com/forever/item=280101) · Neck · +4 Sta, +2 Spi",
                "[Made\\_up \\*Bracers\\*](https://www.wowhead.com/forever/item=280102)",
              ].join("\n"),
            },
            { name: "Made-up Tyrant", value: "No loot seen yet" },
          ],
          footer: {
            text: "Loot may be incomplete, and has no drop chances.",
          },
        },
      ],
      allowed_mentions: { parse: [] },
    });
  });

  it("shows armour, damage per second and other stats readably", async () => {
    const stave: StoredLootItem = {
      itemId: 280_103,
      name: "Made-up Stave",
      scanned: {
        id: 280_103,
        name: "Made-up Stave",
        quality: 3,
        itemLevel: 18,
        requiredLevel: 13,
        slot: "INVTYPE_2HWEAPON",
        stats: [
          { stat: "RESISTANCE0_NAME", value: 100 },
          { stat: "DAMAGE_PER_SECOND", value: 11.88 },
          { stat: "SPELL_POWER", value: 18 },
          { stat: "ATTACK_POWER_VS_BEAST", value: 3 },
        ],
      },
    };
    const command = createDungeonCommand(
      createFakeStore([{ ...hollow, bosses: [{ name: "Made-up Warden", loot: [stave] }] }]),
    );

    const reply = await command.handle(invoke("The Made-up Hollow"));

    expect(card(reply).fields?.[0]?.value).toBe(
      "[Made-up Stave](https://www.wowhead.com/forever/item=280103) · Two-Hand · 100 Armor, 11.9 DPS, +18 Spell Power, +3 Attack Power Vs Beast",
    );
  });

  it("shows fewer items per boss when all the loot won't fit on one card", async () => {
    // 20 bosses with 8 linked items each come to over 10,000 characters, where a card allows 6,000.
    const packed: StoredDungeon = {
      ...hollow,
      bosses: Array.from({ length: 20 }, (_boss, boss) => ({
        name: `Made-up Boss ${String(boss + 1)}`,
        loot: Array.from({ length: 8 }, (_item, item) => ({
          itemId: 281_000 + item,
          name: `Made-up Loot Item 0${String(item + 1)}`,
          scanned: undefined,
        })),
      })),
    };
    const command = createDungeonCommand(createFakeStore([packed]));

    const shown = card(await command.handle(invoke("The Made-up Hollow")));

    expect(shown.fields?.[0]?.value.split("\n")).toEqual([
      "[Made-up Loot Item 01](https://www.wowhead.com/forever/item=281000)",
      "[Made-up Loot Item 02](https://www.wowhead.com/forever/item=281001)",
      "[Made-up Loot Item 03](https://www.wowhead.com/forever/item=281002)",
      "and 5 more",
    ]);
    expect(cardLength(shown)).toBeLessThanOrEqual(6000);
  });

  it("finds the best match for typed text that isn't a whole name", async () => {
    const command = createDungeonCommand(createFakeStore([hollow]));

    const reply = await command.handle(invoke("made-up hol"));

    expect(card(reply).title).toBe("The Made-up Hollow");
  });

  it("finds a dungeon by the words of its name in any order, ignoring punctuation", async () => {
    const command = createDungeonCommand(
      createFakeStore([hollow, { ...hollow, name: "Zul'Madeup" }]),
    );

    const reply = await command.handle(invoke("madeup zul"));

    expect(card(reply).title).toBe("Zul'Madeup");
  });

  it("finds a dungeon by the name players call it", async () => {
    const command = createDungeonCommand(
      createFakeStore([hollow, { ...hollow, name: "Blackrock Depths" }]),
    );

    const reply = await command.handle(invoke("BRD"));

    expect(card(reply).title).toBe("Blackrock Depths");
  });

  it("leaves out the entry level when it isn't known", async () => {
    const command = createDungeonCommand(
      createFakeStore([{ ...hollow, requiredLevel: undefined }]),
    );

    const reply = await command.handle(invoke("The Made-up Hollow"));

    expect(card(reply).description).toBe("Levels 13–18");
  });

  it("says so privately when there's no such dungeon", async () => {
    const command = createDungeonCommand(createFakeStore([hollow]));

    const reply = await command.handle(invoke("Made-up Nowhere"));

    expect(reply).toEqual({
      content:
        "I couldn't find that dungeon. Start typing its name and pick one of the suggestions.",
      flags: MessageFlags.Ephemeral,
    });
  });

  it("says so privately before the dungeons are loaded", async () => {
    const command = createDungeonCommand(createFakeStore([]));

    const reply = await command.handle(invoke("The Made-up Hollow"));

    expect(reply).toEqual({
      content: "I haven't loaded the dungeon data yet. Try again in a minute.",
      flags: MessageFlags.Ephemeral,
    });
  });

  it("suggests every dungeon, lowest levels first, before anything's typed", async () => {
    const command = createDungeonCommand(
      createFakeStore([hollow, { ...hollow, name: "Made-up Keep", minLevel: 8, maxLevel: 12 }]),
    );

    const choices = await command.autocomplete?.({
      commandName: "dungeon",
      optionName: "name",
      value: "",
    });

    expect(choices).toEqual([
      { name: "Made-up Keep (levels 8–12)", value: "Made-up Keep" },
      { name: "The Made-up Hollow (levels 13–18)", value: "The Made-up Hollow" },
    ]);
  });

  it("suggests dungeons as you type, with their levels", async () => {
    const command = createDungeonCommand(createFakeStore([hollow]));

    const choices = await command.autocomplete?.({
      commandName: "dungeon",
      optionName: "name",
      value: "hollow",
    });

    expect(choices).toEqual([
      { name: "The Made-up Hollow (levels 13–18)", value: "The Made-up Hollow" },
    ]);
  });
});
