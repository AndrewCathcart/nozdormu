import type { CommandReply, SlashCommand } from "@nozdormu/core";
import {
  type APIApplicationCommandOptionChoice,
  ApplicationCommandOptionType,
  MessageFlags,
} from "discord-api-types/v10";
import type { ClassSpell } from "./class-spells.ts";
import type { GameDataStore } from "./game-data-store.ts";
import { escapeMarkdown, notLoaded } from "./lookup.ts";

// Class spells were first imported with import format 4.
const firstFormatWithClassSpells = 4;

// The classes by the game's class ID, in the order Discord shows them.
const classes = [
  { name: "Druid", value: 11 },
  { name: "Hunter", value: 3 },
  { name: "Mage", value: 8 },
  { name: "Paladin", value: 2 },
  { name: "Priest", value: 5 },
  { name: "Rogue", value: 4 },
  { name: "Shaman", value: 7 },
  { name: "Warlock", value: 9 },
  { name: "Warrior", value: 1 },
] as const satisfies readonly APIApplicationCommandOptionChoice<number>[];

const maxLevel = 60;

// Discord's limit on a message's length.
const maxMessageLength = 2000;

// The client data can't tell a trainer's spells from those a class quest gives, such as a warrior's
// Defensive Stance.
const credit = "-# Game data from wago.tools. A few come from class quests, not the trainer.";

const invalidOptions: CommandReply = {
  content: `Pick a class from the list, and a level from 1 to ${String(maxLevel)}.`,
  flags: MessageFlags.Ephemeral,
};

// "Human and Dwarf", or "Human, Dwarf and Gnome".
function listOf(names: readonly string[]): string {
  return names.length <= 1
    ? names.join("")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

function describeSpell(spell: ClassSpell): string {
  const link = `https://www.wowhead.com/forever/spell=${String(spell.spellId)}`;
  return [
    `- [${escapeMarkdown(spell.name)}](${link})`,
    ...(spell.rank === undefined ? [] : [` (Rank ${String(spell.rank)})`]),
    ...(spell.races.length === 0 ? [] : [` · ${listOf(spell.races)} only`]),
  ].join("");
}

// The heading, the spells and the credit, leaving spells off the end with a count of them when
// the whole list won't fit in one message.
function spellList(heading: string, spells: readonly ClassSpell[]): CommandReply {
  const lines = spells.map(describeSpell);
  const withShown = (shown: number): string[] => [
    heading,
    ...lines.slice(0, shown),
    ...(shown < lines.length ? [`…and ${String(lines.length - shown)} more`] : []),
    credit,
  ];
  let shown = lines.length;
  while (shown > 0 && withShown(shown).join("\n").length > maxMessageLength) {
    shown -= 1;
  }
  return reply(withShown(shown));
}

function reply(lines: readonly string[]): CommandReply {
  return {
    content: lines.join("\n"),
    allowed_mentions: { parse: [] },
    // Every spell is a link, and a preview of each would bury the list.
    flags: MessageFlags.SuppressEmbeds,
  };
}

// /train: the spells a class learns at a level, or at the next level with any.
export function createTrainCommand(
  store: Pick<GameDataStore, "importedBuild" | "classSpellsAt" | "nextClassSpellLevel">,
): SlashCommand {
  return {
    definition: {
      name: "train",
      description: "The spells a class learns at a level in World of Warcraft: Forever",
      options: [
        {
          type: ApplicationCommandOptionType.Integer,
          name: "class",
          description: "Your class",
          required: true,
          choices: [...classes],
        },
        {
          type: ApplicationCommandOptionType.Integer,
          name: "level",
          description: "The level you've reached, or are about to",
          required: true,
          min_value: 1,
          max_value: maxLevel,
        },
      ],
    },
    handle: async (invocation): Promise<CommandReply> => {
      const imported = await store.importedBuild();
      if (imported === undefined || imported.format < firstFormatWithClassSpells) {
        return notLoaded("trainer");
      }
      const classValue = invocation.options.get("class");
      const level = invocation.options.get("level");
      const chosen = classes.find((known) => known.value === classValue);
      if (
        chosen === undefined ||
        typeof level !== "number" ||
        !Number.isInteger(level) ||
        level < 1 ||
        level > maxLevel
      ) {
        return invalidOptions;
      }
      const spells = await store.classSpellsAt(chosen.value, level);
      if (spells.length > 0) {
        return spellList(
          `**New ${chosen.name.toLowerCase()} spells at level ${String(level)}**`,
          spells,
        );
      }
      const aClassMember = `A ${chosen.name.toLowerCase()}`;
      const next = await store.nextClassSpellLevel(chosen.value, level);
      if (next === undefined) {
        return reply([
          `${aClassMember} learns nothing new at level ${String(level)} or later.`,
          credit,
        ]);
      }
      return spellList(
        `${aClassMember} learns nothing new at level ${String(level)}. The next new spells are at level ${String(next)}:`,
        await store.classSpellsAt(chosen.value, next),
      );
    },
  };
}
