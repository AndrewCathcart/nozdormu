import {
  type ChannelMessage,
  type ChannelPublisher,
  type Feature,
  latestWeeklyTime,
  type Logger,
  type WeeklyTime,
} from "@nozdormu/core";
import { MessageFlags } from "discord-api-types/v10";
import { type ChatChannel, type ChatReader, latestChat, type Week } from "./chat.ts";
import type { Cartoon, DigestWriter, Illustration, Illustrator } from "./digest.ts";
import { captionedMasthead, renderDigest } from "./render.ts";
import { ukTimeZone } from "./uk-time.ts";

export interface DigestFeatureDeps {
  // The channels whose chat the digest covers.
  readonly channelIds: readonly string[];
  // The channel each digest is posted in.
  readonly postChannelId: string;
  readonly readChat: ChatReader;
  readonly write: DigestWriter;
  // Draws the cartoon posted with the masthead.
  readonly draw: Illustrator;
  readonly publish: ChannelPublisher;
  readonly now: () => Date;
  readonly logger: Pick<Logger, "info" | "error">;
}

// Of transcript: about 100,000 tokens, roughly $0.40 of input to Claude Opus 5.5.
const maxChatCharacters = 400_000;

// Each digest comes out on Monday morning, UK time.
const publishedAt = {
  day: "monday",
  hour: 9,
  minute: 0,
  timeZone: ukTimeZone,
} satisfies WeeklyTime;

// The week up to the latest publishing time: Monday 09:00 to Monday 09:00. A late run, or one run
// by hand midweek, still covers that week.
function latestWeek(now: Date): Week {
  const to = latestWeeklyTime(publishedAt, now);
  return { from: latestWeeklyTime(publishedAt, new Date(to.getTime() - 1)), to };
}

// Lower-case words between single spaces, so " brannoc s " (from "Brannoc's") holds " brannoc ".
function spacedWords(text: string): string {
  const words = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "");
  return ` ${words.join(" ")} `;
}

// Whether the scene names anyone who wrote in the week's chat, or was replied to, as whole words.
function namesSomeone(scene: string, chat: readonly ChatChannel[]): boolean {
  const sceneWords = spacedWords(scene);
  const names = new Set(
    chat.flatMap((channel) =>
      channel.messages.flatMap((message) => [message.authorName, message.replyTo ?? ""]),
    ),
  );
  return [...names].some((name) => {
    const nameWords = spacedWords(name);
    return nameWords.trim() !== "" && sceneWords.includes(nameWords);
  });
}

// Every Monday morning, posts a catch-up on the week's chat, so members don't have to scroll back
// through all of it.
export function createDigestFeature(deps: DigestFeatureDeps): Feature {
  // A digest without its picture is still worth posting. The scene goes to OpenAI, so one that
  // names anyone from the week's chat isn't drawn, whatever Claude was asked.
  const drawCartoon = async (
    cartoon: Cartoon | undefined,
    chat: readonly ChatChannel[],
  ): Promise<Illustration | undefined> => {
    if (cartoon === undefined) {
      deps.logger.info(
        { event: "digest.no_cartoon" },
        "Claude described no scene, so the digest goes without a picture",
      );
      return undefined;
    }
    if (namesSomeone(cartoon.scene, chat)) {
      deps.logger.error(
        { event: "digest.scene_names_member" },
        "Claude named someone from the chat in the scene, so the digest goes without a picture",
      );
      return undefined;
    }
    try {
      return await deps.draw(cartoon.scene);
    } catch (error) {
      deps.logger.error(
        { event: "digest.illustration_failed", err: error },
        "Couldn't draw this week's picture, so the digest goes without one",
      );
      return undefined;
    }
  };

  // The masthead goes again without the picture if Discord won't take it (without Attach Files, say).
  // It carries the same nonce, so if the first try did get through, Discord doesn't post it twice.
  // With the picture, the masthead also carries its caption, which shows above it.
  const postWithPicture = async (
    message: ChannelMessage,
    picture: Illustration,
    caption: string | undefined,
  ): Promise<void> => {
    const captioned =
      caption === undefined
        ? message
        : { ...message, content: captionedMasthead(message.content ?? "", caption) };
    try {
      await deps.publish(deps.postChannelId, captioned, [picture]);
    } catch (error) {
      deps.logger.error(
        { event: "digest.picture_post_failed", err: error },
        "Discord wouldn't take this week's picture, so the digest goes without one",
      );
      await deps.publish(deps.postChannelId, message, []);
    }
  };

  const publishDigest = async (): Promise<void> => {
    const week = latestWeek(deps.now());
    const weekOfChat = await deps.readChat(deps.channelIds, week);
    const { chat, kept, dropped } = latestChat(weekOfChat, maxChatCharacters);
    if (dropped > 0) {
      deps.logger.info(
        { event: "digest.chat_trimmed", keptMessages: kept, droppedMessages: dropped },
        "Left the week's oldest chat out to stay within the limit",
      );
    }
    if (kept === 0) {
      deps.logger.info(
        { event: "digest.quiet_week", from: week.from, to: week.to },
        "Nobody wrote anything this week, so there's no digest",
      );
      return;
    }
    const digest = await deps.write(chat, week);
    if (digest.sections.length === 0) {
      throw new Error("Claude wrote a digest with no sections.");
    }
    const picture = await drawCartoon(digest.cartoon, chat);
    const messages = renderDigest(week, digest);
    const postedOn = week.to.toISOString().slice(0, 10);
    for (const [index, content] of messages.entries()) {
      const message = {
        content,
        allowed_mentions: { parse: [] },
        flags: MessageFlags.SuppressEmbeds,
        nonce: `digest-${postedOn}-${String(index)}`,
        enforce_nonce: true,
      } satisfies ChannelMessage;
      if (index === 0 && picture !== undefined) {
        await postWithPicture(message, picture, digest.cartoon?.caption);
      } else {
        await deps.publish(deps.postChannelId, message, []);
      }
    }
    deps.logger.info(
      {
        event: "digest.published",
        chatMessages: kept,
        sections: digest.sections.length,
        discordMessages: messages.length,
      },
      "Published this week's digest",
    );
  };

  return { jobs: [{ name: "digest.publish", weekly: publishedAt, run: publishDigest }] };
}
