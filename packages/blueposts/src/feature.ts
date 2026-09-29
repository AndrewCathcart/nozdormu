import type { ChannelPublisher, Feature, Logger, RecentPostReader } from "@nozdormu/core";
import { formatStaffPost } from "./format.ts";
import type { ForumReader, StaffPost } from "./forum.ts";
import type { SeenPostStore } from "./seen-posts.ts";

export interface BluePostsFeatureDeps {
  // The channel Forever news is posted in.
  readonly newsChannelId: string;
  // Names the forum the posts are read from, so each forum's seen posts are kept apart.
  readonly feed: string;
  // The forum's staff groups whose posts are read. Its Blizzard tracker leaves out many developers,
  // who have a group of their own.
  readonly groups: readonly string[];
  readonly readPosts: ForumReader;
  readonly seenPosts: SeenPostStore;
  readonly publish: ChannelPublisher;
  readonly recentPosts: RecentPostReader;
  readonly logger: Pick<Logger, "info" | "warn">;
}

// The game's name, capitalised as Blizzard writes it, so "queue taking forever" doesn't count.
const forever = /\bForever\b/;

// In one of the forums' Forever categories (or one under them), or a topic about Forever elsewhere,
// like Blizzard's news announcements in General Discussion.
function isAboutForever(post: StaffPost): boolean {
  return [post.forum?.name, post.forum?.parent, post.topicTitle].some(
    (text) => text !== undefined && forever.test(text),
  );
}

function byCreationTime(a: StaffPost, b: StaffPost): number {
  return a.createdAt.getTime() - b.createdAt.getTime();
}

// How many of the Forever posts already on the forum the first check posts, so the news channel
// starts with something in it.
const firstCheckPostCount = 3;

// The newest post's time, if there are any.
function newestTime(posts: readonly StaffPost[]): Date | undefined {
  const times = posts.map((post) => post.createdAt.getTime());
  return times.length === 0 ? undefined : new Date(Math.max(...times));
}

// Posts each new Blizzard staff forum post about Forever in the news channel. The first check
// posts the latest few already there and records the rest without posting them. A post is
// recorded only after it's posted, so a failed one is tried again at the next check; before
// posting, the bot looks for the post's link among its own recent messages, so one posted just
// before a crash isn't repeated.
export function createBluePostsFeature(deps: BluePostsFeatureDeps): Feature {
  const { feed } = deps;

  const poll = async (): Promise<void> => {
    const pages: { readonly group: string; readonly posts: StaffPost[] }[] = [];
    for (const group of deps.groups) {
      pages.push({ group, posts: await deps.readPosts(group) });
    }
    // A post can be on more than one group's page.
    const posts = [
      ...new Map(pages.flatMap((page) => page.posts).map((post) => [post.id, post])).values(),
    ];
    const history = await deps.seenPosts.history(feed);
    let seen: ReadonlySet<number>;
    // A post no newer than this was already there at the first check, and has resurfaced (say,
    // after a newer post was deleted). Every later post gets posted and recorded, so it isn't new.
    let baseline: Date | undefined;
    if (history === undefined) {
      // Everything older than the latest few Forever posts counts as already there, and so does
      // anything older that turns up later: the baseline is just before the oldest of the few.
      // Those few are then new, and get posted below like any other.
      const [oldestToPost] = posts
        .filter(isAboutForever)
        .toSorted(byCreationTime)
        .slice(-firstCheckPostCount);
      const alreadyThere =
        oldestToPost === undefined
          ? posts
          : posts.filter((post) => post.createdAt < oldestToPost.createdAt);
      baseline =
        oldestToPost === undefined
          ? newestTime(posts)
          : new Date(oldestToPost.createdAt.getTime() - 1);
      await deps.seenPosts.recordFirstCheck(feed, alreadyThere, baseline);
      deps.logger.info(
        { event: "blueposts.first_check", feed, posts: alreadyThere.length },
        "Recorded the older staff posts already on the forum without posting them",
      );
      // What was just recorded, rather than read back from the store, which a dry run's doesn't
      // keep.
      seen = new Set(alreadyThere.map((post) => post.id));
    } else {
      seen = await deps.seenPosts.seenIds(
        feed,
        posts.map((post) => post.id),
      );
      baseline = history.baseline;
      // Each group's page shows only its latest posts. If none of them was seen before, more
      // arrived since the last check than it shows, perhaps while the bot was down. (At the first
      // check, the latest posts are unseen on purpose.)
      for (const page of pages) {
        if (page.posts.length > 0 && page.posts.every((post) => !seen.has(post.id))) {
          deps.logger.warn(
            { event: "blueposts.gap", feed, group: page.group, posts: page.posts.length },
            "Saw none of the group's posts before, so some may have been missed",
          );
        }
      }
    }
    const unseen = posts.filter((post) => !seen.has(post.id));
    const isNew = (post: StaffPost): boolean => baseline === undefined || post.createdAt > baseline;
    const fresh = unseen
      .filter((post) => isAboutForever(post) && isNew(post))
      .toSorted(byCreationTime);
    // The rest are recorded without posting, so the next check knows it saw them.
    const skipped = unseen.filter((post) => !fresh.includes(post));
    if (skipped.length > 0) {
      await deps.seenPosts.markSeen(
        feed,
        skipped.map((post) => post.id),
      );
    }
    const older = skipped.filter(isAboutForever);
    if (older.length > 0) {
      deps.logger.info(
        { event: "blueposts.skipped_older", feed, postIds: older.map((post) => post.id) },
        "Skipped older staff posts that reappeared on the tracker",
      );
    }
    if (fresh.length === 0) {
      return;
    }

    const alreadyPosted = await deps.recentPosts(deps.newsChannelId);
    const failures: unknown[] = [];
    for (const post of fresh) {
      // The link's end still matches after the topic is renamed.
      const wasPosted = alreadyPosted.some((earlier) =>
        earlier.embedUrls.some((url) => url.endsWith(post.linkEnd)),
      );
      try {
        if (!wasPosted) {
          await deps.publish(deps.newsChannelId, formatStaffPost(post));
        }
        // Posted but not recorded: the next check should find the post among the bot's own.
        await deps.seenPosts.markSeen(feed, [post.id]);
      } catch (error) {
        failures.push(error);
        continue;
      }
      if (!wasPosted) {
        deps.logger.info(
          { event: "blueposts.posted", feed, postId: post.id },
          "Posted a Blizzard staff post",
        );
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `Couldn't post or record ${String(failures.length)} staff post(s).`,
      );
    }
  };

  return { jobs: [{ name: "blueposts.poll", intervalMs: 10 * 60_000, run: poll }] };
}
