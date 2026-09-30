import type { ChannelPublisher, Logger, RecentPostReader } from "@nozdormu/core";
import { assert, describe, expect, it, vi } from "vitest";
import { createYouTubeFeature } from "./feature.ts";
import type { Video } from "./feed.ts";
import type { FeedReader } from "./feed-reader.ts";
import type { ChannelHistory, SeenVideo, SeenVideoStore } from "./seen-videos.ts";

const alertChannelId = "300000000000000003";

const scotteJaye = { name: "ScotteJaye", youtubeChannelId: "UCyMNUoiD0vlmFtiriDtVI5Q" };
const channelOne = { name: "Made-up One", youtubeChannelId: "UC1111111111111111111111" };
const channelTwo = { name: "Made-up Two", youtubeChannelId: "UC2222222222222222222222" };

function video(id: string, published: string): Video {
  return { id, url: `https://www.youtube.com/watch?v=${id}`, publishedAt: new Date(published) };
}

const videoA = video("aaaaaaaaaaa", "2026-09-26T10:00:00Z");
const videoB = video("bbbbbbbbbbb", "2026-09-27T10:00:00Z");
const videoC = video("ccccccccccc", "2026-09-28T10:00:00Z");

function newestOf(videos: readonly SeenVideo[]): Date | undefined {
  const times = videos.map((v) => v.publishedAt.getTime());
  return times.length === 0 ? undefined : new Date(Math.max(...times));
}

// An in-memory store that keeps each channel's history apart. A given history is treated as
// every channel's first check.
function createFakeSeenVideos(history?: { readonly seen: readonly Video[] }) {
  const channels = new Map<
    string,
    { firstCheckDone: boolean; baselinePublishedAt: Date | undefined; seen: Map<string, SeenVideo> }
  >();
  const channel = (channelId: string) => {
    let state = channels.get(channelId);
    if (state === undefined) {
      state = {
        firstCheckDone: history !== undefined,
        baselinePublishedAt: newestOf(history?.seen ?? []),
        seen: new Map((history?.seen ?? []).map((v) => [v.id, v])),
      };
      channels.set(channelId, state);
    }
    return state;
  };
  const record = (channelId: string, videos: readonly SeenVideo[]): void => {
    for (const v of videos) {
      channel(channelId).seen.set(v.id, v);
    }
  };
  return {
    seenIn: (channelId: string): string[] => [...channel(channelId).seen.keys()].toSorted(),
    history: (channelId): Promise<ChannelHistory> => {
      const state = channel(channelId);
      return Promise.resolve({
        firstCheckDone: state.firstCheckDone,
        seenIds: new Set(state.seen.keys()),
        baselinePublishedAt: state.baselinePublishedAt,
      });
    },
    recordFirstCheck: (channelId, videos) => {
      const state = channel(channelId);
      state.firstCheckDone = true;
      state.baselinePublishedAt = newestOf(videos);
      record(channelId, videos);
      return Promise.resolve();
    },
    markSeen: (channelId, videos) => {
      record(channelId, videos);
      return Promise.resolve();
    },
  } satisfies SeenVideoStore & { readonly seenIn: (channelId: string) => string[] };
}

// The feed lists videos newest first, like YouTube's.
function createDeps(feed: readonly Video[], history?: { readonly seen: readonly Video[] }) {
  return {
    channels: [scotteJaye],
    alertChannelId,
    readFeed: vi.fn<FeedReader>().mockResolvedValue([...feed]),
    seenVideos: createFakeSeenVideos(history),
    publish: vi.fn<ChannelPublisher>().mockResolvedValue(undefined),
    recentPosts: vi.fn<RecentPostReader>().mockResolvedValue([]),
    logger: { info: vi.fn<Logger["info"]>() } satisfies Pick<Logger, "info">,
  };
}

function pollJob(deps: ReturnType<typeof createDeps>) {
  const job = createYouTubeFeature(deps).jobs?.find(
    (candidate) => candidate.name === "youtube.poll",
  );
  assert(job, "The YouTube feature should define a youtube.poll job.");
  return job;
}

