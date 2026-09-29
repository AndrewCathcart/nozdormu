import { MessageFlags } from "discord-api-types/v10";
import type { Logger } from "pino";
import type {
  AutocompleteChoice,
  AutocompleteQuery,
  CommandDefinition,
  CommandInvocation,
  CommandReply,
  Feature,
  SlashCommand,
} from "./feature.ts";

export type DispatchResult =
  | { readonly kind: "replied"; readonly reply: CommandReply }
  | { readonly kind: "unknown-command"; readonly commandName: string; readonly reply: CommandReply }
  | { readonly kind: "failed"; readonly commandName: string; readonly reply: CommandReply };

export interface Registry {
  readonly commandDefinitions: readonly CommandDefinition[];
  readonly dispatch: (invocation: CommandInvocation) => Promise<DispatchResult>;
  readonly autocomplete: (query: AutocompleteQuery) => Promise<readonly AutocompleteChoice[]>;
}

const unknownCommandReply: CommandReply = {
  content: "I don't know that command.",
  flags: MessageFlags.Ephemeral,
};

const failedReply: CommandReply = {
  content: "Something went wrong. It's been logged.",
  flags: MessageFlags.Ephemeral,
};

// Discord shows at most 25 suggestions and rejects a longer list.
export const maxAutocompleteChoices = 25;

export function createRegistry(
  features: readonly Feature[],
  logger: Pick<Logger, "warn" | "error">,
): Registry {
  const commands = features.flatMap((feature) => feature.commands ?? []);
  const commandsByName = new Map<string, SlashCommand>();
  for (const command of commands) {
    if (commandsByName.has(command.definition.name)) {
      throw new Error(`The command /${command.definition.name} is defined more than once.`);
    }
    commandsByName.set(command.definition.name, command);
  }

  return {
    commandDefinitions: commands.map((command) => command.definition),
    autocomplete: async (query) => {
      const autocomplete = commandsByName.get(query.commandName)?.autocomplete;
      if (autocomplete === undefined) {
        return [];
      }
      try {
        return (await autocomplete(query)).slice(0, maxAutocompleteChoices);
      } catch (error) {
        logger.error(
          { event: "autocomplete.failed", commandName: query.commandName, err: error },
          "Autocomplete failed",
        );
        return [];
      }
    },
    dispatch: async (invocation) => {
      const command = commandsByName.get(invocation.commandName);
      if (command === undefined) {
        logger.warn(
          { event: "command.unknown", commandName: invocation.commandName },
          "Unknown command",
        );
        return {
          kind: "unknown-command",
          commandName: invocation.commandName,
          reply: unknownCommandReply,
        };
      }
      try {
        return { kind: "replied", reply: await command.handle(invocation) };
      } catch (error) {
        logger.error(
          { event: "command.failed", commandName: invocation.commandName, err: error },
          "Command failed",
        );
        return { kind: "failed", commandName: invocation.commandName, reply: failedReply };
      }
    },
  };
}
