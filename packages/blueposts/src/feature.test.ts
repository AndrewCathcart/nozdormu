import type {
  ChannelPublisher,
  Logger,
  RecentPost,
  RecentPostReader,
  ScheduledJob,
} from "@nozdormu/core";
import { describe, expect, it, vi } from "vitest";
import { type BluePostsFeatureDeps, createBluePostsFeature } from "./feature.ts";
import type { ForumReader, StaffPost } from "./forum.ts";
import type { FeedHistory, SeenPostStore } from "./seen-posts.ts";

// Made up.
const newsChannelId = "300000000000000007";
const forum = "https://eu.forums.example/en/wow";
const feed = "made-up-forum";
// Staff groups on the forum, each with its own page of posts.
const staff = "made-up-staff";
const developers = "made-up-developers";

function post(id: number, fields: Partial<StaffPost> = {}): StaffPost {
  return {
    id,
    createdAt: new Date(Date.UTC(2026, 8, 24, 12, 0, id % 60)),
    author: "MadeUpCM",
    authorTitle: "Made-up Manager",
    avatarUrl: undefined,
    topicTitle: `Made-up Topic ${String(id)}`,
    url: `${forum}/t/made-up-topic/${String(id)}/1`,
    linkEnd: `/${String(id)}/1`,
    isReply: false,
    forum: { name: "WoW: Forever Beta Discussion", parent: undefined },
    excerpt: "Made-up news.",
    ...fields,
  };
}

// What the feed's store holds before a check.
interface FeedState {
  readonly seen: readonly number[];
  readonly baseline: Date | undefined;
}

// The feed was first checked when post 1 was the newest there.
const checkedBefore: FeedState = { seen: [1], baseline: post(1).createdAt };

function checkFeed(name: string): void {
  if (name !== feed) {
    throw new Error(`Unexpected feed ${name}.`);
  }
}

// An in-memory SeenPostStore holding one feed's history, which fails for any other feed.
function createFakeStore(state: FeedState | "never checked") {
  const ids = new Set(state === "never checked" ? [] : state.seen);
  let history: FeedHistory | undefined =
    state === "never checked" ? undefined : { baseline: state.baseline };
  return {
    ids,
    history: vi.fn<SeenPostStore["history"]>((name) => {
      checkFeed(name);
      return Promise.resolve(history);
    }),
    recordFirstCheck: vi.fn<SeenPostStore["recordFirstCheck"]>((name, posts) => {
      checkFeed(name);
      // As the real store does: the newest post recorded is the baseline.
      const times = posts.map((seenPost) => seenPost.createdAt.getTime());
      history = { baseline: times.length === 0 ? undefined : new Date(Math.max(...times)) };
      for (const seenPost of posts) {
        ids.add(seenPost.id);
      }
      return Promise.resolve();
    }),
    seenIds: vi.fn<SeenPostStore["seenIds"]>((name, postIds) => {
      checkFeed(name);
      return Promise.resolve(new Set(postIds.filter((id) => ids.has(id))));
    }),
    markSeen: vi.fn<SeenPostStore["markSeen"]>((name, postIds) => {
      checkFeed(name);
      for (const id of postIds) {
        ids.add(id);
      }
      return Promise.resolve();
    }),
  } satisfies SeenPostStore & { readonly ids: Set<number> };
}

function createDeps(posts: StaffPost[], state: FeedState | "never checked" = checkedBefore) {
  return {
    newsChannelId,
    feed,
    groups: [staff],
    readPosts: vi.fn<ForumReader>().mockResolvedValue(posts),
    seenPosts: createFakeStore(state),
    publish: vi.fn<ChannelPublisher>().mockResolvedValue(undefined),
    recentPosts: vi.fn<RecentPostReader>().mockResolvedValue([]),
    logger: {
      info: vi.fn<Logger["info"]>(),
      warn: vi.fn<Logger["warn"]>(),
    } satisfies Pick<Logger, "info" | "warn">,
  } satisfies BluePostsFeatureDeps;
}

function pollJob(deps: BluePostsFeatureDeps): ScheduledJob {
  const [job] = createBluePostsFeature(deps).jobs ?? [];
  if (job === undefined) {
    throw new Error("The feature has no job.");
  }
  return job;
}

// The links of the cards posted, in order.
function postedUrls(deps: ReturnType<typeof createDeps>): (string | undefined)[] {
  return deps.publish.mock.calls.map(([, message]) => message.embeds?.[0]?.url);
}

// A card the bot posted earlier, linking to this address.
function earlierCard(url: string): RecentPost {
  return { content: "", embedUrls: [url] };
}

