import type { CommandReply } from "@nozdormu/core";
import { type APIEmbed, MessageFlags } from "discord-api-types/v10";
import { describe, expect, it, vi } from "vitest";
import { createDungeonCommand } from "./dungeon-command.ts";
import type { DungeonStore, StoredDungeon, StoredLootItem } from "./dungeon-store.ts";
import type { ScannedItem } from "./spyglass.ts";

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
            itemClass: 4,
            itemSubclass: 0,
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
  quests: [],
};

// The same dungeon with two quests: one scanned in full, one only by name, which comes last since
// its level isn't known.
const hollowWithQuests: StoredDungeon = {
  ...hollow,
  quests: [
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
    {
      id: 90_101,
      name: "Made-up Errand",
      side: "Horde",
      className: "Warlock",
      requiredLevel: 12,
      xp: 1450,
      objective: "Bring 5 Made-up Fangs to a made-up trainer.",
      rewards: [
        {
          itemId: 280_103,
          name: "Made-up Staff",
          scanned: {
            id: 280_103,
            name: "Made-up Staff",
            quality: 2,
            itemLevel: 15,
            requiredLevel: 10,
            itemClass: 2,
            itemSubclass: 10,
            slot: "INVTYPE_2HWEAPON",
            stats: [
              { stat: "DAMAGE_PER_SECOND", value: 9.4 },
              { stat: "INTELLECT", value: 3 },
            ],
          },
        },
        { itemId: 280_104, name: "Made-up Ring", scanned: undefined },
      ],
    },
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

// A made-up scanned item of this kind, worn in this slot, with these stats.
function scannedLoot(
  itemId: number,
  name: string,
  kind: { itemClass: number; itemSubclass: number; slot: string },
  stats: ScannedItem["stats"] = [],
): StoredLootItem {
  return {
    itemId,
    name,
    scanned: { id: itemId, name, quality: 3, itemLevel: 18, requiredLevel: 13, ...kind, stats },
  };
}

// A reply's first boss's loot lines, for the dungeon holding only this loot.
async function lootShown(loot: readonly StoredLootItem[]): Promise<string | undefined> {
  const command = createDungeonCommand(
    createFakeStore([{ ...hollow, bosses: [{ name: "Made-up Warden", loot }] }]),
  );
  const reply = await command.handle(invoke("The Made-up Hollow"));
  return card(reply).fields?.[0]?.value;
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
      components: [],
      allowed_mentions: { parse: [] },
    });
  });

  it("shows damage per second, armour and other stats readably", async () => {
    const stave = scannedLoot(
      280_103,
      "Made-up Stave",
      { itemClass: 2, itemSubclass: 10, slot: "INVTYPE_2HWEAPON" },
      [
        { stat: "DAMAGE_PER_SECOND", value: 11.88 },
        { stat: "RESISTANCE0_NAME", value: 100 },
        { stat: "SPELL_POWER", value: 18 },
      ],
    );

    expect(await lootShown([stave])).toBe(
      "[Made-up Stave](https://www.wowhead.com/forever/item=280103) · Two-Hand Staff · 11.9 DPS, 100 Armor, +18 Spell Power",
    );
  });

  it("lists damage per second or armour first, then the main stats in the game's order", async () => {
    const bracers = scannedLoot(
      280_110,
      "Made-up Bracers",
      { itemClass: 4, itemSubclass: 2, slot: "INVTYPE_WRIST" },
      [
        { stat: "AGILITY", value: 4 },
        { stat: "INTELLECT", value: 3 },
        { stat: "RESISTANCE0_NAME", value: 37 },
        { stat: "SPELL_POWER", value: 6 },
        { stat: "SPIRIT", value: 2 },
        { stat: "STAMINA", value: 5 },
        { stat: "STRENGTH", value: 1 },
      ],
    );

    expect(await lootShown([bracers])).toBe(
      "[Made-up Bracers](https://www.wowhead.com/forever/item=280110) · Leather Wrist · 37 Armor, +1 Str, +4 Agi, +5 Sta, +3 Int, +2 Spi, +6 Spell Power",
    );
  });

  it("shows each resistance once, though the game names it two ways", async () => {
    const boots = scannedLoot(
      280_111,
      "Made-up Boots",
      { itemClass: 4, itemSubclass: 3, slot: "INVTYPE_FEET" },
      [
        { stat: "NATURE_RESISTANCE", value: 10 },
        { stat: "RESISTANCE0_NAME", value: 43 },
        { stat: "RESISTANCE3_NAME", value: 10 },
      ],
    );

    expect(await lootShown([boots])).toBe(
      "[Made-up Boots](https://www.wowhead.com/forever/item=280111) · Mail Feet · 43 Armor, +10 Nature Resistance",
    );
  });

  it("shows crit, hit, dodge, parry, block and haste as the percentages the game's tooltip gives", async () => {
    // The game stores these as level 60 ratings: 14 crit is 1%, as on the tooltip of Classic's
    // Devilsaur Gauntlets, and 20 hit is 2%, as on Lionheart Helm's.
    const ring = scannedLoot(
      280_112,
      "Made-up Ring",
      { itemClass: 4, itemSubclass: 0, slot: "INVTYPE_FINGER" },
      [
        { stat: "CRIT_RATING", value: 14 },
        { stat: "HIT_RATING", value: 20 },
        { stat: "DODGE_RATING", value: 12 },
        { stat: "PARRY_RATING", value: 21 },
        { stat: "BLOCK_RATING", value: 25 },
        { stat: "HASTE_RATING", value: 10 },
      ],
    );

    expect(await lootShown([ring])).toBe(
      "[Made-up Ring](https://www.wowhead.com/forever/item=280112) · Finger · +1% Crit, +2% Hit, +1% Dodge, +1.4% Parry, +5% Block, +1% Haste",
    );
  });

  it("names rarer stats the way players write them", async () => {
    const charm = scannedLoot(
      280_113,
      "Made-up Charm",
      { itemClass: 4, itemSubclass: 0, slot: "INVTYPE_TRINKET" },
      [
        { stat: "ATTACK_POWER_VS_BEAST", value: 3 },
        { stat: "SPELL_DAMAGE_VS_UNDEAD", value: 18 },
        { stat: "POWER_REGEN0", value: 5 },
        { stat: "FROST_DAMAGE_DONE", value: 20 },
        { stat: "TWOHANDED_AXES", value: 2 },
        { stat: "DAGGERS", value: 3 },
        { stat: "SPELL_RESISTANCE_ALL_SCHOOLS", value: 5 },
      ],
    );

    expect(await lootShown([charm])).toBe(
      "[Made-up Charm](https://www.wowhead.com/forever/item=280113) · Trinket · +3 Attack Power vs Beasts, +18 Spell Damage vs Undead, +5 Mana per 5 sec, +20 Frost Spell Damage, +2 Two-Handed Axe Skill, +3 Dagger Skill, +5 All Resistances",
    );
  });

  it("names the kind of armour a piece is, except for cloaks, which are all cloth", async () => {
    const girdle = scannedLoot(
      280_104,
      "Made-up Girdle",
      { itemClass: 4, itemSubclass: 2, slot: "INVTYPE_WAIST" },
      [{ stat: "STAMINA", value: 4 }],
    );
    const cloak = scannedLoot(280_105, "Made-up Cloak", {
      itemClass: 4,
      itemSubclass: 1,
      slot: "INVTYPE_CLOAK",
    });

    expect(await lootShown([girdle, cloak])).toBe(
      [
        "[Made-up Girdle](https://www.wowhead.com/forever/item=280104) · Leather Waist · +4 Sta",
        "[Made-up Cloak](https://www.wowhead.com/forever/item=280105) · Back",
      ].join("\n"),
    );
  });

  it("names the kind of weapon, with only the kind for a ranged one", async () => {
    const staff = scannedLoot(280_106, "Made-up Staff", {
      itemClass: 2,
      itemSubclass: 10,
      slot: "INVTYPE_2HWEAPON",
    });
    const axe = scannedLoot(280_107, "Made-up Axe", {
      itemClass: 2,
      itemSubclass: 1,
      slot: "INVTYPE_2HWEAPON",
    });
    const dagger = scannedLoot(280_108, "Made-up Dagger", {
      itemClass: 2,
      itemSubclass: 15,
      slot: "INVTYPE_WEAPON",
    });
    const bow = scannedLoot(280_109, "Made-up Bow", {
      itemClass: 2,
      itemSubclass: 2,
      slot: "INVTYPE_RANGED",
    });

    expect(await lootShown([staff, axe, dagger, bow])).toBe(
      [
        "[Made-up Staff](https://www.wowhead.com/forever/item=280106) · Two-Hand Staff",
        "[Made-up Axe](https://www.wowhead.com/forever/item=280107) · Two-Hand Axe",
        "[Made-up Dagger](https://www.wowhead.com/forever/item=280108) · One-Hand Dagger",
        "[Made-up Bow](https://www.wowhead.com/forever/item=280109) · Bow",
      ].join("\n"),
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

// A made-up quest known only by its ID and name.
function nameOnly(id: number, name: string): StoredDungeon["quests"][number] {
  return {
    id,
    name,
    side: undefined,
    className: undefined,
    requiredLevel: undefined,
    xp: undefined,
    objective: undefined,
    rewards: [],
  };
}

// The buttons under the loot card of the made-up dungeon with two quests: "Bosses & loot" greyed
// out and highlighted, as the card showing.
const buttonsShowingLoot = [
  {
    type: 1,
    components: [
      {
        type: 2,
        style: 1,
        label: "Bosses & loot",
        custom_id: "dungeon:loot:The Made-up Hollow",
        disabled: true,
      },
      {
        type: 2,
        style: 2,
        label: "Quests (2)",
        custom_id: "dungeon:quests:The Made-up Hollow",
        disabled: false,
      },
    ],
  },
];

// The same buttons under its quests card, with "Quests (2)" greyed out and highlighted instead.
const buttonsShowingQuests = [
  {
    type: 1,
    components: [
      {
        type: 2,
        style: 2,
        label: "Bosses & loot",
        custom_id: "dungeon:loot:The Made-up Hollow",
        disabled: false,
      },
      {
        type: 2,
        style: 1,
        label: "Quests (2)",
        custom_id: "dungeon:quests:The Made-up Hollow",
        disabled: true,
      },
    ],
  },
];

describe("/dungeon's quests", () => {
  it("shows the dungeon's quests, lowest level first, with those known only by name gathered last", async () => {
    const command = createDungeonCommand(createFakeStore([hollowWithQuests]));

    const response = await command.press?.({ customId: "dungeon:quests:The Made-up Hollow" });

    expect(response).toEqual({
      kind: "update",
      message: {
        embeds: [
          {
            color: 0xa3_35_ee,
            title: "The Made-up Hollow",
            description: "Levels 13–18 · enter from level 10",
            fields: [
              {
                name: "Made-up Errand",
                value: [
                  "Horde · Warlocks only · from level 12 · 1,450 XP · [Wowhead](https://www.wowhead.com/forever/quest=90101)",
                  "*Bring 5 Made-up Fangs to a made-up trainer.*",
                  "[Made-up Staff](https://www.wowhead.com/forever/item=280103) · Two-Hand Staff · 9.4 DPS, +3 Int",
                  "[Made-up Ring](https://www.wowhead.com/forever/item=280104)",
                ].join("\n"),
              },
              {
                name: "More quests, not scanned in full yet",
                value: "[Made-up Rumour](https://www.wowhead.com/forever/quest=90102)",
              },
            ],
            footer: { text: "Quests and their details may be incomplete." },
          },
        ],
        components: buttonsShowingQuests,
        allowed_mentions: { parse: [] },
      },
    });
  });

  it("offers a button to switch to the quests, under the card for a dungeon with quests", async () => {
    const command = createDungeonCommand(createFakeStore([hollowWithQuests]));

    const reply = await command.handle(invoke("The Made-up Hollow"));

    expect(reply.components).toEqual(buttonsShowingLoot);
  });

  it("switches back to the bosses and loot when that's pressed", async () => {
    const command = createDungeonCommand(createFakeStore([hollowWithQuests]));

    const response = await command.press?.({ customId: "dungeon:loot:The Made-up Hollow" });

    expect(response?.kind).toBe("update");
    expect(response?.message.embeds?.[0]?.fields?.map((field) => field.name)).toEqual([
      "Made-up Warden",
      "Made-up Tyrant",
    ]);
    expect(response?.message.components).toEqual(buttonsShowingLoot);
  });

  it("replies privately when the dungeon is no longer stored", async () => {
    const command = createDungeonCommand(createFakeStore([]));

    const response = await command.press?.({ customId: "dungeon:quests:The Made-up Hollow" });

    expect(response).toEqual({
      kind: "reply",
      message: {
        content: "I couldn't find that dungeon any more. Look it up again with /dungeon.",
        flags: MessageFlags.Ephemeral,
      },
    });
  });

  it("shows fewer rewards per quest when the quests won't all fit on one card", async () => {
    // 20 quests with 6 rewards each come to about 10,000 characters, where a card allows 6,000.
    // Each quest's section takes 168 characters without rewards and 64 more a reward, and the
    // card's heading and footer 95, so one reward each fits (4,735) and two don't (6,015).
    const busy: StoredDungeon = {
      ...hollow,
      quests: Array.from({ length: 20 }, (_quest, quest) => ({
        id: 91_000 + quest,
        name: `Made-up Quest ${String(quest + 1)}`,
        side: "Both",
        className: undefined,
        requiredLevel: 13,
        xp: 1000,
        objective: "Bring made-up things to a made-up person.",
        rewards: Array.from({ length: 6 }, (_reward, reward) => ({
          itemId: 282_000 + reward,
          name: `Made-up Reward ${String(reward + 1)}`,
          scanned: undefined,
        })),
      })),
    };
    const command = createDungeonCommand(createFakeStore([busy]));

    const response = await command.press?.({ customId: "dungeon:quests:The Made-up Hollow" });

    const [questsCard] = response?.message.embeds ?? [];
    expect(questsCard === undefined ? 0 : cardLength(questsCard)).toBeLessThanOrEqual(6000);
    expect(questsCard?.fields?.[0]?.value.split("\n").slice(-2)).toEqual([
      "[Made-up Reward 1](https://www.wowhead.com/forever/item=282000)",
      "and 5 more",
    ]);
  });

  it("clears the buttons when a resync has left the dungeon no quests", async () => {
    const command = createDungeonCommand(createFakeStore([hollow]));

    const response = await command.press?.({ customId: "dungeon:loot:The Made-up Hollow" });

    expect(response?.message.components).toEqual([]);
  });

  it("names only the class of a class quest both factions can take", async () => {
    const [errand] = hollowWithQuests.quests.filter((quest) => quest.id === 90_101);
    const bothFactions: StoredDungeon = {
      ...hollow,
      quests: errand === undefined ? [] : [{ ...errand, side: "Both" }],
    };
    const command = createDungeonCommand(createFakeStore([bothFactions]));

    const response = await command.press?.({ customId: "dungeon:quests:The Made-up Hollow" });

    expect(response?.message.embeds?.[0]?.fields?.[0]?.value.split("\n")[0]).toBe(
      "Warlocks only · from level 12 · 1,450 XP · [Wowhead](https://www.wowhead.com/forever/quest=90101)",
    );
  });

  it("shows fewer quests, saying how many more, when even without rewards they won't all fit", async () => {
    // 25 quests, each with a 400-letter objective. A quest's section takes its name (15 characters
    // for Made-up Quest 1 to 9, 16 after) and 500 more: 97 for the facts line, a line break and 402
    // for the objective. With the title (18), levels (34) and a 70-character footer, 11 quests take
    // 5,789 characters and 12 take 6,205, over Discord's 6,000.
    const long: StoredDungeon = {
      ...hollow,
      quests: Array.from({ length: 25 }, (_quest, quest) => ({
        id: 91_000 + quest,
        name: `Made-up Quest ${String(quest + 1)}`,
        side: "Both",
        className: undefined,
        requiredLevel: 13,
        xp: 1000,
        objective: "a".repeat(400),
        rewards: [],
      })),
    };
    const command = createDungeonCommand(createFakeStore([long]));

    const response = await command.press?.({ customId: "dungeon:quests:The Made-up Hollow" });

    const [questsCard] = response?.message.embeds ?? [];
    expect(questsCard?.fields?.length).toBe(11);
    expect(questsCard?.footer?.text).toBe(
      "Quests and their details may be incomplete. 14 more quests didn't fit.",
    );
  });

  it("shows at most 25 quests, Discord's limit on sections, saying how many more", async () => {
    const many: StoredDungeon = {
      ...hollow,
      quests: Array.from({ length: 30 }, (_quest, quest) => ({
        id: 92_000 + quest,
        name: `Made-up Quest ${String(quest + 1)}`,
        side: undefined,
        className: undefined,
        requiredLevel: 13,
        xp: undefined,
        objective: undefined,
        rewards: [],
      })),
    };
    const command = createDungeonCommand(createFakeStore([many]));

    const response = await command.press?.({ customId: "dungeon:quests:The Made-up Hollow" });

    const [questsCard] = response?.message.embeds ?? [];
    expect(questsCard?.fields?.length).toBe(25);
    expect(questsCard?.footer?.text).toBe(
      "Quests and their details may be incomplete. 5 more quests didn't fit.",
    );
  });

  it("lists several quests known only by name in one section, one after another", async () => {
    const rumours: StoredDungeon = {
      ...hollow,
      quests: [nameOnly(90_201, "Made-up Lead"), nameOnly(90_202, "Made_up *Errand*")],
    };
    const command = createDungeonCommand(createFakeStore([rumours]));

    const response = await command.press?.({ customId: "dungeon:quests:The Made-up Hollow" });

    expect(response?.message.embeds?.[0]?.fields).toEqual([
      {
        name: "More quests, not scanned in full yet",
        value:
          "[Made-up Lead](https://www.wowhead.com/forever/quest=90201) · [Made\\_up \\*Errand\\*](https://www.wowhead.com/forever/quest=90202)",
      },
    ]);
  });

  it("cuts a long list of quests known only by name to fit its section, saying how many more", async () => {
    // Each name is 67 characters ("Made-up Quest 10" to "Made-up Quest 29", a space and 50 x's),
    // so each link takes 114 and the separator 3. Eight links and " · and 12 more" take 947
    // characters; nine would take 1,064, over a section's 1,024.
    const many: StoredDungeon = {
      ...hollow,
      quests: Array.from({ length: 20 }, (_quest, quest) =>
        nameOnly(90_300 + quest, `Made-up Quest ${String(quest + 10)} ${"x".repeat(50)}`),
      ),
    };
    const command = createDungeonCommand(createFakeStore([many]));

    const response = await command.press?.({ customId: "dungeon:quests:The Made-up Hollow" });

    const value = response?.message.embeds?.[0]?.fields?.[0]?.value ?? "";
    expect(value.split(" · ").length).toBe(9);
    expect(value.endsWith(" · and 12 more")).toBe(true);
  });
});