describe("YouTube alert", () => {
  it("records the videos already on the channel at its first check, without posting any", async () => {
    const deps = createDeps([videoB, videoA]);

    await pollJob(deps).run();

    expect(deps.publish).not.toHaveBeenCalled();
    expect(deps.seenVideos.seenIn(scotteJaye.youtubeChannelId)).toEqual([
      "aaaaaaaaaaa",
      "bbbbbbbbbbb",
    ]);
  });

  it("counts a first check that found no videos, so the next upload is posted", async () => {
    const deps = createDeps([]);
    await pollJob(deps).run();
    deps.readFeed.mockResolvedValue([videoA]);

    await pollJob(deps).run();

    expect(deps.publish).toHaveBeenCalledOnce();
  });
  it("posts a new video's link in the alert channel, pinging no one, with a nonce against repeats", async () => {
    const deps = createDeps([videoB, videoA], { seen: [videoA] });

    await pollJob(deps).run();

    expect(deps.publish).toHaveBeenCalledExactlyOnceWith(alertChannelId, {
      content: "🚨 NEW SCOTTEJAYE VIDEO 🚨\nhttps://www.youtube.com/watch?v=bbbbbbbbbbb",
      allowed_mentions: { parse: [] },
      nonce: "yt-bbbbbbbbbbb",
      enforce_nonce: true,
    });
  });

  it("doesn't post a video it has already posted", async () => {
    const deps = createDeps([videoB, videoA], { seen: [videoA] });
    await pollJob(deps).run();

    await pollJob(deps).run();

    expect(deps.publish).toHaveBeenCalledOnce();
  });

  it("posts several new videos oldest first", async () => {
    const deps = createDeps([videoC, videoB, videoA], { seen: [videoA] });

    await pollJob(deps).run();

    expect(deps.publish.mock.calls.map(([, message]) => message.nonce)).toEqual([
      "yt-bbbbbbbbbbb",
      "yt-ccccccccccc",
    ]);
  });

  it("skips and records an older video that reappears in the feed, without posting it", async () => {
    const deps = createDeps([videoB, videoA], { seen: [videoB] });

    await pollJob(deps).run();

    expect(deps.publish).not.toHaveBeenCalled();
    expect(deps.seenVideos.seenIn(scotteJaye.youtubeChannelId)).toContain("aaaaaaaaaaa");
  });

  it("doesn't repost a video its recent messages already link to, and records it", async () => {
    const deps = createDeps([videoC, videoB], { seen: [videoB] });
    deps.recentPosts.mockResolvedValue([
      {
        content: "🚨 NEW SCOTTEJAYE VIDEO 🚨\nhttps://www.youtube.com/watch?v=ccccccccccc",
        embedUrls: [],
      },
    ]);

    await pollJob(deps).run();

    expect(deps.publish).not.toHaveBeenCalled();
    expect(deps.seenVideos.seenIn(scotteJaye.youtubeChannelId)).toContain("ccccccccccc");
  });

  it("posts a video on a later check if posting it failed", async () => {
    const deps = createDeps([videoB, videoA], { seen: [videoA] });
    deps.publish.mockRejectedValueOnce(new Error("Discord is down"));
    await expect(pollJob(deps).run()).rejects.toThrow("Couldn't post or record 1 new video(s).");

    await pollJob(deps).run();

    expect(deps.publish.mock.calls.map(([, message]) => message.nonce)).toEqual([
      "yt-bbbbbbbbbbb",
      "yt-bbbbbbbbbbb",
    ]);
  });

  it("still posts the other new videos when one fails, then fails the check", async () => {
    const deps = createDeps([videoC, videoB, videoA], { seen: [videoA] });
    deps.publish.mockRejectedValueOnce(new Error("AutoMod blocked it"));

    await expect(pollJob(deps).run()).rejects.toThrow("Couldn't post or record 1 new video(s).");

    expect(deps.seenVideos.seenIn(scotteJaye.youtubeChannelId)).toEqual([
      "aaaaaaaaaaa",
      "ccccccccccc",
    ]);
  });

  it("reads the feed of every channel it watches", async () => {
    const deps = { ...createDeps([videoA]), channels: [channelOne, channelTwo] };

    await pollJob(deps).run();

    expect(deps.readFeed.mock.calls).toEqual([
      ["https://www.youtube.com/feeds/videos.xml?channel_id=UC1111111111111111111111"],
      ["https://www.youtube.com/feeds/videos.xml?channel_id=UC2222222222222222222222"],
    ]);
  });

  it("still checks the other channels when one channel's feed can't be read, then fails the check", async () => {
    const deps = { ...createDeps([], { seen: [videoA] }), channels: [channelOne, channelTwo] };
    deps.readFeed.mockImplementation((url) =>
      url.endsWith(channelOne.youtubeChannelId)
        ? Promise.reject(new Error("The YouTube feed answered HTTP 404."))
        : Promise.resolve([videoB, videoA]),
    );

    await expect(pollJob(deps).run()).rejects.toThrow("The YouTube feed answered HTTP 404.");

    expect(deps.publish).toHaveBeenCalledExactlyOnceWith(alertChannelId, {
      content: "🚨 NEW MADE-UP TWO VIDEO 🚨\nhttps://www.youtube.com/watch?v=bbbbbbbbbbb",
      allowed_mentions: { parse: [] },
      nonce: "yt-bbbbbbbbbbb",
      enforce_nonce: true,
    });
  });

  it("fails the check, recording and posting nothing, when the feed can't be read", async () => {
    const deps = createDeps([], { seen: [videoA] });
    deps.readFeed.mockRejectedValue(new Error("The YouTube feed answered HTTP 404."));

    await expect(pollJob(deps).run()).rejects.toThrow("The YouTube feed answered HTTP 404.");

    expect(deps.publish).not.toHaveBeenCalled();
    expect(deps.seenVideos.seenIn(scotteJaye.youtubeChannelId)).toEqual(["aaaaaaaaaaa"]);
  });

  it("logs each video it posts", async () => {
    const deps = createDeps([videoB, videoA], { seen: [videoA] });

    await pollJob(deps).run();

    expect(deps.logger.info).toHaveBeenCalledExactlyOnceWith(
      { event: "youtube.posted", channel: "ScotteJaye", videoId: "bbbbbbbbbbb" },
      "Posted a new YouTube video",
    );
  });

  it("logs its first check, and how many existing videos it recorded", async () => {
    const deps = createDeps([videoB, videoA]);

    await pollJob(deps).run();

    expect(deps.logger.info).toHaveBeenCalledExactlyOnceWith(
      { event: "youtube.first_check", channel: "ScotteJaye", videos: 2 },
      "Recorded the channel's existing videos without posting them",
    );
  });
  it("posts a video whose post failed on the next check, even after a newer video was posted", async () => {
    const deps = createDeps([videoC, videoB, videoA], { seen: [videoA] });
    deps.publish.mockRejectedValueOnce(new Error("Discord is down"));
    await expect(pollJob(deps).run()).rejects.toThrow("Couldn't post or record 1 new video(s).");

    await pollJob(deps).run();

    expect(deps.publish.mock.calls.map(([, message]) => message.nonce)).toEqual([
      "yt-bbbbbbbbbbb",
      "yt-ccccccccccc",
      "yt-bbbbbbbbbbb",
    ]);
  });

  it("looks for its earlier posts in the alert channel", async () => {
    const deps = createDeps([videoB, videoA], { seen: [videoA] });

    await pollJob(deps).run();

    expect(deps.recentPosts).toHaveBeenCalledExactlyOnceWith(alertChannelId);
  });
  it("keeps posting the other new videos when recording a posted one fails, then fails the check", async () => {
    const deps = createDeps([videoC, videoB, videoA], { seen: [videoA] });
    const markSeen = deps.seenVideos.markSeen;
    let calls = 0;
    deps.seenVideos.markSeen = (channelId, videos) => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new Error("Database is down"))
        : markSeen(channelId, videos);
    };

    await expect(pollJob(deps).run()).rejects.toThrow("Couldn't post or record 1 new video(s).");

    expect(deps.publish.mock.calls.map(([, message]) => message.nonce)).toEqual([
      "yt-bbbbbbbbbbb",
      "yt-ccccccccccc",
    ]);
  });
});
