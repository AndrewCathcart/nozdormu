import { MessageFlags } from "discord-api-types/v10";
import { describe, expect, it, vi } from "vitest";
import type { ClassSpell } from "./class-spells.ts";
import type { GameDataStore } from "./game-data-store.ts";
import { createTrainCommand } from "./train-command.ts";

// Made-up warrior (class 1) spells.
function spell(spellId: number, name: string, level: number, changes: Partial<ClassSpell> = {}) {
  return { spellId, classId: 1, level, name, rank: undefined, races: [], ...changes };
}

const warriorSpells: ClassSpell[] = [
  spell(800_001, "Made-up Strike", 10, { rank: 2 }),
  spell(800_002, "Made-up Stance", 10),
  spell(800_003, "Made-up Shout", 12, { rank: 1 }),
  spell(800_004, "Made-up Starshards", 12, { rank: 1, races: ["Night Elf"] }),
  spell(800_005, "Made-up Prayer", 12, { races: ["Human", "Dwarf"] }),
];

// Answers from the given spells, sorted by name like the real store.
function createFakeStore(spells: readonly ClassSpell[], format = 4) {
  return {
    importedBuild: vi
      .fn<GameDataStore["importedBuild"]>()
      .mockResolvedValue({ version: "1.60.1.70009", format }),
    classSpellsAt: vi.fn<GameDataStore["classSpellsAt"]>((classId, level) =>
      Promise.resolve(
        spells
          .filter((found) => found.classId === classId && found.level === level)
          .toSorted((a, b) => a.name.localeCompare(b.name) || (a.rank ?? 0) - (b.rank ?? 0)),
      ),
    ),
    nextClassSpellLevel: vi.fn<GameDataStore["nextClassSpellLevel"]>((classId, afterLevel) => {
      const levels = spells
        .filter((found) => found.classId === classId && found.level > afterLevel)
        .map((found) => found.level);
      return Promise.resolve(levels.length === 0 ? undefined : Math.min(...levels));
    }),
  } satisfies Pick<GameDataStore, "importedBuild" | "classSpellsAt" | "nextClassSpellLevel">;
}

function invoke(classId: number, level: number) {
  return {
    commandName: "train",
    options: new Map<string, number>([
      ["class", classId],
      ["level", level],
    ]),
  };
}

const credit = "-# Game data from wago.tools. A few come from class quests, not the trainer.";

const link = (spellId: number): string =>
  `https://www.wowhead.com/forever/spell=${String(spellId)}`;

describe("/train", () => {
  it("lists what the class learns at that level, with ranks and links", async () => {
    const command = createTrainCommand(createFakeStore(warriorSpells));

    expect(await command.handle(invoke(1, 10))).toEqual({
      content: [
        "**New warrior spells at level 10**",
        `- [Made-up Stance](${link(800_002)})`,
        `- [Made-up Strike](${link(800_001)}) (Rank 2)`,
        credit,
      ].join("\n"),
      allowed_mentions: { parse: [] },
      flags: MessageFlags.SuppressEmbeds,
    });
  });

  it("says which races learn a race-only spell", async () => {
    const command = createTrainCommand(createFakeStore(warriorSpells));

    const reply = await command.handle(invoke(1, 12));

    expect(reply.content?.split("\n")).toEqual([
      "**New warrior spells at level 12**",
      `- [Made-up Prayer](${link(800_005)}) · Human and Dwarf only`,
      `- [Made-up Shout](${link(800_003)}) (Rank 1)`,
      `- [Made-up Starshards](${link(800_004)}) (Rank 1) · Night Elf only`,
      credit,
    ]);
  });

  it("shows the next level with new spells when there are none at that level", async () => {
    const command = createTrainCommand(createFakeStore(warriorSpells));

    const reply = await command.handle(invoke(1, 11));

    expect(reply.content?.split("\n").slice(0, 3)).toEqual([
      "A warrior learns nothing new at level 11. The next new spells are at level 12:",
      `- [Made-up Prayer](${link(800_005)}) · Human and Dwarf only`,
      `- [Made-up Shout](${link(800_003)}) (Rank 1)`,
    ]);
  });

  it("says so when there are no new spells at that level or after", async () => {
    const command = createTrainCommand(createFakeStore(warriorSpells));

    const reply = await command.handle(invoke(1, 13));

    expect(reply.content).toBe(
      ["A warrior learns nothing new at level 13 or later.", credit].join("\n"),
    );
  });

  it("replies privately before the trainer data is loaded", async () => {
    const command = createTrainCommand(createFakeStore([], 3));

    expect(await command.handle(invoke(1, 10))).toEqual({
      content: "I haven't loaded the trainer data yet. Try again in a minute.",
      flags: MessageFlags.Ephemeral,
    });
  });

  it("shortens a list too long for one Discord message, saying how many are left out", async () => {
    // 60 spells with 60-letter names: about 5,000 characters as links.
    const many = Array.from({ length: 60 }, (_, index) =>
      spell(810_000 + index, `Made-up ${"A".repeat(52)}${String(index).padStart(2, "0")}`, 30),
    );
    const command = createTrainCommand(createFakeStore(many));

    const reply = await command.handle(invoke(1, 30));
    const lines = reply.content?.split("\n") ?? [];

    expect((reply.content ?? "").length).toBeLessThanOrEqual(2000);
    expect(lines.at(-2)).toBe(`…and ${String(60 - (lines.length - 3))} more`);
    expect(lines.at(-1)).toBe(credit);
  });

  it("replies privately to a class or level the list doesn't offer", async () => {
    const command = createTrainCommand(createFakeStore(warriorSpells));

    // Class 6 is the Death Knight, who isn't in the game.
    expect(await command.handle(invoke(6, 10))).toEqual({
      content: "Pick a class from the list, and a level from 1 to 60.",
      flags: MessageFlags.Ephemeral,
    });
  });

  it("offers the nine classes by name, and levels 1 to 60", () => {
    const command = createTrainCommand(createFakeStore([]));

    expect(command.definition.options).toEqual([
      {
        type: 4,
        name: "class",
        description: "Your class",
        required: true,
        choices: [
          { name: "Druid", value: 11 },
          { name: "Hunter", value: 3 },
          { name: "Mage", value: 8 },
          { name: "Paladin", value: 2 },
          { name: "Priest", value: 5 },
          { name: "Rogue", value: 4 },
          { name: "Shaman", value: 7 },
          { name: "Warlock", value: 9 },
          { name: "Warrior", value: 1 },
        ],
      },
      {
        type: 4,
        name: "level",
        description: "The level you've reached, or are about to",
        required: true,
        min_value: 1,
        max_value: 60,
      },
    ]);
  });
});
