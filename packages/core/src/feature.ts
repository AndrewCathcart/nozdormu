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

export interface SlashCommand {
  readonly definition: CommandDefinition;
  readonly handle: (invocation: CommandInvocation) => Promise<CommandReply>;
  // Suggestions for options defined with autocomplete. Discord shows at most 25.
  readonly autocomplete?: (query: AutocompleteQuery) => Promise<readonly AutocompleteChoice[]>;
}

// Everything a feature adds to the bot. Leave out what it doesn't use.
export interface Feature {
  readonly commands?: readonly SlashCommand[];
  readonly jobs?: readonly ScheduledJob[];
}
