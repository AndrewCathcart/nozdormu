// What /item and /recipe share.
import type { AutocompleteChoice, CommandReply } from "@nozdormu/core";
import { MessageFlags } from "discord-api-types/v10";

// The private reply before the first import: "item" or "recipe" data.
export function notLoaded(kind: string): CommandReply {
  return {
    content: `I haven't loaded the ${kind} data yet. Try again in a minute.`,
    flags: MessageFlags.Ephemeral,
  };
}

// Discord allows 100 characters in a suggestion's name.
const maxChoiceNameLength = 100;

// Item and spell IDs are Postgres integers.
const maxId = 2_147_483_647;

export function escapeMarkdown(text: string): string {
  return text.replaceAll(/[\\*_~`|>[\]]/g, (character) => `\\${character}`);
}

// A picked suggestion sends its ID. Anything else, including a longer number, is text to search for.
export function parseId(value: string): number | undefined {
  const id = Number.parseInt(value, 10);
  return /^\d+$/.test(value) && id <= maxId ? id : undefined;
}

export interface Suggestion {
  readonly name: string;
  // Shown after the name, and kept whole when the name is shortened.
  readonly label: string;
  readonly value: string;
}

// Suggestions for Discord, shortened to its limit. Several copies of a thing (one per class, say)
// would look identical, so each distinct suggestion appears once.
export function toChoices(suggestions: readonly Suggestion[]): AutocompleteChoice[] {
  const seen = new Set<string>();
  return suggestions.flatMap(({ name, label, value }) => {
    const suffix = ` (${label})`;
    const shown = name.slice(0, maxChoiceNameLength - suffix.length) + suffix;
    if (seen.has(shown)) {
      return [];
    }
    seen.add(shown);
    return [{ name: shown, value }];
  });
}
