import {
  InteractionResponseType,
  Routes,
  type RESTPostAPIChannelMessageJSONBody,
  type RESTPostAPIInteractionCallbackJSONBody,
} from "discord-api-types/v10";
import { type Client, Events, type REST } from "discord.js";
import type { Logger } from "pino";
import { z } from "zod";
import type { GuildTarget } from "./command-registration.ts";
import type { CommandDefinition } from "./feature.ts";
import type { Registry } from "./registry.ts";

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

export type ChannelMessage = RESTPostAPIChannelMessageJSONBody;

// Posts a message in a channel through Discord's REST API.
export type ChannelPublisher = (channelId: string, message: ChannelMessage) => Promise<void>;

export function createChannelPublisher(rest: REST): ChannelPublisher {
  return async (channelId, message) => {
    await rest.post(Routes.channelMessages(channelId), { body: message });
  };
}

// Reads the text of the bot's own messages among a channel's most recent 50.
export type RecentPostReader = (channelId: string) => Promise<readonly string[]>;

const currentUser = z.object({ id: z.string() });
const recentMessages = z.array(
  z.object({ author: z.object({ id: z.string() }), content: z.string() }),
);

export function createRecentPostReader(rest: REST): RecentPostReader {
  let botUserId: Promise<string> | undefined;
  return async (channelId) => {
    botUserId ??= rest.get(Routes.user()).then((body) => currentUser.parse(body).id);
    const [me, messages] = await Promise.all([
      botUserId,
      rest.get(Routes.channelMessages(channelId), { query: new URLSearchParams({ limit: "50" }) }),
    ]);
    return recentMessages
      .parse(messages)
      .filter((message) => message.author.id === me)
      .map((message) => message.content);
  };
}
