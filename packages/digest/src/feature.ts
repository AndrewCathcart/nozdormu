import {
  type ChannelPublisher,
  type Feature,
  latestWeeklyTime,
  type Logger,
  type WeeklyTime,
} from "@nozdormu/core";
import { MessageFlags } from "discord-api-types/v10";
import { type ChatReader, latestChat, type Week } from "./chat.ts";
import type { DigestWriter, Illustration, Illustrator } from "./digest.ts";
import { renderDigest } from "./render.ts";
import { ukTimeZone } from "./uk-time.ts";

export interface DigestFeatureDeps {
  // The channels whose chat the digest covers.
  readonly channelIds: readonly string[];
  // The channel each digest is posted in.
  readonly postChannelId: string;
  readonly readChat: ChatReader;
  readonly write: DigestWriter;
  // Paints the picture posted with the masthead.
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

// Every Monday morning, posts a catch-up on the week's chat, so members don't have to scroll back
// through all of it.
export function createDigestFeature(deps: DigestFeatureDeps): Feature {
  // A digest without its picture is still worth posting.
  const drawPicture = async (scene: string): Promise<Illustration | undefined> => {
    try {
      return await deps.draw(scene);
    } catch (error) {
      deps.logger.error(
        { event: "digest.illustration_failed", err: error },
        "Couldn't draw this week's picture, so the digest goes without one",
      );
      return undefined;
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
    const picture = await drawPicture(digest.illustration);
    const messages = renderDigest(week, digest);
    const postedOn = week.to.toISOString().slice(0, 10);
    for (const [index, content] of messages.entries()) {
      await deps.publish(
        deps.postChannelId,
        {
          content,
          allowed_mentions: { parse: [] },
          flags: MessageFlags.SuppressEmbeds,
          nonce: `digest-${postedOn}-${String(index)}`,
          enforce_nonce: true,
        },
        index === 0 && picture !== undefined ? [picture] : [],
      );
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
