import { type CommandReply, maxAutocompleteChoices, type SlashCommand } from "@nozdormu/core";
import { ApplicationCommandOptionType, MessageFlags } from "discord-api-types/v10";
import type { ItemRecord } from "./item-sparse.ts";
import type { ItemStore } from "./item-store.ts";

const qualityNames: Readonly<Record<number, string>> = {
  0: "Poor",
  1: "Common",
  2: "Uncommon",
  3: "Rare",
  4: "Epic",
  5: "Legendary",
  6: "Artifact",
  7: "Heirloom",
};

// ItemSparse's InventoryType. 0 means the item can't be equipped.
const slotNames: Readonly<Record<number, string>> = {
  1: "Head",
  2: "Neck",
  3: "Shoulder",
  4: "Shirt",
  5: "Chest",
  6: "Waist",
  7: "Legs",
  8: "Feet",
  9: "Wrist",
  10: "Hands",
  11: "Finger",
  12: "Trinket",
  13: "One-Hand",
  14: "Shield",
  15: "Ranged",
  16: "Back",
  17: "Two-Hand",
  18: "Bag",
  19: "Tabard",
  20: "Chest",
  21: "Main Hand",
  22: "Off Hand",
  23: "Held In Off-hand",
  24: "Ammo",
  25: "Thrown",
  26: "Ranged",
  27: "Quiver",
  28: "Relic",
};

// Discord allows 100 characters in a suggestion's name.
const maxChoiceNameLength = 100;

const notLoaded: CommandReply = {
  content: "I haven't loaded the item data yet. Try again in a minute.",
  flags: MessageFlags.Ephemeral,
};

// Item IDs are Postgres integers; a longer number typed in is searched for as text instead.
const maxItemId = 2_147_483_647;

const notFound: CommandReply = {
  content: "I couldn't find that item. Start typing its name and pick one of the suggestions.",
  flags: MessageFlags.Ephemeral,
};

function escapeMarkdown(text: string): string {
  return text.replaceAll(/[\\*_~`|>[\]]/g, (character) => `\\${character}`);
}

// "Rare One-Hand": the quality, and the slot if the item can be equipped.
function describeKind(item: ItemRecord): string {
  return [qualityNames[item.quality], slotNames[item.inventoryType]]
    .filter((part) => part !== undefined)
    .join(" ");
}

function describeItem(item: ItemRecord): string {
  const kind = describeKind(item);
  const details = [
    kind,
    `item level ${String(item.itemLevel)}`,
    ...(item.requiredLevel > 0 ? [`requires level ${String(item.requiredLevel)}`] : []),
  ];
  return details.filter((part) => part !== "").join(" · ");
}

function choiceName(item: ItemRecord): string {
  const kind = describeKind(item);
  const suffix = ` (${kind === "" ? "" : `${kind}, `}item level ${String(item.itemLevel)})`;
  return item.name.slice(0, maxChoiceNameLength - suffix.length) + suffix;
}

// /item: suggests items as you type their name, then shows the one you pick with its Wowhead link.
// Discord's preview of the link shows the tooltip and where the item comes from.
export function createItemCommand(items: ItemStore): SlashCommand {
  const find = async (value: string): Promise<ItemRecord | undefined> => {
    // A picked suggestion sends the item's ID; text typed without picking one is searched for.
    if (/^\d+$/.test(value) && Number(value) <= maxItemId) {
      return items.get(Number.parseInt(value, 10));
    }
    const [best] = await items.search(value, 1);
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
      const item = typeof value === "string" ? await find(value.trim()) : undefined;
      if (item === undefined) {
        return (await items.importedVersion()) === undefined ? notLoaded : notFound;
      }
      return {
        content: [
          `**${escapeMarkdown(item.name)}**`,
          describeItem(item),
          `https://www.wowhead.com/forever/item=${String(item.id)}`,
          "-# Item data from wago.tools",
        ].join("\n"),
        allowed_mentions: { parse: [] },
      };
    },
    autocomplete: async (query) => {
      const text = query.value.trim();
      if (text === "") {
        return [];
      }
      const found = await items.search(text, maxAutocompleteChoices);
      // Some items exist in several copies (one per class, say) that would look identical.
      const seen = new Set<string>();
      return found.flatMap((item) => {
        const name = choiceName(item);
        if (seen.has(name)) {
          return [];
        }
        seen.add(name);
        return [{ name, value: String(item.id) }];
      });
    },
  };
}
