import {
  type CommandReply,
  escapeMarkdown,
  maxAutocompleteChoices,
  type SlashCommand,
} from "@nozdormu/core";
import { ApplicationCommandOptionType, MessageFlags } from "discord-api-types/v10";
import type { GameDataStore } from "./game-data-store.ts";
import type { ItemEntry } from "./item-entry.ts";
import { itemKind, itemStats } from "./item-text.ts";
import { notLoaded, parseId, toChoices } from "./lookup.ts";

// Each quality's name, and its colour as the game shows item names.
const qualities: ReadonlyMap<number, { readonly name: string; readonly colour: number }> = new Map([
  [0, { name: "Poor", colour: 0x9d_9d_9d }],
  [1, { name: "Common", colour: 0xff_ff_ff }],
  [2, { name: "Uncommon", colour: 0x1e_ff_00 }],
  [3, { name: "Rare", colour: 0x00_70_dd }],
  [4, { name: "Epic", colour: 0xa3_35_ee }],
  [5, { name: "Legendary", colour: 0xff_80_00 }],
  [6, { name: "Artifact", colour: 0xe6_cc_80 }],
  [7, { name: "Heirloom", colour: 0x00_cc_ff }],
]);

const notFound: CommandReply = {
  content: "I couldn't find that item. Start typing its name and pick one of the suggestions.",
  flags: MessageFlags.Ephemeral,
};

// "Rare Leather Waist": the quality, then where it's worn and what kind it is, if it can be
// equipped. Only a scanned item says what kind it is.
function describeKind(item: ItemEntry): string {
  return [qualities.get(item.quality)?.name, itemKind(item.slot, item.scanned)]
    .filter((part) => part !== undefined)
    .join(" ");
}

function describeItem(item: ItemEntry): string {
  const kind = describeKind(item);
  const details = [
    kind,
    `item level ${String(item.itemLevel)}`,
    ...(item.requiredLevel > 0 ? [`requires level ${String(item.requiredLevel)}`] : []),
  ];
  return details.filter((part) => part !== "").join(" · ");
}

// "Rare Leather Waist, item level 18", shown after the name in a suggestion.
function choiceLabel(item: ItemEntry): string {
  const kind = describeKind(item);
  return `${kind === "" ? "" : `${kind}, `}item level ${String(item.itemLevel)}`;
}

// /item: suggests items as you type their name, from the client's item table and the items scanned
// in the game (which include Forever's own), then shows the one you pick as a card: its name linked
// to Wowhead, in its quality's colour, then its quality, kind and levels, then its exact stats
// where it's been scanned.
export function createItemCommand(
  store: Pick<GameDataStore, "importedBuild" | "lookUpItem" | "findItems">,
): SlashCommand {
  const find = async (value: string): Promise<ItemEntry | undefined> => {
    const id = parseId(value);
    if (id !== undefined) {
      return store.lookUpItem(id);
    }
    const [best] = await store.findItems(value, 1);
    return best;
  };

  return {
    definition: {
      name: "item",
      description: "Look up a World of Warcraft: Forever item",
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: "name",
          description: "Start typing the item's name, then pick it",
          required: true,
          autocomplete: true,
        },
      ],
    },
    handle: async (invocation) => {
      const value = invocation.options.get("name");
      const text = typeof value === "string" ? value.trim() : "";
      const item = text === "" ? undefined : await find(text);
      if (item === undefined) {
        return (await store.importedBuild()) === undefined ? notLoaded("item") : notFound;
      }
      const stats = item.scanned === undefined ? "" : itemStats(item.scanned.stats);
      return {
        embeds: [
          {
            title: escapeMarkdown(item.name),
            url: `https://www.wowhead.com/forever/item=${String(item.id)}`,
            // Common white for a quality with no name here.
            color: qualities.get(item.quality)?.colour ?? 0xff_ff_ff,
            description: [describeItem(item), ...(stats === "" ? [] : [stats])].join("\n"),
          },
        ],
        allowed_mentions: { parse: [] },
      };
    },
    autocomplete: async (query) => {
      const text = query.value.trim();
      if (text === "") {
        return [];
      }
      const found = await store.findItems(text, maxAutocompleteChoices);
      return toChoices(
        found.map((item) => ({
          name: item.name,
          label: choiceLabel(item),
          value: String(item.id),
        })),
      );
    },
  };
}
