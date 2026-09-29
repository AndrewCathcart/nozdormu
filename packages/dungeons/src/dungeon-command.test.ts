import { MessageFlags } from "discord-api-types/v10";
import { describe, expect, it, vi } from "vitest";
import { createDungeonCommand } from "./dungeon-command.ts";
import type { DungeonStore, StoredDungeon } from "./dungeon-store.ts";

const hollow: StoredDungeon = {
  name: "The Made-up Hollow",
  minLevel: 13,
  maxLevel: 18,
  requiredLevel: 10,
  bosses: [
    {
      name: "Made-up Warden",
      loot: [
        { itemId: 280_101, name: "Made-up Choker" },
        { itemId: 280_102, name: "Made_up *Bracers*" },
      ],
    },
    { name: "Made-up Tyrant", loot: [] },
  ],
  build: "1.60.1.69913",
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
    loadedBuild: vi.fn<DungeonStore["loadedBuild"]>(() => Promise.resolve(stored[0]?.build)),
  } satisfies Pick<DungeonStore, "get" | "list" | "loadedBuild">;
}

function invoke(name: string) {
  return { commandName: "dungeon", options: new Map([["name", name]]) };
}

describe("/dungeon", () => {
  it("shows the dungeon's levels and its bosses, with the loot seen from each", async () => {
    const command = createDungeonCommand(createFakeStore([hollow]));

    const reply = await command.handle(invoke("The Made-up Hollow"));

    expect(reply).toEqual({
      content: [
        "**The Made-up Hollow** · levels 13–18, enter from 10",
        "- **Made-up Warden**: Made-up Choker, Made\\_up \\*Bracers\\*",
        "- **Made-up Tyrant**",
        "-# Bosses and loot from Spyglass's scans, as of build 1.60.1.69913. Loot may be incomplete, and has no drop chances.",
      ].join("\n"),
      allowed_mentions: { parse: [] },
    });
  });

  it("shows fewer items per boss when all the loot won't fit in one message", async () => {
    // 20 bosses with 8 items each: about 4,000 characters in full, and still over Discord's 2,000
    // with 5, 4 or 3 items per boss, so 2 are shown.
    const packed: StoredDungeon = {
      ...hollow,
      bosses: Array.from({ length: 20 }, (_boss, boss) => ({
        name: `Made-up Boss ${String(boss + 1)}`,
        loot: Array.from({ length: 8 }, (_item, item) => ({
          itemId: 281_000 + item,
          name: `Made-up Loot Item 0${String(item + 1)}`,
        })),
      })),
    };
    const command = createDungeonCommand(createFakeStore([packed]));

    const reply = await command.handle(invoke("The Made-up Hollow"));

    expect(reply.content?.split("\n")[1]).toBe(
      "- **Made-up Boss 1**: Made-up Loot Item 01, Made-up Loot Item 02 and 6 more",
    );
    expect(reply.content?.length).toBeLessThanOrEqual(2000);
  });

  it("finds the best match for typed text that isn't a whole name", async () => {
    const command = createDungeonCommand(createFakeStore([hollow]));

    const reply = await command.handle(invoke("made-up hol"));

    expect(reply.content?.split("\n")[0]).toBe(
      "**The Made-up Hollow** · levels 13–18, enter from 10",
    );
  });

  it("finds a dungeon by the words of its name in any order, ignoring punctuation", async () => {
    const command = createDungeonCommand(
      createFakeStore([hollow, { ...hollow, name: "Zul'Madeup" }]),
    );

    const reply = await command.handle(invoke("madeup zul"));

    expect(reply.content?.split("\n")[0]).toBe("**Zul'Madeup** · levels 13–18, enter from 10");
  });

  it("finds a dungeon by the name players call it", async () => {
    const command = createDungeonCommand(
      createFakeStore([hollow, { ...hollow, name: "Blackrock Depths" }]),
    );

    const reply = await command.handle(invoke("BRD"));

    expect(reply.content?.split("\n")[0]).toBe(
      "**Blackrock Depths** · levels 13–18, enter from 10",
    );
  });

  it("leaves out the entry level when it isn't known", async () => {
    const command = createDungeonCommand(
      createFakeStore([{ ...hollow, requiredLevel: undefined }]),
    );

    const reply = await command.handle(invoke("The Made-up Hollow"));

    expect(reply.content?.split("\n")[0]).toBe("**The Made-up Hollow** · levels 13–18");
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
