import type { ChannelPublisher, Logger, ScheduledJob } from "@nozdormu/core";
import { describe, expect, it, vi } from "vitest";
import type { ChatChannel, ChatReader } from "./chat.ts";
import { createNewspaperFeature, type NewspaperFeatureDeps } from "./feature.ts";
import type { Issue, IssueWriter } from "./issue.ts";
import { chatMessage, lastWeek } from "./test-chat.ts";

// Made up.
const generalId = "300000000000000003";
const raidsId = "300000000000000004";
const newsId = "300000000000000005";

// Tuesday 29 September 2026, so the latest issue was due on Monday 28 September at 09:00 UK time.
const tuesday = new Date("2026-09-29T12:00:00Z");
const someChat = [
  { name: "general", messages: [chatMessage()] },
  { name: "raid-planning", messages: [] },
] satisfies ChatChannel[];

const anIssue = {
  stories: [{ headline: "SPREADSHEET SHOCK", body: "Brannoc has made a spreadsheet." }],
} satisfies Issue;

function createDeps(chat: ChatChannel[] = someChat, issue: Issue = anIssue) {
  return {
    channelIds: [generalId, raidsId],
    postChannelId: newsId,
    paper: { name: "The Test Gazette", voice: "You are a made-up test voice." },
    readChat: vi.fn<ChatReader>().mockResolvedValue(chat),
    write: vi.fn<IssueWriter>().mockResolvedValue(issue),
    publish: vi.fn<ChannelPublisher>().mockResolvedValue(undefined),
    now: () => tuesday,
    logger: { info: vi.fn<Logger["info"]>() } satisfies Pick<Logger, "info">,
  } satisfies NewspaperFeatureDeps;
}

function publishJob(deps: NewspaperFeatureDeps): ScheduledJob {
  const [job] = createNewspaperFeature(deps).jobs ?? [];
  if (job === undefined) {
    throw new Error("The newspaper has no job.");
  }
  return job;
}

describe("createNewspaperFeature", () => {
  it("publishes every Monday at 09:00 UK time", () => {
    const job = publishJob(createDeps());

    expect(job).toMatchObject({
      name: "newspaper.publish",
      weekly: { day: "monday", hour: 9, minute: 0, timeZone: "Europe/London" },
    });
  });

  it("reads the listed channels' chat from the week before the latest Monday 09:00", async () => {
    const deps = createDeps();

    await publishJob(deps).run();

    expect(deps.readChat).toHaveBeenCalledExactlyOnceWith([generalId, raidsId], lastWeek);
  });

  it("posts the issue Claude wrote in the news channel, pinging nobody", async () => {
    const deps = createDeps();

    await publishJob(deps).run();

    expect(deps.write).toHaveBeenCalledExactlyOnceWith(someChat, lastWeek);
    expect(deps.publish).toHaveBeenCalledExactlyOnceWith(newsId, {
      content: [
        "# 📰 The Test Gazette",
        "-# Monday 28 September 2026",
        "",
        "## SPREADSHEET SHOCK",
        "Brannoc has made a spreadsheet.",
      ].join("\n"),
      allowed_mentions: { parse: [] },
      // No link previews.
      flags: 4,
      // Discord drops a repeat of the same message sent within a few minutes.
      nonce: "news-2026-09-28-0",
      enforce_nonce: true,
    });
  });

  it("skips a week when nobody wrote anything, without asking Claude", async () => {
    const deps = createDeps([
      { name: "general", messages: [] },
      { name: "raid-planning", messages: [] },
    ]);

    await publishJob(deps).run();

    expect(deps.write).not.toHaveBeenCalled();
    expect(deps.publish).not.toHaveBeenCalled();
    expect(deps.logger.info).toHaveBeenCalledExactlyOnceWith(
      { event: "newspaper.quiet_week", from: lastWeek.from, to: lastWeek.to },
      "Nobody wrote anything this week, so there's no issue",
    );
  });

  it("fails without posting when Claude writes no stories", async () => {
    const deps = createDeps(someChat, { stories: [] });

    await expect(publishJob(deps).run()).rejects.toThrow(
      new Error("Claude wrote an issue with no stories."),
    );
    expect(deps.publish).not.toHaveBeenCalled();
  });

  it("logs how much chat went into the issue and how it was posted", async () => {
    const deps = createDeps();

    await publishJob(deps).run();

    expect(deps.logger.info).toHaveBeenCalledExactlyOnceWith(
      { event: "newspaper.published", chatMessages: 1, stories: 1, discordMessages: 1 },
      "Published this week's newspaper",
    );
  });

  it("gives Claude only the latest 400,000 characters of a very long week", async () => {
    // 500 messages of 1,000 characters, a minute apart from the start of the week. Each takes 1,029
    // characters of transcript with its time, author and line break, and the channel's heading
    // 10, so the latest 388 fit.
    const messages = Array.from({ length: 500 }, (_, minutes) =>
      chatMessage({
        sentAt: new Date(lastWeek.from.getTime() + minutes * 60_000),
        text: "a".repeat(1000),
      }),
    );
    const deps = createDeps([{ name: "general", messages }]);

    await publishJob(deps).run();

    const [chatSent] = deps.write.mock.calls[0] ?? [];
    expect(chatSent?.[0]?.messages).toEqual(messages.slice(112));
    expect(deps.logger.info).toHaveBeenCalledWith(
      { event: "newspaper.chat_trimmed", keptMessages: 388, droppedMessages: 112 },
      "Left the week's oldest chat out to stay within the limit",
    );
  });
});
