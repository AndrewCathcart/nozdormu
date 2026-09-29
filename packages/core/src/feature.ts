import type {
  APIInteractionResponseCallbackData,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord-api-types/v10";
import type { ScheduledJob } from "./scheduler.ts";

export type CommandDefinition = RESTPostAPIChatInputApplicationCommandsJSONBody;

export type CommandReply = APIInteractionResponseCallbackData;

export interface CommandInvocation {
  readonly commandName: string;
}

export interface SlashCommand {
  readonly definition: CommandDefinition;
  readonly handle: (invocation: CommandInvocation) => Promise<CommandReply>;
}

// Everything a feature adds to the bot. Leave out what it doesn't use.
export interface Feature {
  readonly commands?: readonly SlashCommand[];
  readonly jobs?: readonly ScheduledJob[];
}
