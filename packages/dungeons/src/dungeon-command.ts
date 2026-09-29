import {
  type CommandReply,
  escapeMarkdown,
  maxAutocompleteChoices,
  type SlashCommand,
} from "@nozdormu/core";
import { type APIEmbed, ApplicationCommandOptionType, MessageFlags } from "discord-api-types/v10";
import type { DungeonStore, DungeonSummary, StoredDungeon } from "./dungeon-store.ts";
import { itemDetails } from "./item-text.ts";

// Discord's limits on a card: its sections, each section's text, and the whole card's text.
const maxFields = 25;
const maxFieldLength = 1024;
const maxCardLength = 6000;

// WoW's colour for epic items.
const epicPurple = 0xa3_35_ee;

// A boss's loot, one linked item a line: all of it, or the first few and how many more.
function lootLines(loot: StoredDungeon["bosses"][number]["loot"], maxShown: number): string {
  if (loot.length === 0) {
    return "No loot seen yet";
  }
  const lines = loot.slice(0, maxShown).map((item) => {
    const link = `[${escapeMarkdown(item.name)}](https://www.wowhead.com/forever/item=${String(item.itemId)})`;
    const details = item.scanned === undefined ? "" : itemDetails(item.scanned);
    return details === "" ? link : `${link} · ${details}`;
  });
  const more = loot.length - lines.length;
  return [...lines, ...(more > 0 ? [`and ${String(more)} more`] : [])].join("\n");
}

// The card showing a dungeon: its levels, then a section per boss listing its loot.
function dungeonCard(dungeon: StoredDungeon, maxLootShown: number): APIEmbed {
  const entry =
    dungeon.requiredLevel === undefined
      ? ""
      : ` · enter from level ${String(dungeon.requiredLevel)}`;
  return {
    color: epicPurple,
    title: escapeMarkdown(dungeon.name),
    description: `Levels ${String(dungeon.minLevel)}–${String(dungeon.maxLevel)}${entry}`,
    fields: dungeon.bosses.slice(0, maxFields).map((boss) => ({
      name: boss.name,
      value: lootLines(boss.loot, maxLootShown),
    })),
    footer: {
      text: "Loot may be incomplete, and has no drop chances.",
    },
  };
}

// Whether Discord will take the card.
function fits(card: APIEmbed): boolean {
  const fields = card.fields ?? [];
  const length = [
    card.title,
    card.description,
    card.footer?.text,
    ...fields.flatMap((field) => [field.name, field.value]),
  ].reduce((total, text) => total + (text ?? "").length, 0);
  return length <= maxCardLength && fields.every((field) => field.value.length <= maxFieldLength);
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
      // When all the loot won't fit on one card, show fewer items per boss until it does.
      let card = dungeonCard(dungeon, Number.POSITIVE_INFINITY);
      for (let shown = 8; !fits(card) && shown >= 0; shown -= 1) {
        card = dungeonCard(dungeon, shown);
      }
      return { embeds: [card], allowed_mentions: { parse: [] } };
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
