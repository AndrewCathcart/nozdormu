import {
  type CommandReply,
  escapeMarkdown,
  maxAutocompleteChoices,
  type SlashCommand,
} from "@nozdormu/core";
import { ApplicationCommandOptionType, MessageFlags } from "discord-api-types/v10";
import type { DungeonStore, StoredDungeon } from "./dungeon-store.ts";

function levels(dungeon: Pick<StoredDungeon, "minLevel" | "maxLevel">): string {
  return `levels ${String(dungeon.minLevel)}–${String(dungeon.maxLevel)}`;
}

function describeDungeon(dungeon: StoredDungeon): string {
  const entry =
    dungeon.requiredLevel === undefined ? "" : `, enter from ${String(dungeon.requiredLevel)}`;
  return [
    `**${escapeMarkdown(dungeon.name)}** · ${levels(dungeon)}${entry}`,
    ...dungeon.bosses.map(
      (boss, index) =>
        `${String(index + 1)}. **${escapeMarkdown(boss.name)}**` +
        (boss.loot.length === 0
          ? ""
          : `: ${boss.loot.map((item) => escapeMarkdown(item.name)).join(", ")}`),
    ),
    `-# Bosses and loot from Spyglass, scanned in game build ${dungeon.build}. Loot may be incomplete, and has no drop chances.`,
  ].join("\n");
}

// /dungeon: suggests Forever's dungeons as you type, then shows the one you pick: its levels, and its
// bosses in order with the loot seen from each.
export function createDungeonCommand(
  store: Pick<DungeonStore, "get" | "search" | "loadedBuild">,
): SlashCommand {
  // A picked suggestion sends the dungeon's name; typed text finds the best match.
  const find = async (name: string): Promise<StoredDungeon | undefined> => {
    const exact = await store.get(name);
    if (exact !== undefined) {
      return exact;
    }
    const [best] = await store.search(name, 1);
    return best === undefined ? undefined : store.get(best.name);
  };

  return {
    definition: {
      name: "dungeon",
      description: "Look up a World of Warcraft: Forever dungeon's bosses and loot",
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: "name",
          description: "Start typing the dungeon's name, then pick it",
          required: true,
          autocomplete: true,
        },
      ],
    },
    handle: async (invocation): Promise<CommandReply> => {
      const value = invocation.options.get("name");
      const name = typeof value === "string" ? value.trim() : "";
      const dungeon = name === "" ? undefined : await find(name);
      if (dungeon === undefined) {
        const loaded = (await store.loadedBuild()) !== undefined;
        return {
          content: loaded
            ? "I couldn't find that dungeon. Start typing its name and pick one of the suggestions."
            : "I haven't loaded the dungeon data yet. Try again in a minute.",
          flags: MessageFlags.Ephemeral,
        };
      }
      return { content: describeDungeon(dungeon), allowed_mentions: { parse: [] } };
    },
    autocomplete: async (query) => {
      const text = query.value.trim();
      if (text === "") {
        return [];
      }
      const found = await store.search(text, maxAutocompleteChoices);
      return found.map((dungeon) => ({
        name: `${dungeon.name} (${levels(dungeon)})`,
        value: dungeon.name,
      }));
    },
  };
}
