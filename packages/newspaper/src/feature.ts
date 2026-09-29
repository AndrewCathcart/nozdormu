import {
  type ChannelPublisher,
  type Feature,
  latestWeeklyTime,
  type Logger,
  type WeeklyTime,
} from "@nozdormu/core";
import { MessageFlags } from "discord-api-types/v10";
import { type ChatReader, latestChat, type Week } from "./chat.ts";
import type { IssueWriter, Paper } from "./issue.ts";
import { renderIssue } from "./render.ts";
import { newspaperTimeZone } from "./uk-time.ts";

export interface NewspaperFeatureDeps {
  // The channels whose chat the newspaper covers.
  readonly channelIds: readonly string[];
  // The channel each issue is posted in.
  readonly postChannelId: string;
  readonly paper: Paper;
  readonly readChat: ChatReader;
  readonly write: IssueWriter;
  readonly publish: ChannelPublisher;
  readonly now: () => Date;
  readonly logger: Pick<Logger, "info">;
}

// Of transcript: about 100,000 tokens, roughly $0.40 of input to Claude Opus 5.5.
const maxChatCharacters = 400_000;

// Each issue comes out on Monday morning, UK time.
const publishedAt = {
  day: "monday",
  hour: 9,
  minute: 0,
  timeZone: newspaperTimeZone,
} satisfies WeeklyTime;

// The week up to the latest publishing time: Monday 09:00 to Monday 09:00. A late run, or one run
// by hand midweek, still covers that week.
function latestWeek(now: Date): Week {
  const to = latestWeeklyTime(publishedAt, now);
  return { from: latestWeeklyTime(publishedAt, new Date(to.getTime() - 1)), to };
}

export function createNewspaperFeature(deps: NewspaperFeatureDeps): Feature {
  const publishIssue = async (): Promise<void> => {
    const week = latestWeek(deps.now());
    const weekOfChat = await deps.readChat(deps.channelIds, week);
    const { chat, kept, dropped } = latestChat(weekOfChat, maxChatCharacters);
    if (dropped > 0) {
      deps.logger.info(
        { event: "newspaper.chat_trimmed", keptMessages: kept, droppedMessages: dropped },
        "Left the week's oldest chat out to stay within the limit",
      );
    }
    if (kept === 0) {
      deps.logger.info(
        { event: "newspaper.quiet_week", from: week.from, to: week.to },
        "Nobody wrote anything this week, so there's no issue",
      );
      return;
    }
    const issue = await deps.write(chat, week);
    if (issue.stories.length === 0) {
      throw new Error("Claude wrote an issue with no stories.");
    }
    const messages = renderIssue(deps.paper.name, week.to, issue);
    const issueDate = week.to.toISOString().slice(0, 10);
    for (const [index, content] of messages.entries()) {
      await deps.publish(deps.postChannelId, {
        content,
        allowed_mentions: { parse: [] },
        flags: MessageFlags.SuppressEmbeds,
        nonce: `news-${issueDate}-${String(index)}`,
        enforce_nonce: true,
      });
    }
    deps.logger.info(
      {
        event: "newspaper.published",
        chatMessages: kept,
        stories: issue.stories.length,
        discordMessages: messages.length,
      },
      "Published this week's newspaper",
    );
  };

  return { jobs: [{ name: "newspaper.publish", weekly: publishedAt, run: publishIssue }] };
}
