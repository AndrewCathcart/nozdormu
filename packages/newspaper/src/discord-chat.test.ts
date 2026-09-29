import type { Logger } from "@nozdormu/core";
import {
  type APIAttachment,
  type APIGuildMember,
  type APIMessage,
  type APIReaction,
  type APIUser,
  ApplicationFlags,
  ChannelType,
  GuildMemberFlags,
  MessageType,
  Routes,
} from "discord-api-types/v10";
import type { REST } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { createDiscordChatReader } from "./discord-chat.ts";
import { lastWeek as week } from "./test-chat.ts";

// All made up.
const guildId = "100000000000000001";
const generalId = "300000000000000003";
const forumId = "300000000000000004";

function user(id: string, username: string, globalName: string | null): APIUser {
  return { id, username, discriminator: "0", global_name: globalName, avatar: null };
}

const brannoc = user("800000000000000008", "brannoc_42", "Brannoc");
const mirelle = user("800000000000000009", "mirelle", null);

function member(person: APIUser, nick: string | null): APIGuildMember {
  return {
    user: person,
    nick,
    roles: [],
    joined_at: "2026-01-01T00:00:00.000Z",
    deaf: false,
    mute: false,
    flags: GuildMemberFlags.CompletedOnboarding,
  };
}

// The members of the made-up server, by user ID.
const everyone = {
  [brannoc.id]: member(brannoc, "Brannoc the Bold"),
  [mirelle.id]: member(mirelle, null),
};

type MessageFields = Pick<APIMessage, "id" | "timestamp" | "author" | "content"> &
  Partial<APIMessage>;

function message(fields: MessageFields): APIMessage {
  return {
    channel_id: generalId,
    edited_timestamp: null,
    tts: false,
    mention_everyone: false,
    mentions: [],
    mention_roles: [],
    attachments: [],
    embeds: [],
    pinned: false,
    type: MessageType.Default,
    ...fields,
  };
}

// Brannoc's message on Wednesday 23 September at 08:58 UK time.
function brannocSays(content: string, fields: Partial<APIMessage> = {}): APIMessage {
  return message({
    id: "1552000000000000002",
    timestamp: "2026-09-23T07:58:00.000Z",
    author: brannoc,
    content,
    ...fields,
  });
}

function attachment(id: string): APIAttachment {
  return {
    id,
    filename: "screenshot.png",
    size: 1024,
    url: `https://cdn.example/${id}`,
    proxy_url: `https://media.example/${id}`,
  };
}

function reaction(count: number, emoji: string): APIReaction {
  return {
    count,
    count_details: { burst: 0, normal: count },
    me: false,
    me_burst: false,
    emoji: { id: null, name: emoji },
    burst_colors: [],
  };
}

interface FakeDiscord {
  // The app's flags, which say whether it has the Message Content intent.
  readonly appFlags?: number;
  readonly channels: Readonly<
    Record<
      string,
      { readonly name: string; readonly type: ChannelType; readonly pages: APIMessage[][] }
    >
  >;
  // A member that isn't listed has left the server. An error is what looking them up throws.
  readonly members?: Readonly<Record<string, APIGuildMember | Error>>;
}

// Answers the reader's requests from made-up channels, pages of messages (newest first) and
// server members.
function createFakeRest(discord: FakeDiscord) {
  const pagesServed = new Map<string, number>();
  const members = discord.members ?? everyone;
  return {
    get: vi.fn<REST["get"]>((route) => {
      if (route === Routes.currentApplication()) {
        return Promise.resolve({
          flags: discord.appFlags ?? ApplicationFlags.GatewayMessageContentLimited,
        });
      }
      for (const [channelId, channel] of Object.entries(discord.channels)) {
        if (route === Routes.channel(channelId)) {
          return Promise.resolve({ id: channelId, name: channel.name, type: channel.type });
        }
        if (route === Routes.channelMessages(channelId)) {
          const served = pagesServed.get(channelId) ?? 0;
          pagesServed.set(channelId, served + 1);
          return Promise.resolve(channel.pages[served] ?? []);
        }
      }
      for (const [userId, found] of Object.entries(members)) {
        if (route === Routes.guildMember(guildId, userId)) {
          return found instanceof Error ? Promise.reject(found) : Promise.resolve(found);
        }
      }
      // What discord.js throws for a member who has left: a request error with status 404.
      return Promise.reject(Object.assign(new Error("Unknown Member"), { status: 404 }));
    }),
  } satisfies Pick<REST, "get">;
}

