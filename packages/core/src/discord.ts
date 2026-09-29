import {
  InteractionResponseType,
  Routes,
  type RESTPostAPIInteractionCallbackJSONBody,
} from "discord-api-types/v10";
import { type Client, Events, type REST } from "discord.js";
import type { Logger } from "pino";
import type { CommandDefinition } from "./feature.ts";
import type { Registry } from "./registry.ts";

interface GuildTarget {
  readonly applicationId: string;
  readonly guildId: string;
}

// Bulk-overwrites the guild's commands, so commands removed from the code disappear from Discord too.
export async function registerGuildCommands(
  rest: REST,
  target: GuildTarget,
  definitions: readonly CommandDefinition[],
): Promise<void> {
  await rest.put(Routes.applicationGuildCommands(target.applicationId, target.guildId), {
    body: definitions,
  });
}

// Sends every slash command to the registry and replies with whatever it returns.
export function routeInteractions(
  client: Client,
  rest: REST,
  registry: Registry,
  logger: Pick<Logger, "info" | "error">,
): void {
  client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }
    const { commandName, id, token } = interaction;
    const startedAt = performance.now();
    registry
      .dispatch({ commandName })
      .then(async (result) => {
        const body = {
          type: InteractionResponseType.ChannelMessageWithSource,
          data: result.reply,
        } satisfies RESTPostAPIInteractionCallbackJSONBody;
        await rest.post(Routes.interactionCallback(id, token), { body, auth: false });
        logger.info(
          {
            event: "command.handled",
            commandName,
            outcome: result.kind,
            durationMs: Math.round(performance.now() - startedAt),
          },
          "Command handled",
        );
      })
      .catch((error: unknown) => {
        logger.error({ event: "command.reply_failed", commandName, err: error }, "Couldn't reply");
      });
  });
}
