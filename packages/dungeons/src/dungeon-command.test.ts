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
    search: vi.fn<DungeonStore["search"]>((text, limit) =>
      Promise.resolve(
        stored
          .filter((dungeon) => dungeon.name.toLowerCase().includes(text.toLowerCase()))
          .slice(0, limit)
          .map(({ name, minLevel, maxLevel }) => ({ name, minLevel, maxLevel })),
      ),
    ),
    loadedBuild: vi.fn<DungeonStore["loadedBuild"]>(() => Promise.resolve(stored[0]?.build)),
  } satisfies Pick<DungeonStore, "get" | "search" | "loadedBuild">;
}

function invoke(name: string) {
  return { commandName: "dungeon", options: new Map([["name", name]]) };
}

describe("/dungeon", () => {
  it("shows the dungeon's levels and its bosses in order, with the loot seen from each", async () => {
    const command = createDungeonCommand(createFakeStore([hollow]));

    const reply = await command.handle(invoke("The Made-up Hollow"));

    expect(reply).toEqual({
      content: [
        "**The Made-up Hollow** · levels 13–18, enter from 10",
        "1. **Made-up Warden**: Made-up Choker, Made\\_up \\*Bracers\\*",
        "2. **Made-up Tyrant**",
        "-# Bosses and loot from Spyglass, scanned in game build 1.60.1.69913. Loot may be incomplete, and has no drop chances.",
      ].join("\n"),
      allowed_mentions: { parse: [] },
    });
  });

  it("finds the best match for typed text that isn't a whole name", async () => {
    const command = createDungeonCommand(createFakeStore([hollow]));

    const reply = await command.handle(invoke("made-up hol"));

    expect(reply.content?.split("\n")[0]).toBe(
      "**The Made-up Hollow** · levels 13–18, enter from 10",
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
