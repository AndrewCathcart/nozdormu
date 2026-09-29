import type { ChannelPublisher, Logger, ScheduledJob } from "@nozdormu/core";
import { describe, expect, it, vi } from "vitest";
import type { ChatChannel, ChatReader } from "./chat.ts";
import type { Digest, DigestWriter, Illustration, Illustrator } from "./digest.ts";
import { createDigestFeature, type DigestFeatureDeps } from "./feature.ts";
import { chatMessage, lastWeek } from "./test-chat.ts";

// Made up.
const generalId = "300000000000000003";
const raidsId = "300000000000000004";
const postId = "300000000000000005";

// Tuesday 29 September 2026, so the latest digest was due on Monday 28 September at 09:00 UK time.
const tuesday = new Date("2026-09-29T12:00:00Z");
const someChat = [
  { name: "general", messages: [chatMessage()] },
  { name: "raid-planning", messages: [] },
] satisfies ChatChannel[];

const aDigest = {
  sections: [{ heading: "Decided", body: "- Brannoc has made a spreadsheet." }],
  cartoon: {
    scene: "A dwarf warrior proudly unrolls an enormous spreadsheet across a tavern table.",
    caption: "The week Brannoc made a spreadsheet.",
  },
} satisfies Digest;

const aPicture = {
  data: new Uint8Array([1, 2, 3]),
  name: "this-week.jpg",
} satisfies Illustration;

const masthead = "# 📰 This week in the guild\n-# Monday 21 September to Monday 28 September 2026";
const captioned = `${masthead}\n\n*The week Brannoc made a spreadsheet.*`;

// A publisher that fails any post with a file, as Discord does without Attach Files.
function refusingPictures(error: Error): ChannelPublisher {
  return (_channelId, _message, files = []) =>
    files.length > 0 ? Promise.reject(error) : Promise.resolve();
}

function createDeps(chat: ChatChannel[] = someChat, digest: Digest = aDigest) {
  return {
    channelIds: [generalId, raidsId],
    postChannelId: postId,
    readChat: vi.fn<ChatReader>().mockResolvedValue(chat),
    write: vi.fn<DigestWriter>().mockResolvedValue(digest),
    draw: vi.fn<Illustrator>().mockResolvedValue(aPicture),
    publish: vi.fn<ChannelPublisher>().mockResolvedValue(undefined),
    now: () => tuesday,
    logger: {
      info: vi.fn<Logger["info"]>(),
      error: vi.fn<Logger["error"]>(),
    } satisfies Pick<Logger, "info" | "error">,
  } satisfies DigestFeatureDeps;
}

function publishJob(deps: DigestFeatureDeps): ScheduledJob {
  const [job] = createDigestFeature(deps).jobs ?? [];
  if (job === undefined) {
    throw new Error("The digest has no job.");
  }
  return job;
}

