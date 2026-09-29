import type { Logger } from "pino";
import type { CommandDefinition, CommandInvocation, CommandReply, Feature } from "./feature.ts";

export type DispatchResult =
  | { readonly kind: "replied"; readonly reply: CommandReply }
  | { readonly kind: "unknown-command"; readonly commandName: string };

export interface Registry {
  readonly commandDefinitions: readonly CommandDefinition[];
  readonly dispatch: (invocation: CommandInvocation) => Promise<DispatchResult>;
}

export function createRegistry(
  features: readonly Feature[],
  logger: Pick<Logger, "warn">,
): Registry {
  const commands = features.flatMap((feature) => feature.commands);
  const commandsByName = new Map(commands.map((command) => [command.definition.name, command]));

  return {
    commandDefinitions: commands.map((command) => command.definition),
    dispatch: async (invocation) => {
      const command = commandsByName.get(invocation.commandName);
      if (command === undefined) {
        logger.warn(
          { event: "command.unknown", commandName: invocation.commandName },
          "Unknown command",
        );
        return { kind: "unknown-command", commandName: invocation.commandName };
      }
      return { kind: "replied", reply: await command.handle(invocation) };
    },
  };
}
