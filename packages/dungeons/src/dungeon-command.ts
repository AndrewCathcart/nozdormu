import {
  type ButtonResponse,
  type CommandReply,
  escapeMarkdown,
  maxAutocompleteChoices,
  type SlashCommand,
} from "@nozdormu/core";
import {
  type APIActionRowComponent,
  type APIButtonComponent,
  type APIEmbed,
  ApplicationCommandOptionType,
  ButtonStyle,
  ComponentType,
  MessageFlags,
} from "discord-api-types/v10";
import type {
  DungeonStore,
  DungeonSummary,
  StoredDungeon,
  StoredLootItem,
  StoredQuest,
} from "./dungeon-store.ts";
import { itemDetails } from "./item-text.ts";
import type { Faction } from "./spyglass.ts";

// Discord's limits on a card: its sections, each section's text, and the whole card's text.
const maxFields = 25;
const maxFieldLength = 1024;
const maxCardLength = 6000;

// WoW's colour for epic items.
const epicPurple = 0xa3_35_ee;

// An item, linked to Wowhead, then its slot, kind and stats where it's been scanned.
function itemLine(item: StoredLootItem): string {
  const link = `[${escapeMarkdown(item.name)}](https://www.wowhead.com/forever/item=${String(item.itemId)})`;
  const details = item.scanned === undefined ? "" : itemDetails(item.scanned);
  return details === "" ? link : `${link} · ${details}`;
}

// Items one a line: all of them, or the first few and how many more.
function itemLines(items: readonly StoredLootItem[], maxShown: number): string[] {
  const lines = items.slice(0, maxShown).map(itemLine);
  const more = items.length - lines.length;
  return [...lines, ...(more > 0 ? [`and ${String(more)} more`] : [])];
}

// The top of both cards: the dungeon's name and levels.
function heading(dungeon: StoredDungeon): Pick<APIEmbed, "color" | "title" | "description"> {
  const entry =
    dungeon.requiredLevel === undefined
      ? ""
      : ` · enter from level ${String(dungeon.requiredLevel)}`;
  return {
    color: epicPurple,
    title: escapeMarkdown(dungeon.name),
    description: `Levels ${String(dungeon.minLevel)}–${String(dungeon.maxLevel)}${entry}`,
  };
}

// The card showing a dungeon's bosses, a section each listing its loot.
function lootCard(dungeon: StoredDungeon, maxLootShown: number): APIEmbed {
  return {
    ...heading(dungeon),
    fields: dungeon.bosses.slice(0, maxFields).map((boss) => ({
      name: boss.name,
      value:
        boss.loot.length === 0 ? "No loot seen yet" : itemLines(boss.loot, maxLootShown).join("\n"),
    })),
    footer: {
      text: "Loot may be incomplete, and has no drop chances.",
    },
  };
}

const factionNames: Readonly<Record<Faction, string>> = {
  Alliance: "Alliance",
  Horde: "Horde",
  Both: "Both factions",
};

// A quest's faction, class, level, XP and Wowhead link, then its objective and rewards, leaving out
// whatever hasn't been scanned.
function questLines(quest: StoredQuest, maxRewardsShown: number): string {
  const facts = [
    // A class quest both factions can take just names the class.
    quest.side === undefined || (quest.side === "Both" && quest.className !== undefined)
      ? undefined
      : factionNames[quest.side],
    quest.className === undefined ? undefined : `${quest.className}s only`,
    quest.requiredLevel === undefined ? undefined : `from level ${String(quest.requiredLevel)}`,
    quest.xp === undefined ? undefined : `${quest.xp.toLocaleString("en-GB")} XP`,
    `[Wowhead](https://www.wowhead.com/forever/quest=${String(quest.id)})`,
  ].filter((fact) => fact !== undefined);
  return [
    facts.join(" · "),
    ...(quest.objective === undefined ? [] : [`*${escapeMarkdown(quest.objective)}*`]),
    ...itemLines(quest.rewards, maxRewardsShown),
  ].join("\n");
}

