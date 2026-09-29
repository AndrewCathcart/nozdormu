import type { Logger } from "@nozdormu/core";
import { ApplicationFlags, ChannelType, MessageType, Routes } from "discord-api-types/v10";
import type { REST } from "discord.js";
import { z } from "zod";
import type { ChatChannel, ChatMessage, ChatReader } from "./chat.ts";

const channel = z.object({ name: z.string(), type: z.number() });

const user = z.object({
  id: z.string(),
  username: z.string(),
  global_name: z.string().nullish(),
  bot: z.boolean().optional(),
});

type User = z.infer<typeof user>;

const apiMessage = z.object({
  id: z.string(),
  type: z.number(),
  timestamp: z.string(),
  author: user,
  content: z.string(),
  webhook_id: z.string().optional(),
  mentions: z.array(user).default([]),
  attachments: z.array(z.object({ id: z.string() })).default([]),
  reactions: z.array(z.object({ count: z.number() })).default([]),
  // Null when the message replied to has been deleted.
  referenced_message: z.object({ author: user }).nullish(),
});

type ApiMessage = z.infer<typeof apiMessage>;

// A user mention as Discord stores it in a message's text: <@id>, or <@!id> from older clients.
const userMention = /<@!?(\d+)>/g;

// Other markup Discord stores as IDs, turned into something readable.
const readableMarkup: readonly (readonly [RegExp, string])[] = [
  // A server's custom emoji, still or animated.
  [/<a?:(\w+):\d+>/g, ":$1:"],
  [/<@&\d+>/g, "@role"],
  [/<#\d+>/g, "#channel"],
];

function displayName(person: User): string {
  return person.global_name ?? person.username;
}

const messagePage = z.array(apiMessage);

// The most messages Discord returns in one request.
const pageSize = 100;

// The message types people write. The others are Discord's own, such as a member joining or a
// message being pinned.
const writtenTypes: ReadonlySet<number> = new Set([MessageType.Default, MessageType.Reply]);

// Something a person wrote: not a bot, webhook or system message.
function writtenByAPerson(sent: ApiMessage): boolean {
  return sent.author.bot !== true && sent.webhook_id === undefined && writtenTypes.has(sent.type);
}

// Text or an attachment. A sticker on its own, for example, has neither.
function hasSomethingToRead(sent: ApiMessage): boolean {
  return sent.content !== "" || sent.attachments.length > 0;
}

const member = z.object({ nick: z.string().nullish() });

// What discord.js throws when there's no such member: a request error with status 404.
const notFound = z.object({ status: z.literal(404) });

const application = z.object({ flags: z.number().default(0) });

// Either flag means Discord sends message text to the app: the first for apps in 100 or more
// servers that Discord approved, the second for smaller apps with the intent turned on.
const messageContentFlags =
  ApplicationFlags.GatewayMessageContent | ApplicationFlags.GatewayMessageContentLimited;

// Channels whose messages can be read: text, announcement and voice channels' chat. Not forums,
// whose posts are all threads, or categories.
const textChannelTypes: ReadonlySet<number> = new Set([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildVoice,
]);

// Discord's IDs start with the milliseconds since 2015, so the ID made from a moment sorts before
// every message sent at or after it.
const discordEpoch = 1_420_070_400_000n;
function idAt(moment: Date): string {
  return String((BigInt(moment.getTime()) - discordEpoch) << 22n);
}

export interface DiscordChatReaderDeps {
  readonly rest: Pick<REST, "get">;
  readonly guildId: string;
  readonly logger: Pick<Logger, "error">;
}

export function createDiscordChatReader({
  rest,
  guildId,
  logger,
}: DiscordChatReaderDeps): ChatReader {
  return async (channelIds, week) => {
    const { flags } = application.parse(await rest.get(Routes.currentApplication()));
    if ((flags & messageContentFlags) === 0) {
      throw new Error(
        "The bot's Discord app doesn't have the Message Content intent, so Discord leaves out the text of messages. Turn it on in the Developer Portal.",
      );
    }

    // Each person's server nickname is looked up once per issue. Without one, or if the lookup
    // fails, they go by their display name.
    const names = new Map<string, Promise<string>>();
    const failedLookups: unknown[] = [];
    const nameOf = (userId: string, fallback: string): Promise<string> => {
      let name = names.get(userId);
      if (name === undefined) {
        name = rest
          .get(Routes.guildMember(guildId, userId))
          .then((body) => member.parse(body).nick ?? fallback)
          .catch((error: unknown) => {
            // Someone who has left the server has no member to look up, which is expected.
            if (!notFound.safeParse(error).success) {
              failedLookups.push(error);
            }
            return fallback;
          });
        names.set(userId, name);
      }
      return name;
    };

    // The message's text with each <@id> replaced by @ and the person's name, and other markup
    // made readable.
    const readableText = async (sent: ApiMessage): Promise<string> => {
      const mentioned = new Map<string, string>();
      for (const [, userId = ""] of sent.content.matchAll(userMention)) {
        const person = sent.mentions.find((candidate) => candidate.id === userId);
        mentioned.set(
          userId,
          await nameOf(userId, person === undefined ? "someone" : displayName(person)),
        );
      }
      const withNames = sent.content.replaceAll(
        userMention,
        (_mention, userId: string) => `@${mentioned.get(userId) ?? "someone"}`,
      );
      return readableMarkup.reduce(
        (text, [markup, replacement]) => text.replaceAll(markup, replacement),
        withNames,
      );
    };

    const toChatMessage = async (sent: ApiMessage): Promise<ChatMessage> => {
      const repliedTo = sent.referenced_message?.author;
      return {
        authorName: await nameOf(sent.author.id, displayName(sent.author)),
        sentAt: new Date(sent.timestamp),
        text: await readableText(sent),
        replyTo:
          repliedTo === undefined ? undefined : await nameOf(repliedTo.id, displayName(repliedTo)),
        reactions: sent.reactions.reduce((total, reaction) => total + reaction.count, 0),
        attachments: sent.attachments.length,
      };
    };

    // Discord returns up to 100 messages before a given ID, newest first, so this pages backwards
    // from the end of the week until a page reaches its start.
    const readWeek = async (channelId: string): Promise<ApiMessage[]> => {
      const inWeek: ApiMessage[] = [];
      let before = idAt(week.to);
      for (;;) {
        const page = messagePage.parse(
          await rest.get(Routes.channelMessages(channelId), {
            query: new URLSearchParams({ before, limit: String(pageSize) }),
          }),
        );
        inWeek.push(
          ...page.filter((sent) => new Date(sent.timestamp) >= week.from && writtenByAPerson(sent)),
        );
        const oldest = page.reduce<ApiMessage | undefined>(
          (found, sent) =>
            found === undefined || BigInt(sent.id) < BigInt(found.id) ? sent : found,
          undefined,
        );
        if (
          page.length < pageSize ||
          oldest === undefined ||
          new Date(oldest.timestamp) < week.from
        ) {
          return inWeek;
        }
        before = oldest.id;
      }
    };

    const readChannel = async (channelId: string): Promise<ChatChannel> => {
      const { name, type } = channel.parse(await rest.get(Routes.channel(channelId)));
      if (!textChannelTypes.has(type)) {
        throw new Error(
          `The channel ${channelId} in NEWSPAPER_CHANNEL_IDS isn't a text channel, so the newspaper can't read it.`,
        );
      }
      const sentInWeek = await readWeek(channelId);
      const messages = await Promise.all(sentInWeek.filter(hasSomethingToRead).map(toChatMessage));
      return {
        name,
        messages: messages.toSorted((a, b) => a.sentAt.getTime() - b.sentAt.getTime()),
      };
    };

    const chat = await Promise.all(channelIds.map(readChannel));
    if (failedLookups.length > 0) {
      logger.error(
        {
          event: "newspaper.nicknames_failed",
          failures: failedLookups.length,
          err: failedLookups[0],
        },
        "Couldn't look up some nicknames, so those members go by their display names",
      );
    }
    return chat;
  };
}
