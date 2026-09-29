import type {
  APIApplicationCommandOptionChoice,
  APIInteractionResponseCallbackData,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord-api-types/v10";
import type { ScheduledJob } from "./scheduler.ts";

export type CommandDefinition = RESTPostAPIChatInputApplicationCommandsJSONBody;

export type CommandReply = APIInteractionResponseCallbackData;

export type CommandOptionValue = string | number | boolean;

export interface CommandInvocation {
  readonly commandName: string;
  // The command's top-level options, by name.
  readonly options: ReadonlyMap<string, CommandOptionValue>;
}

// What a user has typed so far into an option that offers suggestions.
export interface AutocompleteQuery {
  readonly commandName: string;
  readonly optionName: string;
  readonly value: string;
}

export type AutocompleteChoice = APIApplicationCommandOptionChoice;

// A press of a button on one of a command's replies. The button's custom ID starts with the
// command's name and a colon, such as "dungeon:quests:Wailing Caverns", so the press reaches that
// command.
export interface ButtonPress {
  readonly customId: string;
}

// What a button press does: replace the message the button is on, or reply with a new one (such
// as a private note that the button no longer works).
export type ButtonResponse =
  | { readonly kind: "update"; readonly message: CommandReply }
  | { readonly kind: "reply"; readonly message: CommandReply };

export interface SlashCommand {
  readonly definition: CommandDefinition;
  readonly handle: (invocation: CommandInvocation) => Promise<CommandReply>;
  // Suggestions for options defined with autocomplete. Discord shows at most 25.
  readonly autocomplete?: (query: AutocompleteQuery) => Promise<readonly AutocompleteChoice[]>;
  // Answers presses of the buttons on the command's replies.
  readonly press?: (press: ButtonPress) => Promise<ButtonResponse>;
}

// Everything a feature adds to the bot. Leave out what it doesn't use.
export interface Feature {
  readonly commands?: readonly SlashCommand[];
  readonly jobs?: readonly ScheduledJob[];
}
