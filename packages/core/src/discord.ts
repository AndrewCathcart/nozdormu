import {
  InteractionResponseType,
  Routes,
  type RESTPostAPIChannelMessageJSONBody,
  type RESTPostAPIInteractionCallbackJSONBody,
} from "discord-api-types/v10";
import { type Client, Events, type RawFile, type REST } from "discord.js";
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

// Sends every slash command to the registry and replies with whatever it returns, answers
// autocomplete requests with the registry's suggestions, and answers button presses by updating
// the message the button is on, or with a new reply.
export function routeInteractions(
  client: Client,
  rest: REST,
  registry: Registry,
  logger: Pick<Logger, "info" | "error">,
): void {
  client.on(Events.InteractionCreate, (interaction) => {
    if (interaction.isAutocomplete()) {
      const { commandName, id, token } = interaction;
      const focused = interaction.options.getFocused(true);
      registry
        .autocomplete({ commandName, optionName: focused.name, value: focused.value })
        .then(async (choices) => {
          const body = {
            type: InteractionResponseType.ApplicationCommandAutocompleteResult,
            data: { choices: [...choices] },
          } satisfies RESTPostAPIInteractionCallbackJSONBody;
          await rest.post(Routes.interactionCallback(id, token), { body, auth: false });
        })
        .catch((error: unknown) => {
          logger.error(
            { event: "autocomplete.reply_failed", commandName, err: error },
            "Couldn't send suggestions",
          );
        });
      return;
    }
    if (interaction.isButton()) {
      const { customId, id, token } = interaction;
      const startedAt = performance.now();
      registry
        .press({ customId })
        .then(async (result) => {
          const body = {
            type:
              result.response.kind === "update"
                ? InteractionResponseType.UpdateMessage
                : InteractionResponseType.ChannelMessageWithSource,
            data: result.response.message,
          } satisfies RESTPostAPIInteractionCallbackJSONBody;
          await rest.post(Routes.interactionCallback(id, token), { body, auth: false });
          logger.info(
            {
              event: "button.handled",
              commandName: result.commandName,
              outcome: result.kind,
              durationMs: Math.round(performance.now() - startedAt),
            },
            "Button press handled",
          );
        })
        .catch((error: unknown) => {
          logger.error({ event: "button.reply_failed", err: error }, "Couldn't answer a button");
        });
      return;
    }
    if (!interaction.isChatInputCommand()) {
      return;
    }
    const { commandName, id, token } = interaction;
    const options = new Map(
      interaction.options.data.flatMap((option) =>
        option.value === undefined ? [] : [[option.name, option.value] as const],
      ),
    );
    const startedAt = performance.now();
    registry
      .dispatch({ commandName, options })
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

// Posts a message in a channel through Discord's REST API, uploading any files with it.
export type ChannelPublisher = (
  channelId: string,
  message: ChannelMessage,
  files?: readonly RawFile[],
) => Promise<void>;

export function createChannelPublisher(rest: Pick<REST, "post">): ChannelPublisher {
  return async (channelId, message, files = []) => {
    await rest.post(Routes.channelMessages(channelId), {
      body: message,
      files: [...files],
    });
  };
}

// Reads the text of the bot's own messages among a channel's most recent 50.
export type RecentPostReader = (channelId: string) => Promise<readonly string[]>;

const currentUser = z.object({ id: z.string() });
const recentMessages = z.array(
  z.object({ author: z.object({ id: z.string() }), content: z.string() }),
);

export function createRecentPostReader(rest: Pick<REST, "get">): RecentPostReader {
  let botUserId: Promise<string> | undefined;
  return async (channelId) => {
    // Cached once it succeeds. A failed lookup is forgotten, so the next check tries again.
    botUserId ??= rest
      .get(Routes.user())
      .then((body) => currentUser.parse(body).id)
      .catch((error: unknown) => {
        botUserId = undefined;
        throw error;
      });
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
