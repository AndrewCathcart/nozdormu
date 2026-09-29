import {
  type CommandReply,
  escapeMarkdown,
  maxAutocompleteChoices,
  type SlashCommand,
} from "@nozdormu/core";
import { ApplicationCommandOptionType, MessageFlags } from "discord-api-types/v10";
import type { DungeonStore, DungeonSummary, StoredDungeon } from "./dungeon-store.ts";

// Discord's limit on a message's length.
const maxMessageLength = 2000;

// The loot shown for a boss: all of it, or the first few and how many more.
function lootList(loot: StoredDungeon["bosses"][number]["loot"], maxShown: number): string {
  const names = loot.slice(0, maxShown).map((item) => escapeMarkdown(item.name));
  const more = loot.length - names.length;
  return names.join(", ") + (more > 0 ? ` and ${String(more)} more` : "");
}

// What players call some of the dungeons, as the words of their names.
const nicknames: ReadonlyMap<string, string> = new Map([
  ["rfc", "ragefire chasm"],
  ["wc", "wailing caverns"],
  ["vc", "deadmines"],
  ["sfk", "shadowfang keep"],
  ["stocks", "stormwind stockade"],
  ["bfd", "blackfathom deeps"],
  ["gnomer", "gnomeregan"],
  ["rfk", "razorfen kraul"],
  ["sm", "scarlet monastery"],
  ["rfd", "razorfen downs"],
  ["ulda", "uldaman"],
  ["zf", "zulfarrak"],
  ["mara", "maraudon"],
  ["st", "sunken temple"],
  ["brd", "blackrock depths"],
  ["lbrs", "blackrock spire lower"],
  ["ubrs", "blackrock spire upper"],
  ["dme", "dire maul east"],
  ["dmn", "dire maul north"],
  ["dmw", "dire maul west"],
  ["strat", "stratholme"],
  ["scholo", "scholomance"],
]);

// Lower-case letters, digits and single spaces, so "Zul'Farrak" and "zul farrak" compare alike.
function simplified(text: string): string {
  return text
    .toLowerCase()
    .replaceAll(/[^a-z0-9 ]/g, "")
    .replaceAll(/ +/g, " ")
    .trim();
}

// The dungeons whose names hold every word typed, in any order, with nicknames spelled out, in the
// list's order: lowest levels first.
function matching(dungeons: readonly DungeonSummary[], text: string): DungeonSummary[] {
  const words = simplified(text)
    .split(" ")
    .flatMap((word) => (nicknames.get(word) ?? word).split(" "))
    .filter((word) => word !== "");
  return dungeons.filter((dungeon) =>
    words.every((word) => simplified(dungeon.name).includes(word)),
  );
}

function levels(dungeon: Pick<StoredDungeon, "minLevel" | "maxLevel">): string {
  return `levels ${String(dungeon.minLevel)}–${String(dungeon.maxLevel)}`;
}

function describeDungeon(dungeon: StoredDungeon, maxLootShown: number): string {
  const entry =
    dungeon.requiredLevel === undefined ? "" : `, enter from ${String(dungeon.requiredLevel)}`;
  return [
    `**${escapeMarkdown(dungeon.name)}** · ${levels(dungeon)}${entry}`,
    ...dungeon.bosses.map(
      (boss) =>
        `- **${escapeMarkdown(boss.name)}**` +
        (boss.loot.length === 0 ? "" : `: ${lootList(boss.loot, maxLootShown)}`),
    ),
    `-# Bosses and loot from Spyglass's scans, as of build ${dungeon.build}. Loot may be incomplete, and has no drop chances.`,
  ].join("\n");
}

// /dungeon: suggests Forever's dungeons as you type, then shows the one you pick: its levels, and its
// bosses with the loot seen from each. They're listed in the game's encounter order, which isn't
// always the order they're fought in, so they aren't numbered.
export function createDungeonCommand(
  store: Pick<DungeonStore, "get" | "list" | "loadedBuild">,
): SlashCommand {
  // A picked suggestion sends the dungeon's name; typed text finds the best match.
  const find = async (name: string): Promise<StoredDungeon | undefined> => {
    const exact = await store.get(name);
    if (exact !== undefined) {
      return exact;
    }
    const [best] = matching(await store.list(), name);
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
      // When all the loot won't fit in one message, show fewer items per boss until it does.
      let content = describeDungeon(dungeon, Number.POSITIVE_INFINITY);
      for (let shown = 5; content.length > maxMessageLength && shown >= 0; shown -= 1) {
        content = describeDungeon(dungeon, shown);
      }
      return { content, allowed_mentions: { parse: [] } };
    },
    autocomplete: async (query) => {
      const found = matching(await store.list(), query.value);
      return found.slice(0, maxAutocompleteChoices).map((dungeon) => ({
        name: `${dungeon.name} (${levels(dungeon)})`,
        value: dungeon.name,
      }));
    },
  };
}