// The card showing a dungeon's quests, lowest level first, a section each. Quests whose level
// isn't known come last.
function questsCard(
  dungeon: StoredDungeon,
  maxRewardsShown: number,
  maxQuestsShown: number,
): APIEmbed {
  const quests = dungeon.quests
    .toSorted(
      (a, b) =>
        (a.requiredLevel ?? Number.POSITIVE_INFINITY) -
        (b.requiredLevel ?? Number.POSITIVE_INFINITY),
    )
    .slice(0, Math.min(maxQuestsShown, maxFields));
  const more = dungeon.quests.length - quests.length;
  return {
    ...heading(dungeon),
    fields: quests.map((quest) => ({
      name: quest.name,
      value: questLines(quest, maxRewardsShown),
    })),
    footer: {
      text: `Quests and their details may be incomplete.${more > 0 ? ` ${String(more)} more quests didn't fit.` : ""}`,
    },
  };
}

// The quests card with every reward, or with fewer rewards per quest until it fits, then, if even
// no rewards won't fit, with fewer quests.
function fittingQuestsCard(dungeon: StoredDungeon): APIEmbed {
  let fitted = fittingCard((shown) => questsCard(dungeon, shown, maxFields));
  for (let quests = maxFields - 1; !fits(fitted) && quests > 0; quests -= 1) {
    fitted = questsCard(dungeon, 0, quests);
  }
  return fitted;
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

// The card with every item it lists, or, when that won't fit, with fewer items per section until
// it does.
function fittingCard(card: (maxItemsShown: number) => APIEmbed): APIEmbed {
  let fitted = card(Number.POSITIVE_INFINITY);
  for (let shown = 8; !fits(fitted) && shown >= 0; shown -= 1) {
    fitted = card(shown);
  }
  return fitted;
}

type CardView = "loot" | "quests";

// Buttons to switch between the two cards, the one showing greyed out. A dungeon with no quests
// seen has only the loot card, so no buttons.
function switchButtons(
  dungeon: StoredDungeon,
  showing: CardView,
): APIActionRowComponent<APIButtonComponent>[] {
  if (dungeon.quests.length === 0) {
    return [];
  }
  const button = (view: CardView, label: string): APIButtonComponent => ({
    type: ComponentType.Button,
    style: view === showing ? ButtonStyle.Primary : ButtonStyle.Secondary,
    label,
    custom_id: `dungeon:${view}:${dungeon.name}`,
    disabled: view === showing,
  });
  return [
    {
      type: ComponentType.ActionRow,
      components: [
        button("loot", "Bosses & loot"),
        button("quests", `Quests (${String(dungeon.quests.length)})`),
      ],
    },
  ];
}

// The dungeon's loot or quests card, with the buttons to switch between them.
function dungeonReply(dungeon: StoredDungeon, showing: CardView): CommandReply {
  const card =
    showing === "loot"
      ? fittingCard((shown) => lootCard(dungeon, shown))
      : fittingQuestsCard(dungeon);
  // Always given, even when empty: an update without them would keep the message's old buttons.
  return {
    embeds: [card],
    components: switchButtons(dungeon, showing),
    allowed_mentions: { parse: [] },
  };
}

// A button's custom ID: "dungeon:", the card it shows, a colon and the dungeon's name.
const buttonIdPattern = /^dungeon:(loot|quests):(.+)$/;

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
      return dungeonReply(dungeon, "loot");
    },
    press: async ({ customId }): Promise<ButtonResponse> => {
      const [, view, name] = buttonIdPattern.exec(customId) ?? [];
      const dungeon = name === undefined ? undefined : await store.get(name);
      if (dungeon === undefined || (view !== "loot" && view !== "quests")) {
        return {
          kind: "reply",
          message: {
            content: "I couldn't find that dungeon any more. Look it up again with /dungeon.",
            flags: MessageFlags.Ephemeral,
          },
        };
      }
      return { kind: "update", message: dungeonReply(dungeon, view) };
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
