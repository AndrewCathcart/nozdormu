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

// Sends every slash command to the registry and replies with whatever it returns, and answers
// autocomplete requests with the registry's suggestions.
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

// Discord allows about 5 messages per 5 seconds in a channel. Posts go out one at a time with this
// gap after each, so a batch (say, several staff posts after downtime) never bursts.
const postGapMs = 1_500;

function pause(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, postGapMs));
}

export function createChannelPublisher(rest: Pick<REST, "post">): ChannelPublisher {
  let ready = Promise.resolve();
  return async (channelId, message, files = []) => {
    const posted = ready.then(() =>
      rest.post(Routes.channelMessages(channelId), {
        body: message,
        ...(files.length > 0 ? { files: [...files] } : {}),
      }),
    );
    ready = posted.then(pause, pause);
    await posted;
  };
}

// One of the bot's own messages: its text, and the links of its cards.
export interface RecentPost {
  readonly content: string;
  readonly embedUrls: readonly string[];
}

// Reads the bot's own messages among a channel's most recent 50.
export type RecentPostReader = (channelId: string) => Promise<readonly RecentPost[]>;

const currentUser = z.object({ id: z.string() });
const recentMessages = z.array(
  z.object({
    author: z.object({ id: z.string() }),
    content: z.string(),
    embeds: z.array(z.object({ url: z.string().optional() })),
  }),
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
      .map((message) => ({
        content: message.content,
        embedUrls: message.embeds.flatMap((embed) => (embed.url === undefined ? [] : [embed.url])),
      }));
  };
}