describe("createDigestFeature", () => {
  it("publishes every Monday at 09:00 UK time", () => {
    const job = publishJob(createDeps());

    expect(job).toMatchObject({
      name: "digest.publish",
      weekly: { day: "monday", hour: 9, minute: 0, timeZone: "Europe/London" },
    });
  });

  it("reads the listed channels' chat from the week before the latest Monday 09:00", async () => {
    const deps = createDeps();

    await publishJob(deps).run();

    expect(deps.readChat).toHaveBeenCalledExactlyOnceWith([generalId, raidsId], lastWeek);
  });

  it("has Claude write the digest from the week's chat", async () => {
    const deps = createDeps();

    await publishJob(deps).run();

    expect(deps.write).toHaveBeenCalledExactlyOnceWith(someChat, lastWeek);
  });

  it("has the scene Claude described drawn", async () => {
    const deps = createDeps();

    await publishJob(deps).run();

    expect(deps.draw).toHaveBeenCalledExactlyOnceWith(
      "A dwarf warrior proudly unrolls an enormous spreadsheet across a tavern table.",
    );
  });

  it("posts the masthead with the picture, then the digest, pinging nobody", async () => {
    const deps = createDeps();

    await publishJob(deps).run();

    expect(deps.publish.mock.calls).toEqual([
      [
        postId,
        {
          content: captioned,
          allowed_mentions: { parse: [] },
          // No link previews.
          flags: 4,
          // Discord drops a repeat of the same message sent within a few minutes.
          nonce: "digest-2026-09-28-0",
          enforce_nonce: true,
        },
        [aPicture],
      ],
      [
        postId,
        {
          content: "## Decided\n- Brannoc has made a spreadsheet.",
          allowed_mentions: { parse: [] },
          flags: 4,
          nonce: "digest-2026-09-28-1",
          enforce_nonce: true,
        },
        [],
      ],
    ]);
  });

  it("leaves the caption out when the cartoon has none", async () => {
    const deps = createDeps(someChat, {
      ...aDigest,
      cartoon: { scene: "A dwarf warrior unrolls a spreadsheet.", caption: undefined },
    });

    await publishJob(deps).run();

    expect(deps.publish.mock.calls[0]?.[1].content).toBe(masthead);
  });

  it("posts the masthead again without the picture when Discord won't take the picture", async () => {
    const deps = createDeps();
    deps.publish.mockImplementation(refusingPictures(new Error("Missing Permissions")));

    await publishJob(deps).run();

    expect(
      deps.publish.mock.calls.map(([, message, files]) => [
        message.nonce,
        message.content,
        files?.length,
      ]),
    ).toEqual([
      ["digest-2026-09-28-0", captioned, 1],
      // Without the picture, its caption goes too.
      ["digest-2026-09-28-0", masthead, 0],
      ["digest-2026-09-28-1", "## Decided\n- Brannoc has made a spreadsheet.", 0],
    ]);
  });

  it("logs why Discord wouldn't take the picture", async () => {
    const deps = createDeps();
    const failure = new Error("Missing Permissions");
    deps.publish.mockImplementation(refusingPictures(failure));

    await publishJob(deps).run();

    expect(deps.logger.error).toHaveBeenCalledExactlyOnceWith(
      { event: "digest.picture_post_failed", err: failure },
      "Discord wouldn't take this week's picture, so the digest goes without one",
    );
  });

  it("asks OpenAI for nothing when the digest has no cartoon", async () => {
    const deps = createDeps(someChat, { ...aDigest, cartoon: undefined });

    await publishJob(deps).run();

    expect(deps.draw).not.toHaveBeenCalled();
  });

  it("posts the digest without a picture when it has no cartoon", async () => {
    const deps = createDeps(someChat, { ...aDigest, cartoon: undefined });

    await publishJob(deps).run();

    expect(deps.publish.mock.calls.map(([, message, files]) => [message.content, files])).toEqual([
      [masthead, []],
      ["## Decided\n- Brannoc has made a spreadsheet.", []],
    ]);
  });

  it("logs that the digest has no cartoon", async () => {
    const deps = createDeps(someChat, { ...aDigest, cartoon: undefined });

    await publishJob(deps).run();

    expect(deps.logger.info).toHaveBeenCalledWith(
      { event: "digest.no_cartoon" },
      "Claude described no scene, so the digest goes without a picture",
    );
  });

  it("doesn't draw a scene that names someone from the week's chat, whatever its case", async () => {
    const deps = createDeps(someChat, {
      ...aDigest,
      cartoon: { scene: "BRANNOC the dwarf unrolls a spreadsheet.", caption: undefined },
    });

    await publishJob(deps).run();

    expect(deps.draw).not.toHaveBeenCalled();
  });

  it("draws a scene where a name appears only inside a longer word", async () => {
    const deps = createDeps([{ name: "general", messages: [chatMessage({ authorName: "Ash" })] }], {
      ...aDigest,
      cartoon: { scene: "A dwarf sweeps up the ashes.", caption: undefined },
    });

    await publishJob(deps).run();

    expect(deps.draw).toHaveBeenCalledExactlyOnceWith("A dwarf sweeps up the ashes.");
  });

  it("logs a scene that names someone, without the name", async () => {
    const deps = createDeps(someChat, {
      ...aDigest,
      cartoon: { scene: "Brannoc the dwarf unrolls a spreadsheet.", caption: undefined },
    });

    await publishJob(deps).run();

    expect(deps.logger.error).toHaveBeenCalledExactlyOnceWith(
      { event: "digest.scene_names_member" },
      "Claude named someone from the chat in the scene, so the digest goes without a picture",
    );
  });

  it("posts the digest without a picture when drawing it fails", async () => {
    const deps = createDeps();
    deps.draw.mockRejectedValue(new Error("OpenAI answered HTTP 500 instead of drawing."));

    await publishJob(deps).run();

    expect(deps.publish.mock.calls.map(([, message, files]) => [message.content, files])).toEqual([
      [masthead, []],
      ["## Decided\n- Brannoc has made a spreadsheet.", []],
    ]);
  });

  it("logs why the picture couldn't be drawn", async () => {
    const deps = createDeps();
    const failure = new Error("OpenAI answered HTTP 400 (moderation_blocked) instead of drawing.");
    deps.draw.mockRejectedValue(failure);

    await publishJob(deps).run();

    expect(deps.logger.error).toHaveBeenCalledExactlyOnceWith(
      { event: "digest.illustration_failed", err: failure },
      "Couldn't draw this week's picture, so the digest goes without one",
    );
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
      { event: "digest.quiet_week", from: lastWeek.from, to: lastWeek.to },
      "Nobody wrote anything this week, so there's no digest",
    );
  });

  it("fails without posting when Claude writes no sections", async () => {
    const deps = createDeps(someChat, { ...aDigest, sections: [] });

    await expect(publishJob(deps).run()).rejects.toThrow(
      new Error("Claude wrote a digest with no sections."),
    );
    expect(deps.publish).not.toHaveBeenCalled();
  });

  it("logs how much chat went into the digest and how it was posted", async () => {
    const deps = createDeps();

    await publishJob(deps).run();

    expect(deps.logger.info).toHaveBeenCalledExactlyOnceWith(
      { event: "digest.published", chatMessages: 1, sections: 1, discordMessages: 2 },
      "Published this week's digest",
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
      { event: "digest.chat_trimmed", keptMessages: 388, droppedMessages: 112 },
      "Left the week's oldest chat out to stay within the limit",
    );
  });
});
