import type {
  APIInteractionResponseCallbackData,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord-api-types/v10";

export type CommandDefinition = RESTPostAPIChatInputApplicationCommandsJSONBody;

export type CommandReply = APIInteractionResponseCallbackData;

export interface CommandInvocation {
  readonly commandName: string;
}

export interface SlashCommand {
  readonly definition: CommandDefinition;
  readonly handle: (invocation: CommandInvocation) => Promise<CommandReply>;
}

export interface Feature {
  readonly commands: readonly SlashCommand[];
}