// #general, with one page of messages.
function general(messages: APIMessage[]): FakeDiscord["channels"] {
  return { [generalId]: { name: "general", type: ChannelType.GuildText, pages: [messages] } };
}

function createFakeLogger() {
  return { error: vi.fn<Logger["error"]>() } satisfies Pick<Logger, "error">;
}

async function readGeneral(discord: FakeDiscord, logger = createFakeLogger()) {
  const rest = createFakeRest(discord);
  const [channel] = await createDiscordChatReader({ rest, guildId, logger })([generalId], week);
  return channel?.messages ?? [];
}

describe("createDiscordChatReader", () => {
  it("returns each channel's messages from the week, oldest first, under server nicknames", async () => {
    const rest = createFakeRest({
      channels: general([
        message({
          id: "1552500000000000002",
          timestamp: "2026-09-22T19:05:00.000Z",
          author: mirelle,
          content: "Of course you have.",
        }),
        message({
          id: "1552000000000000001",
          timestamp: "2026-09-21T08:12:00.000Z",
          author: brannoc,
          content: "I have made a spreadsheet.",
        }),
      ]),
    });
    const readChat = createDiscordChatReader({ rest, guildId, logger: createFakeLogger() });

    const chat = await readChat([generalId], week);

    expect(chat).toEqual([
      {
        name: "general",
        messages: [
          {
            authorName: "Brannoc the Bold",
            sentAt: new Date("2026-09-21T08:12:00Z"),
            text: "I have made a spreadsheet.",
            replyTo: undefined,
            reactions: 0,
            attachments: 0,
          },
          {
            authorName: "mirelle",
            sentAt: new Date("2026-09-22T19:05:00Z"),
            text: "Of course you have.",
            replyTo: undefined,
            reactions: 0,
            attachments: 0,
          },
        ],
      },
    ]);
  });

  it("pages back through the channel's history until it reaches the start of the week", async () => {
    // One message an hour, newest first, from Monday 28 September 07:00 UTC back past the week's
    // start. The first 168 fall in the week.
    const hourly = Array.from({ length: 200 }, (_, hoursBack) =>
      message({
        id: String(1553000000000000000n - BigInt(hoursBack)),
        timestamp: new Date(Date.UTC(2026, 8, 28, 7 - hoursBack)).toISOString(),
        author: brannoc,
        content: "Another hour, another tab.",
      }),
    );
    const rest = createFakeRest({
      channels: {
        [generalId]: {
          name: "general",
          type: ChannelType.GuildText,
          pages: [hourly.slice(0, 100), hourly.slice(100)],
        },
      },
    });

    const [channel] = await createDiscordChatReader({ rest, guildId, logger: createFakeLogger() })(
      [generalId],
      week,
    );

    expect(channel?.messages).toHaveLength(168);
    expect(
      rest.get.mock.calls
        .filter(([route]) => route === Routes.channelMessages(generalId))
        .map(([, options]) => options?.query?.toString()),
    ).toEqual(["before=1554039963648000000&limit=100", "before=1552999999999999901&limit=100"]);
  });

  it("leaves out messages from bots and webhooks, and Discord's own system messages", async () => {
    const messages = await readGeneral({
      channels: general([
        brannocSays("Person", { id: "1552000000000000005" }),
        brannocSays("Bot", { id: "1552000000000000004", author: { ...brannoc, bot: true } }),
        brannocSays("Webhook", { id: "1552000000000000003", webhook_id: "700000000000000007" }),
        brannocSays("", { id: "1552000000000000002", type: MessageType.UserJoin }),
      ]),
    });

    expect(messages.map((sent) => sent.text)).toEqual(["Person"]);
  });

  it("leaves out a message with no text or attachments, such as a sticker", async () => {
    const messages = await readGeneral({
      channels: general([
        brannocSays("", { id: "1552000000000000003" }),
        brannocSays("Look", { id: "1552000000000000002" }),
      ]),
    });

    expect(messages.map((sent) => sent.text)).toEqual(["Look"]);
  });

  it("names the author a message replies to, and anyone it mentions, by nickname", async () => {
    const messages = await readGeneral({
      channels: general([
        message({
          id: "1552000000000000002",
          type: MessageType.Reply,
          timestamp: "2026-09-22T19:05:00.000Z",
          author: mirelle,
          content: `<@${brannoc.id}> of course you have`,
          mentions: [brannoc],
          referenced_message: brannocSays("I have made a spreadsheet.", {
            id: "1552000000000000001",
          }),
        }),
      ]),
    });

    expect(messages[0]).toMatchObject({
      replyTo: "Brannoc the Bold",
      text: "@Brannoc the Bold of course you have",
    });
  });

  it("counts each message's reactions and attachments", async () => {
    const messages = await readGeneral({
      channels: general([
        brannocSays("My dog has learned to open the fridge.", {
          attachments: [attachment("600000000000000001"), attachment("600000000000000002")],
          reactions: [reaction(9, "😂"), reaction(5, "🧀")],
        }),
      ]),
    });

    expect(messages[0]).toMatchObject({ reactions: 14, attachments: 2 });
  });

  it("turns custom emoji and role and channel mentions into plain text", async () => {
    const messages = await readGeneral({
      channels: general([
        brannocSays(
          "gg <:pepega:123456789012345678> <a:dance:123456789012345679> see <#300000000000000004> <@&500000000000000005>",
        ),
      ]),
    });

    expect(messages[0]?.text).toBe("gg :pepega: :dance: see #channel @role");
  });

  it("uses the display name of someone who has since left the server, without logging it", async () => {
    const logger = createFakeLogger();

    const messages = await readGeneral(
      { channels: general([brannocSays("Farewell, guild.")]), members: {} },
      logger,
    );

    expect(messages[0]?.authorName).toBe("Brannoc");
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("uses display names and logs it when looking up nicknames fails", async () => {
    const logger = createFakeLogger();
    const outage = Object.assign(new Error("Service Unavailable"), { status: 503 });

    const messages = await readGeneral(
      { channels: general([brannocSays("Hello?")]), members: { [brannoc.id]: outage } },
      logger,
    );

    expect(messages[0]?.authorName).toBe("Brannoc");
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      { event: "newspaper.nicknames_failed", failures: 1, err: outage },
      "Couldn't look up some nicknames, so those members go by their display names",
    );
  });

  it("fails, naming the setting, when the bot's app doesn't have the Message Content intent", async () => {
    const rest = createFakeRest({ appFlags: 0, channels: general([brannocSays("Hello")]) });

    await expect(
      createDiscordChatReader({ rest, guildId, logger: createFakeLogger() })([generalId], week),
    ).rejects.toThrow(
      new Error(
        "The bot's Discord app doesn't have the Message Content intent, so Discord leaves out the text of messages. Turn it on in the Developer Portal.",
      ),
    );
  });

  it("fails, naming the channel, when a listed channel isn't a text channel", async () => {
    const rest = createFakeRest({
      channels: {
        ...general([brannocSays("Hello")]),
        [forumId]: { name: "guides", type: ChannelType.GuildForum, pages: [] },
      },
    });

    await expect(
      createDiscordChatReader({ rest, guildId, logger: createFakeLogger() })(
        [generalId, forumId],
        week,
      ),
    ).rejects.toThrow(
      new Error(
        `The channel ${forumId} in NEWSPAPER_CHANNEL_IDS isn't a text channel, so the newspaper can't read it.`,
      ),
    );
  });
});