describe("createBluePostsFeature", () => {
  it("checks the forum every 10 minutes", () => {
    expect(pollJob(createDeps([]))).toMatchObject({
      name: "blueposts.poll",
      intervalMs: 10 * 60_000,
    });
  });

  it("posts the latest three Forever posts at the first check, oldest first", async () => {
    const deps = createDeps([post(5), post(4), post(3), post(2), post(1)], "never checked");

    await pollJob(deps).run();

    expect(postedUrls(deps)).toEqual([post(3).url, post(4).url, post(5).url]);
  });

  it("records the older posts at the first check without posting them", async () => {
    const deps = createDeps([post(5), post(4), post(3), post(2), post(1)], "never checked");

    await pollJob(deps).run();

    expect(deps.seenPosts.recordFirstCheck).toHaveBeenCalledExactlyOnceWith(feed, [
      post(2),
      post(1),
    ]);
    expect(deps.seenPosts.ids).toEqual(new Set([1, 2, 3, 4, 5]));
  });

  it("posts only the latest three at the first check, whatever the store gives back after", async () => {
    // Like a dry run's store, which keeps nothing it's asked to record.
    const deps = createDeps([post(5), post(4), post(3), post(2), post(1)], "never checked");
    deps.seenPosts.recordFirstCheck.mockResolvedValue(undefined);
    deps.seenPosts.markSeen.mockResolvedValue(undefined);

    await pollJob(deps).run();

    expect(postedUrls(deps)).toEqual([post(3).url, post(4).url, post(5).url]);
  });

  it("counts only Forever posts among the latest three at the first check", async () => {
    const retail = { forum: { name: "General Discussion", parent: undefined } };
    const deps = createDeps(
      [post(6, retail), post(5), post(4), post(3), post(2), post(1)],
      "never checked",
    );

    await pollJob(deps).run();

    expect(postedUrls(deps)).toEqual([post(3).url, post(4).url, post(5).url]);
  });

  it("doesn't warn of missed posts at the first check, though the latest are unseen", async () => {
    // The developers' page shows only posts the first check is about to post.
    const deps = { ...createDeps([], "never checked"), groups: [staff, developers] };
    deps.readPosts.mockImplementation((group) =>
      Promise.resolve(
        group === developers ? [post(5), post(4)] : [post(5), post(4), post(3), post(2), post(1)],
      ),
    );

    await pollJob(deps).run();

    expect(deps.logger.warn).not.toHaveBeenCalled();
  });

  it("posts each new Forever post in the news channel, oldest first, and records it", async () => {
    const deps = createDeps([post(3), post(2), post(1)]);

    await pollJob(deps).run();

    expect(deps.publish.mock.calls.map(([channelId]) => channelId)).toEqual([
      newsChannelId,
      newsChannelId,
    ]);
    expect(postedUrls(deps)).toEqual([post(2).url, post(3).url]);
    expect(deps.seenPosts.ids).toEqual(new Set([1, 2, 3]));
  });

  it("leaves out posts that aren't about Forever", async () => {
    const deps = createDeps([
      post(2, { forum: { name: "General Discussion", parent: undefined }, topicTitle: "Hotfixes" }),
    ]);

    await pollJob(deps).run();

    expect(deps.publish).not.toHaveBeenCalled();
  });

  it("posts from a forum under a Forever forum, whatever the forum's own name", async () => {
    const deps = createDeps([
      post(2, { forum: { name: "Beta Discussion", parent: "WoW: Forever" }, topicTitle: "Realms" }),
    ]);

    await pollJob(deps).run();

    expect(postedUrls(deps)).toEqual([post(2).url]);
  });

  it("leaves out a topic whose title only uses forever as a plain word", async () => {
    const deps = createDeps([
      post(2, {
        forum: { name: "General Discussion", parent: undefined },
        topicTitle: "Queue taking forever since the patch",
      }),
    ]);

    await pollJob(deps).run();

    expect(deps.publish).not.toHaveBeenCalled();
  });

  it("posts news from another forum when its title mentions Forever", async () => {
    const deps = createDeps([
      post(2, {
        forum: { name: "General Discussion", parent: undefined },
        topicTitle: "WoW: Forever Headlines the Week",
      }),
    ]);

    await pollJob(deps).run();

    expect(postedUrls(deps)).toEqual([post(2).url]);
  });

  it("records an unseen post no newer than the first check's newest without posting it", async () => {
    // Post 1 was the newest at the first check; post 0 is older but wasn't recorded, say because
    // it has resurfaced on the tracker after a newer post was deleted.
    const deps = createDeps([post(2), post(0)], { seen: [1], baseline: post(1).createdAt });

    await pollJob(deps).run();

    expect(postedUrls(deps)).toEqual([post(2).url]);
    expect(deps.seenPosts.ids).toEqual(new Set([0, 1, 2]));
  });

  it("logs the older Forever posts it skips", async () => {
    const hotfixes = post(3, {
      forum: { name: "General Discussion", parent: undefined },
      topicTitle: "Hotfixes",
    });
    const deps = createDeps([hotfixes, post(2), post(0)]);

    await pollJob(deps).run();

    expect(deps.logger.info).toHaveBeenCalledWith(
      { event: "blueposts.skipped_older", feed, postIds: [0] },
      "Skipped older staff posts that reappeared on the tracker",
    );
  });

  it("reads each staff group's posts, posting a post both groups list once", async () => {
    const deps = { ...createDeps([]), groups: [staff, developers] };
    deps.readPosts.mockImplementation((group) =>
      Promise.resolve(group === developers ? [post(3), post(2)] : [post(2)]),
    );

    await pollJob(deps).run();

    expect(postedUrls(deps)).toEqual([post(2).url, post(3).url]);
  });

  it("warns that posts may have been missed when it has seen none of a group's posts", async () => {
    const deps = { ...createDeps([]), groups: [staff, developers] };
    deps.readPosts.mockImplementation((group) =>
      Promise.resolve(group === staff ? [post(3), post(2)] : [post(1)]),
    );

    await pollJob(deps).run();

    expect(deps.logger.warn).toHaveBeenCalledExactlyOnceWith(
      { event: "blueposts.gap", feed, group: staff, posts: 2 },
      "Saw none of the group's posts before, so some may have been missed",
    );
    expect(postedUrls(deps)).toEqual([post(2).url, post(3).url]);
  });

  it("doesn't warn when the tracker still shows a post it saw that wasn't about Forever", async () => {
    const hotfixes = post(2, {
      forum: { name: "General Discussion", parent: undefined },
      topicTitle: "Hotfixes",
    });
    const deps = createDeps([hotfixes, post(1)]);
    await pollJob(deps).run();

    deps.readPosts.mockResolvedValue([post(3), hotfixes]);
    await pollJob(deps).run();

    expect(deps.logger.warn).not.toHaveBeenCalled();
  });

  it("doesn't post again a post the bot already posted, recording it instead", async () => {
    const deps = createDeps([post(2)]);
    deps.recentPosts.mockResolvedValue([earlierCard(post(2).url)]);

    await pollJob(deps).run();

    expect(deps.publish).not.toHaveBeenCalled();
    expect(deps.seenPosts.ids).toEqual(new Set([1, 2]));
  });

  it("recognises a post it already posted after the topic was renamed", async () => {
    const deps = createDeps([post(2)]);
    deps.recentPosts.mockResolvedValue([earlierCard(`${forum}/t/old-title/2/1`)]);

    await pollJob(deps).run();

    expect(deps.publish).not.toHaveBeenCalled();
  });

  it("posts a post whose link is the start of another link the bot posted", async () => {
    // Topic 2's first post, when the bot has posted its tenth.
    const deps = createDeps([post(2)]);
    deps.recentPosts.mockResolvedValue([earlierCard(`${forum}/t/made-up-topic/2/10`)]);

    await pollJob(deps).run();

    expect(postedUrls(deps)).toEqual([post(2).url]);
  });

  it("posts the others and fails the check when recording an already posted one fails", async () => {
    const deps = createDeps([post(3), post(2)]);
    deps.recentPosts.mockResolvedValue([earlierCard(post(2).url)]);
    deps.seenPosts.markSeen.mockRejectedValueOnce(new Error("Postgres is down"));

    await expect(pollJob(deps).run()).rejects.toThrow("Couldn't post or record 1 staff post(s).");

    expect(postedUrls(deps)).toEqual([post(3).url]);
  });

  it("posts the others and fails the check when one post fails, retrying it next time", async () => {
    const deps = createDeps([post(3), post(2)]);
    deps.publish.mockRejectedValueOnce(new Error("Discord is down"));

    const job = pollJob(deps);

    await expect(job.run()).rejects.toThrow("Couldn't post or record 1 staff post(s).");
    expect(postedUrls(deps)).toEqual([post(2).url, post(3).url]);

    await job.run();
    expect(postedUrls(deps)).toEqual([post(2).url, post(3).url, post(2).url]);
  });

  it("logs each post it posts", async () => {
    const deps = createDeps([post(2)]);

    await pollJob(deps).run();

    expect(deps.logger.info).toHaveBeenCalledExactlyOnceWith(
      { event: "blueposts.posted", feed, postId: 2 },
      "Posted a Blizzard staff post",
    );
  });
});
